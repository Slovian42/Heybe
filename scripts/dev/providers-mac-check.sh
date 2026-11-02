#!/usr/bin/env bash
# Heybe #16：没有设置界面时，在 Mac 上验收“提供方配置 + 测试连接”。
# 通过本地任务服务接口（/providers/*）完成以下 4 步：
#   ① 从 ~/.heybe-poc.env（必须是 600 权限）读取 DeepSeek key，写入钥匙串并回读比对
#   ② DeepSeek 测试连接（成功路径）
#   ③ Ollama 测试连接，并检查上下文 ≥ 16384
#   ④ 清理测试用的钥匙串条目和临时 FastClaw
# 密钥不打印、不写盘、不出现在任何进程的命令行参数里（只经过 stdin 和子进程 env）。
#
# 用法：
#   scripts/dev/providers-mac-check.sh            # Mac 真实验收
#   scripts/dev/providers-mac-check.sh --mock     # 任意机器干跑（内存钥匙串，FastClaw/Ollama 用假的）
#   可选参数：--yes（不停下来等人确认；better-sqlite3 与当前 node 不匹配时直接 pnpm rebuild）、--skip-ollama
#   可选环境变量：HEYBE_POC_ENV（默认 ~/.heybe-poc.env）、HEYBE_REPORT_DIR（默认 ~/heybe-reports）、
#     HEYBE_OLLAMA_MODEL（默认 qwen2.5:3b）、OLLAMA_URL（默认 http://127.0.0.1:11434）、FASTCLAW_BIN
set -uo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOCK=0 YES=0 SKIP_OLLAMA=0
for a in "$@"; do
  case "$a" in
    --mock) MOCK=1 ;; --yes) YES=1 ;; --skip-ollama) SKIP_OLLAMA=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "未知参数：$a" >&2; exit 2 ;;
  esac
done
YES_FLAG=$YES   # 只有显式 --yes 才自动重建原生模块；非交互只是不等人工确认
[ -t 0 ] || YES=1

G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' N=$'\033[0m'
[ -t 1 ] || { G="" R="" Y="" N=""; }
WORK="$(mktemp -d "${TMPDIR:-/tmp}/heybe-prov-check.XXXXXX")"
STAMP="$(date +%Y%m%d-%H%M%S)"
if [ "$MOCK" = 1 ]; then
  REPORT_DIR="${HEYBE_REPORT_DIR:-${WORK}/report}"
else
  REPORT_DIR="${HEYBE_REPORT_DIR:-$HOME/heybe-reports}"
fi
mkdir -p "$REPORT_DIR"
REPORT="${REPORT_DIR}/providers-mac-check-${STAMP}.md"
KEY_REF="heybe.provider.deepseek.mac-check"
SERVICE="heybe"
OLLAMA_MODEL="${HEYBE_OLLAMA_MODEL:-qwen2.5:3b}"
OLLAMA_URL="${OLLAMA_URL:-http://127.0.0.1:11434}"
PASS=0 FAIL=0 KEY="" TM_PID="" GW_PID=""

line() { printf '%s\n' "$*" >>"$REPORT"; }
ok()   { PASS=$((PASS+1)); printf '%s✓%s %s\n' "$G" "$N" "$1"; line "- ✓ $1"; }
bad()  { FAIL=$((FAIL+1)); printf '%s✗%s %s\n' "$R" "$N" "$1"; line "- ✗ $1"; }
note() { printf '%s•%s %s\n' "$Y" "$N" "$1"; line "  - $1"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s);const r=process.argv[1].split(".").reduce((o,k)=>o==null?o:o[k],v);process.stdout.write(r===undefined?"":typeof r==="object"?JSON.stringify(r):String(r))}catch{process.stdout.write("")}})' "$1"; }
api()  { # api METHOD PATH [body-from-stdin]
  if [ "$1" = GET ] || [ "$1" = DELETE ]; then curl -s -m 120 -X "$1" "http://127.0.0.1:${TM_PORT}$2"
  else curl -s -m 120 -X "$1" -H 'Content-Type: application/json' --data-binary @- "http://127.0.0.1:${TM_PORT}$2"; fi
}
perm() { if [ "$(uname -s)" = Darwin ]; then stat -f %Lp "$1"; else stat -c %a "$1"; fi; }

cleanup() {
  [ -n "$TM_PID" ] && kill "$TM_PID" 2>/dev/null
  [ -n "$GW_PID" ] && kill "$GW_PID" 2>/dev/null
  if [ "$MOCK" = 0 ] && [ -n "${FASTCLAW_HOME:-}" ]; then FASTCLAW_HOME="$FASTCLAW_HOME" "$FC" daemon stop >/dev/null 2>&1; fi
  KEY="" HEYBE_FASTCLAW_CHAT_TOKEN=""
  rm -rf "$WORK"
}
trap cleanup EXIT

