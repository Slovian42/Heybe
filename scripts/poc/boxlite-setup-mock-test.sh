#!/usr/bin/env bash
# boxlite-poc.sh setup 的干跑测试（#90 Mac 复验问题 1）：假 fastclaw CLI，不需要 BoxLite/FastClaw/真密钥。
# 场景：不带 PURGE 的 cleanup 留下了数据目录和旧 Agent "poc"，agents init 报 "already exists (id agt_…)"。
# 覆盖：首次新建；agents list 查得到 → 直接带 --id 原地更新；list 查不到、init 报 already exists → 用报错里的 id
#       带 --id 重跑；每次都重新关 camoufox 并读回 false（用 agt_ id）；读回不是 false → setup 失败；
#       DeepSeek key 只在 init 子进程环境里、不在任何 argv；init 输出里的管理员密码不进终端/日志。
# 用法: scripts/poc/boxlite-setup-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home" HEYBE_POC_HOME="$T/poc" HEYBE_POC_ENV="$T/poc.env"
KEY="sk-mock-SETUP-9f8e7d6c5b4a"
mkdir -p "$HOME/.local/opt/fastclaw/bin" "$HEYBE_POC_HOME"
( umask 077; printf 'DEEPSEEK_API_KEY=%s\n' "$KEY" >"$HEYBE_POC_ENV" )
echo /v1 >"$HEYBE_POC_HOME/boxlite.api"
# 假 fastclaw 拿到的环境只有白名单（fc_env_exec），状态放在 $FASTCLAW_HOME/fake（agents：每行 "id name"）
#   有 list-hide 文件时 agents list 只打印表头（模拟查不到）；有 readback 文件时 config get 读回它的内容
FAKE="$HEYBE_POC_HOME/boxlite/fake"; mkdir -p "$FAKE"
cat >"$HOME/.local/opt/fastclaw/bin/fastclaw" <<'SH'
#!/usr/bin/env bash
d="$FASTCLAW_HOME/fake"; mkdir -p "$d"; st="$d/agents"; touch "$st"
printf '%s\n' "$*" >>"$d/argv.log"
printf '%s' "${DEEPSEEK_API_KEY-}" >>"$d/env-$1-$2.log"; echo >>"$d/env-$1-$2.log"
case "$1 $2" in
  "agents list")
    printf 'ID                NAME   MODEL\n'
    [ -f "$d/list-hide" ] || awk '{ print $1 "   " $2 "   deepseek/deepseek-chat" }' "$st"
    exit 0 ;;
  "agents init")
    name=$3; id=""; prev=""
    for a in "$@"; do [ "$prev" = --id ] && id=$a; prev=$a; done
    old=$(awk -v n="$name" '$2 == n { print $1 }' "$st" | head -1)
    if [ -z "$id" ] && [ -n "$old" ]; then echo "Error: agent \"$name\" already exists (id $old); use a different name, or pass --id $old to update it"; exit 1; fi
    [ -n "$DEEPSEEK_API_KEY" ] || { echo "Error: env DEEPSEEK_API_KEY is empty"; exit 1; }
    if [ -n "$id" ]; then echo "Updated agent $name"; echo "Agent ID: $id"; exit 0; fi
    n=$(($(wc -l <"$st") + 1)); echo "agt_mock$n $name" >>"$st"
    echo "Admin password: hunter2-mock-secret"; echo "Agent ID: agt_mock$n"; exit 0 ;;
  "agents config")
    case "$4" in
      set) printf '%s %s\n' "$3" "$6" >>"$d/config-set.log"; printf '%s' "$6" >"$d/camoufox"; exit 0 ;;
      get) if [ -f "$d/readback" ]; then cat "$d/readback"; else cat "$d/camoufox" 2>/dev/null; fi; echo; exit 0 ;;
    esac ;;
  "agents doctor") echo ok; exit 0 ;;
  "apikey create")
    [ "${3:-}" = --help ] && { echo "  --name string"; exit 0; }
    echo "token: fc_mock_apikey_0001"; exit 0 ;;
