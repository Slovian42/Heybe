#!/usr/bin/env bash
# 密钥不进 argv 的干跑测试（Yang 11-02 的规则：密钥只放子进程环境变量、不进命令参数）。只用假 key。
# 做法：PATH 前面放记录 argv 的垫片（env、nohup、curl、sh、sudo），记下所有经过它们的中间进程的命令行；
# 假 fastclaw / 假服务在运行时记下自己和全部祖先进程的 /proc/<pid>/cmdline（没有 /proc 时用 ps），
# 并在睡着的时候拍一张 ps 全量快照。断言这些地方都没有假 key，而子进程环境里有。
# 覆盖：fc_env_exec、fc_env_bg、heybe_fc_agent_upsert、heybe_deepseek_probe、fc_env_only_kv（providers / gateway 检查脚本用的写法）。
# 用法: scripts/poc/argv-secret-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-fc-env.sh
. "$SCRIPT_DIR/lib-fc-env.sh"
# shellcheck source=lib-fc-agent.sh
. "$SCRIPT_DIR/lib-fc-agent.sh"
# shellcheck source=lib-fc-key.sh
. "$SCRIPT_DIR/lib-fc-key.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
n=0
ok_() { n=$((n + 1)); "$@" || { echo "ASSERT FAIL: $*" >&2; exit 1; }; }
no_() { n=$((n + 1)); if "$@"; then echo "ASSERT FAIL (不应成立): $*" >&2; exit 1; fi; }
# has <文件> <字符串>：纯 bash 查找，不把假 key 放进 grep 的 argv
has() { local s; [ -f "$1" ] || return 1; s=$(tr '\0' ' ' <"$1"); case "$s" in *"$2"*) return 0 ;; esac; return 1; }

unset DEEPSEEK_API_KEY HEYBE_SERVICE_TOKEN  # 只用假 key：外面环境里的真 key 先丢掉
KEY="sk-mock-ARGV-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
TOK="tok-mock-ARGV-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
LOG="$T/argv.log"; : >"$LOG"
REAL_PATH="$PATH"

# 垫片：记下 argv 再 exec 真程序（路径写死在脚本里，不靠环境变量，env -i 之后也能记）
mkdir -p "$T/shim"
for p in env nohup curl sh sudo; do
  real=$(command -v "$p" 2>/dev/null || true)
  [ -n "$real" ] || continue
  cat >"$T/shim/$p" <<SH
#!/bin/bash
printf '%s ' "\$0" "\$@" >>"$LOG"; printf '\n' >>"$LOG"
exec "$real" "\$@"
SH
  chmod +x "$T/shim/$p"
done

# 假程序：记 argv、环境里 key 的 sha、自己的 pid、全部祖先的命令行，再拍 ps 快照
cat >"$T/shim/fastclaw" <<SH
#!/bin/bash
out="$T/run.\$\$"
printf '%s ' "\$0" "\$@" >"\$out.argv"
printf '%s' "\${DEEPSEEK_API_KEY-}" >"\$out.envkey"
printf '%s' "\${HEYBE_SERVICE_TOKEN-}" >"\$out.envtok"
printf '%s|%s|%s|%s' "\${OTHER_SECRET_TOKEN-}" "\${PLAIN_DECOY-}" "\${FASTCLAW_ALLOW_HOST_EXEC-}" "\$(declare -F | tr '\n' ' ')" >"\$out.decoy"
echo "\$\$" >"\$out.pid"
: >"\$out.anc"
p=\$\$
while [ -n "\$p" ] && [ "\$p" != 0 ] && [ "\$p" != 1 ]; do
  if [ -r "/proc/\$p/cmdline" ]; then tr '\0' ' ' <"/proc/\$p/cmdline" >>"\$out.anc"; echo >>"\$out.anc"
    p=\$(sed -n 's/^PPid:[[:space:]]*//p' "/proc/\$p/status")
  else ps -ww -o args= -p "\$p" >>"\$out.anc" 2>/dev/null || true
    p=\$(ps -o ppid= -p "\$p" 2>/dev/null | tr -d ' ')
  fi
done
sleep 0.3
ps -A -ww -o args= >"\$out.ps" 2>/dev/null || true
echo "Admin password: not-kept"
exit 0
SH
chmod +x "$T/shim/fastclaw"
PATH="$T/shim:$REAL_PATH"
export FASTCLAW_HOME="$T/fc-home"; mkdir -p "$FASTCLAW_HOME"