{
  echo "# Heybe #16 提供方验收报告"
  echo
  echo "- 时间：$(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "- 模式：$([ "$MOCK" = 1 ] && echo 'mock 干跑' || echo 'Mac 真实')"
  echo "- 机器：$(uname -sm)；commit $(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo '?')"
  echo "- 钥匙串条目：service=${SERVICE} account=${KEY_REF}"
  echo
  echo "## 结果"
} >"$REPORT"

# ---------- 预检 ----------
TSX="${ROOT}/services/task-manager/node_modules/.bin/tsx"
command -v node >/dev/null && command -v curl >/dev/null || { bad "预检：缺少 node 或 curl"; exit 1; }
[ -x "$TSX" ] || { bad "预检：缺少 tsx，请先在仓库根目录执行 pnpm install"; exit 1; }
# shellcheck source=lib-node-check.sh
. "${ROOT}/scripts/dev/lib-node-check.sh"
heybe_node_check "$ROOT" "$YES_FLAG" || { bad "预检：better-sqlite3 和当前 node $(node -v) 不匹配，任务服务起不来（见上面的说明）"; exit 1; }
if [ "$MOCK" = 1 ]; then
  POC_ENV="${WORK}/heybe-poc.env"
  printf 'DEEPSEEK_API_KEY=sk-mock%s\n' "$(od -An -N12 -tx1 /dev/urandom | tr -d ' \n')" >"$POC_ENV"
  chmod 600 "$POC_ENV"
else
  # HEYBE_CHECK_MEMORY_KEYCHAIN=1：非 Mac 上用内存钥匙串跑真实 FastClaw/DeepSeek 链路（开发自测用）
  [ "$(uname -s)" = Darwin ] || [ "${HEYBE_CHECK_MEMORY_KEYCHAIN:-}" = 1 ] || { bad "预检：真实验收只能在 macOS 上运行（box 上请加 --mock）"; exit 1; }
  POC_ENV="${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}"
  FC="${FASTCLAW_BIN:-$(command -v fastclaw || echo "$HOME/.local/bin/fastclaw")}"
  [ -x "$FC" ] || { bad "预检：找不到 fastclaw（可设 FASTCLAW_BIN）"; exit 1; }
fi
[ -f "$POC_ENV" ] || { bad "预检：找不到 ${POC_ENV}"; exit 1; }
P="$(perm "$POC_ENV")"
[ "$P" = 600 ] || { bad "预检：${POC_ENV} 权限是 ${P}，必须是 600（chmod 600 ${POC_ENV}）"; exit 1; }
# shellcheck source=/dev/null # 用户自己的 600 密钥文件，只读 DEEPSEEK_API_KEY
KEY="$(set +u; DEEPSEEK_API_KEY=""; . "$POC_ENV" >/dev/null 2>&1; printf '%s' "${DEEPSEEK_API_KEY:-}")"
[ -n "$KEY" ] || { bad "预检：${POC_ENV} 里没有 DEEPSEEK_API_KEY"; exit 1; }
case "$KEY" in *[!A-Za-z0-9_.-]*) bad "预检：key 含不支持的字符"; exit 1 ;; esac
LAST4="${KEY: -4}"
ok "预检：${POC_ENV} 权限 600，读到 DeepSeek key（不显示）"