esac
exit 2
SH
chmod +x "$HOME/.local/opt/fastclaw/bin/fastclaw"

n=0
eq() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "ASSERT FAIL [$1]: 期望 '$3'，实际 '$2'" >&2; exit 1; }; }
has() { n=$((n + 1)); grep -q -- "$2" <<<"$3" || { echo "ASSERT FAIL [$1]: 输出里没有 '$2'" >&2; printf '%s\n' "$3" >&2; exit 1; }; }
setup() { "$SCRIPT_DIR/boxlite-poc.sh" setup boxlite 2>&1; }

# 1) 首次：新建
out=$(setup)
has "首次新建" "Agent poc 已新建" "$out"
has "camoufox 用 id 关闭并读回" "camoufox-cli 技能已关闭（读回 skills.entries.camoufox-cli.enabled=false，agent agt_mock1）" "$out"
eq "agent-id 缓存" "$(cat "$HEYBE_POC_HOME/boxlite/agent-id")" agt_mock1
eq "只建了一个 Agent" "$(wc -l <"$FAKE/agents" | tr -d ' ')" 1

# 2) 不带 PURGE 的 cleanup 后重跑：list 查得到 → 直接带 --id 原地更新（不再报 already exists）
: >"$FAKE/config-set.log"; rm -f "$FAKE/camoufox"
out=$(setup)
has "原地更新" "Agent poc 已存在，已用 --id agt_mock1 原地更新" "$out"
eq "没有重复建" "$(wc -l <"$FAKE/agents" | tr -d ' ')" 1
eq "init 带了 --id agt_mock1" "$(grep -c '^agents init poc --id agt_mock1 ' "$FAKE/argv.log")" 1
eq "重新关了 camoufox" "$(cat "$FAKE/config-set.log")" "agt_mock1 false"

# 3) list 查不到（格式不同/旧目录），init 报 already exists → 用报错里的 id 带 --id 重跑
: >"$FAKE/argv.log"; : >"$FAKE/config-set.log"; rm -f "$FAKE/camoufox"; : >"$FAKE/list-hide"
out=$(setup)
has "already exists 兜底" "已用 --id agt_mock1 原地更新" "$out"
eq "先不带 --id 试一次、再带 --id" "$(grep '^agents init' "$FAKE/argv.log" | sed 's/ --provider.*//' | tr '\n' '|')" "agents init poc|agents init poc --id agt_mock1|"
eq "重新关了 camoufox（兜底路径）" "$(cat "$FAKE/config-set.log")" "agt_mock1 false"
rm -f "$FAKE/list-hide"

# 4) 读回不是 false → setup 失败
printf true >"$FAKE/readback"
rc=0; out=$(setup) || rc=$?
eq "读回 true → 失败" "$rc" 1
has "读回失败原因" "读回是 true，不是 false" "$out"
rm -f "$FAKE/readback"

# 5) 密钥：DeepSeek key 不在任何 argv；只在 agents init 的子进程环境里；密码不进终端/日志
n=$((n + 1)); ! grep -rqF "$KEY" "$FAKE/argv.log" || { echo "ASSERT FAIL: key 出现在 argv" >&2; exit 1; }
n=$((n + 1)); grep -qF "$KEY" "$FAKE/env-agents-init.log" || { echo "ASSERT FAIL: init 子进程环境里没有 key" >&2; exit 1; }
n=$((n + 1)); ! grep -qF "$KEY" "$FAKE/env-agents-config.log" || { echo "ASSERT FAIL: config 子进程拿到了 key" >&2; exit 1; }
n=$((n + 1)); ! grep -rqF -e hunter2 -e "$KEY" "$HEYBE_POC_HOME/logs" "$HEYBE_POC_HOME/results.tsv" || { echo "ASSERT FAIL: 日志含密码/密钥" >&2; exit 1; }
n=$((n + 1)); ! grep -qF hunter2 <<<"$out" || { echo "ASSERT FAIL: 终端输出含密码" >&2; exit 1; }
echo "boxlite setup mock test: PASS（${n} 项断言）"
