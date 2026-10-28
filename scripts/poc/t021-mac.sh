#!/usr/bin/env bash
# T0.2.1 真机核验：DeepSeek 经 FastClaw v1.4.0 /v1 流式对话，一条命令跑完。
# 用法: scripts/poc/t021-mac.sh [all|cleanup]
#   all（默认）  预检 → 装/复用 FastClaw v1.4.0 → 独立 FASTCLAW_HOME 启动 gateway → agents init(DeepSeek)
#               → 自动生成 apikey（只写 600 文件）→ pnpm install → 跑 deepseek-min-chat.ts → 写报告 → 停 gateway
#   cleanup      停 gateway；PURGE=1 时再删除 ${T021_HOME}（含 apikey 文件）
# 密钥：DEEPSEEK_API_KEY 从 ${HEYBE_POC_ENV:-~/.heybe-poc.env} 读取（必须 600）；FastClaw apikey 自动生成。
#       两者都不会打印、不写日志、不进报告。
# 报告：${T021_HOME}/t021-report.txt（可直接回传）；最后一行 "T021 RESULT: ..." 也会打印在终端。
# 兼容 macOS 自带 bash 3.2：路径展开一律 ${VAR}。
set -euo pipefail
umask 077

FASTCLAW_VERSION="v1.4.0"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib-fc-env.sh
. "${REPO_ROOT}/scripts/poc/lib-fc-env.sh"
POC_ENV="${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}"
T021_HOME="${HEYBE_T021_HOME:-$HOME/.local/opt/heybe-t021}"
FC_HOME="${T021_HOME}/fastclaw-home"
FC_BIN_DIR="$HOME/.local/opt/fastclaw/bin"            # 与 boxlite-poc.sh 共用安装位置
PORT="${HEYBE_T021_PORT:-18963}"                       # 避开默认 18953 与沙箱 PoC
AGENT="${HEYBE_T021_AGENT:-heybe-t021}"
MODEL="${HEYBE_T021_MODEL:-deepseek/deepseek-v4-flash}"
KEY_FILE="${T021_HOME}/fastclaw-apikey"
LOG="${T021_HOME}/t021.log"
REPORT="${T021_HOME}/t021-report.txt"
PID_FILE="${T021_HOME}/gateway.pid"

mkdir -p "${T021_HOME}" "${FC_HOME}"
export PATH="${FC_BIN_DIR}:$PATH"

STEP="precheck"
result() { # status code
  local line="T021 RESULT: $1 step=${STEP} code=$2"
  { echo "$line"; echo "time=$(date '+%F %T %Z') os=$(uname -s)-$(uname -m) fastclaw=$(fastclaw version 2>/dev/null | head -1 | tr ' ' '_' || echo none)"; } >>"${REPORT}"
  echo "$line"
}
die() { # code message
  printf '\033[31m失败\033[0m [%s] %s\n' "$1" "$2" >&2
  result FAIL "$1"; stop_gateway; exit 1
}
ok() { printf '\033[32m通过\033[0m %s\n' "$*"; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

stop_gateway() {
  if [ -f "${PID_FILE}" ]; then kill "$(cat "${PID_FILE}")" 2>/dev/null || true; rm -f "${PID_FILE}"; fi
}

load_deepseek() {
  [ -f "${POC_ENV}" ] || die E_ENV_MISSING "找不到 ${POC_ENV}"
  [ "$(file_mode "${POC_ENV}")" = 600 ] || die E_ENV_PERM "${POC_ENV} 权限必须是 600"
  local v; v=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DEEPSEEK_API_KEY=//p' "${POC_ENV}" | tail -1)
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  [ -n "$v" ] || die E_ENV_EMPTY "${POC_ENV} 里没有 DEEPSEEK_API_KEY="
  export DEEPSEEK_API_KEY="$v"
}

install_fastclaw() {
  STEP="fastclaw"
  if command -v fastclaw >/dev/null 2>&1 && fastclaw version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}"; then
    ok "复用已装的 FastClaw ${FASTCLAW_VERSION}（$(command -v fastclaw)）"; return 0
  fi
  local os arch; os=$(uname -s | tr 'A-Z' 'a-z'); arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64; [ "$arch" = aarch64 ] && arch=arm64
  local url="https://github.com/fastclaw-ai/fastclaw/releases/download/${FASTCLAW_VERSION}/fastclaw_${os}_${arch}.tar.gz"
  local tmp; tmp=$(mktemp -d); mkdir -p "${FC_BIN_DIR}"
  curl -fsSL "$url" -o "${tmp}/fc.tgz" >>"${LOG}" 2>&1 || die E_DOWNLOAD "下载 FastClaw 失败（网络或 GitHub 不可达）"
  tar -xzf "${tmp}/fc.tgz" -C "${tmp}" && install -m 755 "$(find "${tmp}" -type f -name fastclaw | head -1)" "${FC_BIN_DIR}/fastclaw" \
    || die E_DOWNLOAD "解压 FastClaw 失败"
  rm -rf "${tmp}"
  fastclaw version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}" || die E_VERSION "FastClaw 版本不是 ${FASTCLAW_VERSION}"
  ok "FastClaw ${FASTCLAW_VERSION} 已安装到 ${FC_BIN_DIR}"
}