# ---------- 启动临时 FastClaw（仅真实模式） + 任务服务 ----------
TM_ENV=(PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}")
if [ "$MOCK" = 0 ]; then
  export FASTCLAW_HOME="${WORK}/fastclaw" FASTCLAW_PORT="${HEYBE_CHECK_FC_PORT:-18997}" FASTCLAW_BIND=loopback
  mkdir -p "$FASTCLAW_HOME"
  # 新数据目录要先 agents init 一次才会有 super_admin，apikey create 才能用。输出里有管理员密码：直接丢弃。
  env -i PATH="$PATH" HOME="$HOME" FASTCLAW_HOME="$FASTCLAW_HOME" "$FC" agents init heybe-bootstrap \
    --provider ollama --model "ollama/${OLLAMA_MODEL}" --api-base "${OLLAMA_URL}/v1" >/dev/null 2>&1 \
    || { bad "临时 FastClaw 初始化（agents init）失败"; exit 1; }
  env -i PATH="$PATH" HOME="$HOME" FASTCLAW_HOME="$FASTCLAW_HOME" FASTCLAW_PORT="$FASTCLAW_PORT" FASTCLAW_BIND=loopback \
    "$FC" gateway --port "$FASTCLAW_PORT" >"${WORK}/gateway.log" 2>&1 &
  GW_PID=$!
  for _ in $(seq 60); do curl -s -o /dev/null -m1 "http://127.0.0.1:${FASTCLAW_PORT}/healthz" && break; sleep 0.5; done
  out="$(env -i PATH="$PATH" HOME="$HOME" FASTCLAW_HOME="$FASTCLAW_HOME" "$FC" apikey create --name heybe-mac-check --type user 2>&1)"
  HEYBE_FASTCLAW_CHAT_TOKEN="$(printf '%s' "$out" | sed -n 's/^token:[[:space:]]*//p' | head -1 | tr -d '\r\n')"; out=""
  [ -n "$HEYBE_FASTCLAW_CHAT_TOKEN" ] || { bad "临时 FastClaw 启动失败：$(tail -n 2 "${WORK}/gateway.log" | tr '\n' ' ')"; exit 1; }
  TM_ENV+=(FASTCLAW_HOME="$FASTCLAW_HOME" FASTCLAW_PORT="$FASTCLAW_PORT" FASTCLAW_BIND=loopback FASTCLAW_BIN="$FC"
    HEYBE_FASTCLAW_BASE_URL="http://127.0.0.1:${FASTCLAW_PORT}" HEYBE_FASTCLAW_CHAT_TOKEN="$HEYBE_FASTCLAW_CHAT_TOKEN"
    HEYBE_KEYCHAIN_SERVICE="$SERVICE" HEYBE_PROVIDERS_MEMORY_KEYCHAIN="${HEYBE_CHECK_MEMORY_KEYCHAIN:-}")
  note "临时 FastClaw：127.0.0.1:${FASTCLAW_PORT}，数据目录在临时目录，结束后删除"
else
  TM_ENV+=(HEYBE_PROVIDERS_MOCK=1 HEYBE_OLLAMA_MODEL="$OLLAMA_MODEL" HEYBE_MOCK_OLLAMA_CTX="${HEYBE_MOCK_OLLAMA_CTX:-16384}")
fi
( cd "${ROOT}/services/task-manager" && exec env -i "${TM_ENV[@]}" "$TSX" dev/providers-server.ts ) >"${WORK}/tm.out" 2>"${WORK}/tm.err" &
TM_PID=$!
TM_PORT=""
for _ in $(seq 80); do TM_PORT="$(sed -n 's/^PORT=//p' "${WORK}/tm.out" 2>/dev/null)"; [ -n "$TM_PORT" ] && break; sleep 0.25; done
[ -n "$TM_PORT" ] || { bad "任务服务没起来：$(tail -n 3 "${WORK}/tm.err" | tr '\n' ' ')"; exit 1; }
ok "任务服务已启动：127.0.0.1:${TM_PORT}（/providers/*）"

# ---------- ① 写入钥匙串并回读 ----------
line ""; line "### ① 钥匙串写入与回读"
st="$(printf '{"value":"%s"}' "$KEY" | api PUT "/providers/keys/${KEY_REF}")"
if [ "$(printf '%s' "$st" | json set)" = true ] && [ "$(printf '%s' "$st" | json last4)" = "$LAST4" ]; then ok "PUT /providers/keys：已写入，返回只有 set 和 last4（****${LAST4}）"
else bad "PUT /providers/keys 失败：$(printf '%s' "$st" | json error)"; fi
m="$(printf '{"value":"%s"}' "$KEY" | api POST "/providers/keys/${KEY_REF}/verify" | json match)"
[ "$m" = true ] && ok "回读比对：钥匙串里的值与 ~/.heybe-poc.env 一致" || bad "回读比对不一致"
if [ "$MOCK" = 0 ] && [ -x /usr/bin/security ]; then
  if /usr/bin/security find-generic-password -s "$SERVICE" -a "$KEY_REF" >/dev/null 2>&1; then ok "security 能找到条目 ${SERVICE} / ${KEY_REF}"; else bad "security 找不到条目"; fi
  if [ "$YES" = 0 ] && [ -x /usr/bin/security ]; then
    printf '%s请打开“钥匙串访问”→ 登录 → 搜索 heybe，确认有名称为 %s、账户为 %s 的条目。看到了按 y，没看到按 n：%s' "$Y" "$SERVICE" "$KEY_REF" "$N"
    read -r ans
    case "$ans" in y|Y) ok "人工确认：钥匙串访问里能看到 heybe 条目" ;; *) bad "人工确认：钥匙串访问里没看到 heybe 条目" ;; esac
  else note "未做人工确认（--yes 或非交互）：请自行在钥匙串访问里搜索 heybe"; fi