# 所有记录里都不能有假 key / 假令牌
assert_no_leak() {
  local f
  no_ has "$LOG" "$KEY"; no_ has "$LOG" "$TOK"
  for f in "$T"/run.*.argv "$T"/run.*.anc "$T"/run.*.ps; do
    [ -f "$f" ] || continue
    no_ has "$f" "$KEY"; no_ has "$f" "$TOK"
  done
}
last_run() { local f; f=$(ls -t "$T"/run.*.pid | head -1); echo "${f%.pid}"; }
clean_runs() { rm -f "$T"/run.*; }

# 环境里的干扰项：一个导出的像密钥的变量、一个普通导出变量、FASTCLAW_ALLOW_HOST_EXEC、一个导出函数
export OTHER_SECRET_TOKEN="$TOK" PLAIN_DECOY=decoy FASTCLAW_ALLOW_HOST_EXEC=1
decoy_fn() { :; }
export -f decoy_fn

# ---- 1. fc_env_exec：key 只是 shell 变量（没 export），交给子进程 ----
DEEPSEEK_API_KEY="$KEY"
fc_env_exec DEEPSEEK_API_KEY fastclaw agents init a1 --provider deepseek --api-key-env DEEPSEEK_API_KEY >/dev/null
r=$(last_run)
ok_ has "$r.envkey" "$KEY"
ok_ test "$(cat "$r.decoy")" = "|||"
ok_ has "$r.argv" "--api-key-env DEEPSEEK_API_KEY"
ok_ test -s "$r.anc"
assert_no_leak
# 调用方 shell 不受影响
ok_ test "${PLAIN_DECOY}" = decoy
ok_ test "$(declare -F decoy_fn)" = decoy_fn
case " $(compgen -e | tr '\n' ' ') " in *" DEEPSEEK_API_KEY "*) echo "ASSERT FAIL: 调用方 shell 里 key 被 export 了" >&2; exit 1 ;; esac
clean_runs

# ---- 2. 不在第一个参数里的密钥名不传 ----
fc_env_exec "" fastclaw agents list >/dev/null
r=$(last_run)
no_ has "$r.envkey" "$KEY"
assert_no_leak
clean_runs

# ---- 3. fc_env_bg：后台 + nohup，pidfile 是真正进程的 pid ----
export DEEPSEEK_API_KEY
fc_env_bg "$T/gw.pid" "DEEPSEEK_API_KEY" nohup fastclaw gateway --port 1 >"$T/gw.log" 2>&1
for _ in $(seq 50); do [ -n "$(ls "$T"/run.*.ps 2>/dev/null)" ] && break; sleep 0.1; done
r=$(last_run)
ok_ test "$(cat "$T/gw.pid")" = "$(cat "$r.pid")"
ok_ has "$r.envkey" "$KEY"
ok_ has "$LOG" "nohup fastclaw gateway"
assert_no_leak
export -n DEEPSEEK_API_KEY
clean_runs

# ---- 4. heybe_fc_agent_upsert（t021-mac.sh / heybe-desktop-dev.sh 走的路径） ----
ok_ test "$(heybe_fc_agent_upsert "$T/shim/fastclaw" a4 deepseek-chat 0 2>/dev/null)" = created
r=$(last_run)
ok_ has "$r.envkey" "$KEY"
assert_no_leak
clean_runs

# ---- 5. heybe_deepseek_probe：Authorization 经 stdin 给 curl（连不上的端口，只看 argv） ----
code=$(HEYBE_DEEPSEEK_API_BASE="http://127.0.0.1:9" HEYBE_KEY_PROBE_TIMEOUT=2 heybe_deepseek_probe DEEPSEEK_API_KEY)
ok_ test -n "$code"
ok_ has "$LOG" "-K -"
assert_no_leak

# ---- 6. fc_env_only_kv：providers-mac-check.sh / gateway-notty-check.sh 的写法 ----
( fc_env_only_kv PATH="$PATH" HOME="$T" HEYBE_SERVICE_TOKEN="$TOK" && exec fastclaw serve ) >/dev/null
r=$(last_run)
ok_ has "$r.envtok" "$TOK"
no_ has "$r.envkey" "$KEY"
ok_ test "$(cat "$r.decoy")" = "|||"
assert_no_leak
clean_runs

DEEPSEEK_API_KEY=""
echo "argv-secret-mock-test: ${n} 条断言全部通过"