step_all() {
  : >"${REPORT}"; : >"${LOG}"
  STEP="precheck"
  command -v curl >/dev/null || die E_NO_CURL "缺少 curl"
  command -v node >/dev/null || die E_NO_NODE "缺少 Node.js（需要 20 或更新）"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die E_NODE_OLD "Node.js 版本低于 20"
  if ! command -v pnpm >/dev/null 2>&1; then
    command -v corepack >/dev/null && corepack enable >>"${LOG}" 2>&1 || true
    command -v pnpm >/dev/null 2>&1 || die E_NO_PNPM "缺少 pnpm（可运行 npm i -g pnpm）"
  fi
  load_deepseek
  ok "预检：node $(node -v)、pnpm、${POC_ENV} 权限 600"

  install_fastclaw

  STEP="gateway"
  export FASTCLAW_HOME="${FC_HOME}" FASTCLAW_PORT="${PORT}"
  stop_gateway
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz"; then die E_PORT_BUSY "端口 ${PORT} 已被占用（可设 HEYBE_T021_PORT 换端口）"; fi
  # gateway 只拿白名单环境变量（不含 DEEPSEEK_API_KEY；MCP/插件会继承 gateway 的环境）
  fc_env_bg "${PID_FILE}" "" nohup fastclaw >"${T021_HOME}/gateway.log" 2>&1
  local i; for i in $(seq 1 30); do curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz" && break; sleep 1; done
  curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz" || die E_GATEWAY "FastClaw 30 秒内没起来"
  ok "FastClaw gateway 已在 127.0.0.1:${PORT} 启动（独立数据目录）"

  STEP="agent"
  # init 输出可能含自动生成的控制台密码：只留在内存，不落盘；key 只传给这一次 init
  local init_out init_rc=0
  init_out=$(fc_env_exec DEEPSEEK_API_KEY fastclaw agents init "${AGENT}" --provider deepseek --model "${MODEL}" --api-key-env DEEPSEEK_API_KEY 2>&1) || init_rc=$?
  init_out=""
  unset DEEPSEEK_API_KEY
  fc_lock_home "${FC_HOME}"
  [ "${init_rc}" = 0 ] || die E_AGENT_INIT "agents init 失败（退出码 ${init_rc}）"
  ok "Agent ${AGENT} 已配置 DeepSeek（${MODEL}）"

  STEP="apikey"
  if [ ! -s "${KEY_FILE}" ]; then
    local out
    out=$(fastclaw apikey create --name heybe-t021 --type user 2>&1) || die E_APIKEY "apikey create 失败"
    ( umask 077; printf '%s' "$out" | sed -n 's/^token:[[:space:]]*//p' | head -1 | tr -d '\r\n' >"${KEY_FILE}" )
    out=""
    [ -s "${KEY_FILE}" ] || { rm -f "${KEY_FILE}"; die E_APIKEY_PARSE "没能从输出里取到 apikey"; }
    chmod 600 "${KEY_FILE}"
  fi
  ok "FastClaw apikey 已写入 ${KEY_FILE}（600，未显示）"

  STEP="deps"
  ( cd "${REPO_ROOT}" && pnpm install --frozen-lockfile ) >>"${LOG}" 2>&1 || die E_DEPS "pnpm install 失败"
  ok "依赖已安装"

  STEP="chat"
  local json rc=0 agent_id
  agent_id=$(fastclaw agents list 2>/dev/null | grep -o 'agt_[A-Za-z0-9_-]*' | head -1 || true)
  json=$( cd "${REPO_ROOT}" && env -u DEEPSEEK_API_KEY \
      HEYBE_FASTCLAW_BASE_URL="http://127.0.0.1:${PORT}" \
      HEYBE_FASTCLAW_CHAT_TOKEN="$(cat "${KEY_FILE}")" \
      ${agent_id:+HEYBE_FASTCLAW_AGENT_ID=$agent_id} \
      pnpm dlx tsx scripts/poc/deepseek-min-chat.ts 2>>"${LOG}" ) || rc=$?
  printf '%s\n' "$json" >"${T021_HOME}/chat.json"
  local summary
  summary=$(printf '%s' "$json" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const r=JSON.parse(s);const f=k=>r[k]===null||r[k]===undefined?"null":String(r[k]);
        console.log(["stream_ok","first_token_ms","total_ms","request_model","response_model","model_echo_matches_request","error_code","error_kind","error_status"].map(k=>k+"="+f(k)).join(" "));
      }catch{console.log("parse_error=1")}});')
  echo "${summary}" >>"${REPORT}"
  stop_gateway
  if [ "$rc" = 0 ]; then
    STEP="done"; ok "流式对话成功：${summary}"; result PASS none
  else
    local code; code=$(printf '%s' "${summary}" | sed -n 's/.*error_code=\([^ ]*\).*/\1/p'); code=${code:-unknown}
    die "E_CHAT_${code}" "对话未成功：${summary}"
  fi
  echo "报告：${REPORT}"
}

case "${1:-all}" in
  all) step_all ;;
  cleanup) stop_gateway; [ "${PURGE:-0}" = 1 ] && rm -rf "${T021_HOME}"; echo "已清理" ;;
  *) sed -n 2,10p "$0"; exit 2 ;;
esac