else note "内存钥匙串（mock 或 HEYBE_CHECK_MEMORY_KEYCHAIN），跳过 security 和人工确认"; fi

# ---------- ② DeepSeek 测试连接 ----------
line ""; line "### ② DeepSeek 测试连接"
r="$(printf '{"id":"deepseek","kind":"deepseek","baseUrl":"https://api.deepseek.com","model":"deepseek-chat","keyRef":"%s"}' "$KEY_REF" | api POST /providers/test)"
code="$(printf '%s' "$r" | json code)"; msg="$(printf '%s' "$r" | json message)"; lat="$(printf '%s' "$r" | json latencyMs)"
if [ "$code" = ok ]; then ok "DeepSeek 测试连接成功（${lat} ms）"; else bad "DeepSeek 测试连接：${code:-无响应} ${msg}（上游状态 $(printf '%s' "$r" | json detail.status)）"; fi

# ---------- ③ Ollama ----------
line ""; line "### ③ Ollama 测试连接与上下文"
if [ "$SKIP_OLLAMA" = 1 ]; then note "已跳过（--skip-ollama）"
else
  if [ "$MOCK" = 0 ] && ! curl -s -m 3 -o /dev/null "${OLLAMA_URL}/api/tags"; then note "Ollama 没在 ${OLLAMA_URL} 运行，下面应得到 ollama_not_running"; fi
  r="$(printf '{"id":"ollama","kind":"ollama","baseUrl":"%s/v1","model":"%s"}' "$OLLAMA_URL" "$OLLAMA_MODEL" | api POST /providers/test)"
  code="$(printf '%s' "$r" | json code)"; st="$(printf '%s' "$r" | json status)"; msg="$(printf '%s' "$r" | json message)"
  if [ "$code" = ok ]; then ok "Ollama（${OLLAMA_MODEL}）测试连接成功，上下文 ≥ 16384"
  elif [ "$code" = context_too_small ]; then bad "Ollama 能回复，但上下文不足：${msg}"
  else bad "Ollama 测试连接：${code:-无响应}（${st}）${msg}"; fi
  if [ "$MOCK" = 0 ]; then
    ctx="$(curl -s -m 3 "${OLLAMA_URL}/api/ps" | json models.0.context_length)"
    note "/api/ps 当前上下文：${ctx:-未知}"
  fi
fi

# ---------- ④ 清理 ----------
line ""; line "### ④ 清理"
api DELETE "/providers/keys/${KEY_REF}" >/dev/null
[ "$(api GET "/providers/keys/${KEY_REF}" | json set)" = false ] && ok "测试条目已从钥匙串删除（接口回读 set=false）" || bad "测试条目删除失败"
if [ "$MOCK" = 0 ] && [ -x /usr/bin/security ]; then
  if /usr/bin/security find-generic-password -s "$SERVICE" -a "$KEY_REF" >/dev/null 2>&1; then bad "security 仍能找到条目，请在钥匙串访问里手动删除 ${KEY_REF}"; else ok "security 确认条目已不存在"; fi
fi
kill "$TM_PID" 2>/dev/null; TM_PID=""
ok "已停止任务服务${MOCK:+}$([ "$MOCK" = 0 ] && echo '和临时 FastClaw（探测 Agent 随临时数据目录一起删除）')"

# ---------- 报告 ----------
{
  echo
  echo "## 汇总"
  echo "- 通过 ${PASS}，失败 ${FAIL}"
  echo "- 本报告不含任何密钥，只含后 4 位。"
} >>"$REPORT"
chmod 600 "$REPORT"
if grep -qF -- "$KEY" "$REPORT" || { [ -n "${HEYBE_FASTCLAW_CHAT_TOKEN:-}" ] && grep -qF -- "$HEYBE_FASTCLAW_CHAT_TOKEN" "$REPORT"; }; then
  rm -f "$REPORT"; bad "报告里检测到密钥，已删除报告"; exit 1
fi
KEY=""
echo
if [ "$MOCK" = 1 ] && [ -z "${HEYBE_REPORT_DIR:-}" ]; then cat "$REPORT"; echo "（mock 报告位于临时目录，退出时删除；设 HEYBE_REPORT_DIR 可保留）"
else echo "报告：${REPORT}"; fi
[ "$FAIL" = 0 ] && { printf '%s全部通过%s\n' "$G" "$N"; exit 0; } || { printf '%s有 %s 项失败%s\n' "$R" "$FAIL" "$N"; exit 1; }
