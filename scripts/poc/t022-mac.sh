#!/usr/bin/env bash
# T0.2.2 真机核验：Ollama 本地模型经 FastClaw v1.4.0 /v1，断网后 3 轮流式对话（#5）。
# 用法: scripts/poc/t022-mac.sh [all|chat|cleanup]
#   all（默认）  联网阶段：预检 → 起/复用 Ollama → 拉模型并预热 → 装/复用 FastClaw v1.4.0
#               → 独立 FASTCLAW_HOME 启动 gateway → agents init(--provider ollama) → 生成 apikey（只写 600 文件）
#               → 装依赖和 tsx（离线时要用）
#               断网阶段：提示断网并检测外网不可达 → 同一会话 3 轮流式对话（第 3 轮问第 1 轮的暗号）→ 写报告 → 停进程
#   chat         只重跑断网阶段（要求之前 all 至少把联网阶段跑完）
#   cleanup      停 gateway 和本脚本起的 ollama；PURGE=1 时再删除 ${T022_HOME}（含 apikey 文件；不删已下载的模型）
# 环境变量：HEYBE_T022_MODEL（默认 qwen2.5:3b）、HEYBE_T022_PORT（默认 18973）、HEYBE_T022_HOME、
#           HEYBE_T022_OLLAMA_HOST（默认 127.0.0.1:11435，本脚本自己起的 ollama serve，不碰 Ollama.app 的 11434）、
#           HEYBE_T022_NUM_CTX（默认 16384）、HEYBE_T022_SKIP_OFFLINE_CHECK=1（不等断网，报告记 offline=false）
# 为什么自己起 ollama serve：FastClaw 每轮发给模型的系统提示+工具定义约 1.1 万 token，Ollama 默认上下文只有 2k–4k，
#   会把前面截掉（含上一轮对话）。只有 serve 进程的 OLLAMA_CONTEXT_LENGTH 能调大（/v1 请求里没法传 num_ctx）。
# 密钥：不需要任何云端密钥。FastClaw apikey 自动生成，只写 600 文件；agents init 输出（可能含管理员密码）不显示不落盘。
# 报告：${T022_HOME}/t022-report.txt（可直接回传）；最后的 "T022 RESULT: ..." 也会打印在终端。
# 范围：不验证工具调用（T0.2.2 范围外）。兼容 macOS 自带 bash 3.2：路径展开一律 ${VAR}。
set -euo pipefail
umask 077

FASTCLAW_VERSION="v1.4.0"
TSX_VERSION="4.19.2"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib-fc-env.sh
. "${REPO_ROOT}/scripts/poc/lib-fc-env.sh"
T022_HOME="${HEYBE_T022_HOME:-${HOME}/.local/opt/heybe-t022}"
FC_HOME="${T022_HOME}/fastclaw-home"
FC_BIN_DIR="${HOME}/.local/opt/fastclaw/bin"           # 与 t021 / boxlite-poc.sh 共用安装位置
PORT="${HEYBE_T022_PORT:-18973}"                       # 避开默认 18953、t021 的 18963
AGENT="${HEYBE_T022_AGENT:-heybe-t022}"
MODEL="${HEYBE_T022_MODEL:-qwen2.5:3b}"
OLLAMA_ADDR="${HEYBE_T022_OLLAMA_HOST:-127.0.0.1:11435}"
NUM_CTX="${HEYBE_T022_NUM_CTX:-16384}"
OLLAMA_URL="http://${OLLAMA_ADDR}"
KEY_FILE="${FC_HOME}/heybe-t022-apikey"                 # 放在 FC_HOME 里：数据目录重建时 key 一起失效重建
LOG="${T022_HOME}/t022.log"
REPORT="${T022_HOME}/t022-report.txt"
PID_FILE="${T022_HOME}/gateway.pid"
OLLAMA_PID_FILE="${T022_HOME}/ollama.pid"
TSX_DIR="${T022_HOME}/tools"
TSX_BIN="${TSX_DIR}/node_modules/.bin/tsx"

mkdir -p "${T022_HOME}" "${FC_HOME}"
export PATH="${FC_BIN_DIR}:${PATH}"

STEP="precheck"
OFFLINE="unknown"
OFFLINE_CHECK="pending"
OLLAMA_BIN=""

ollama_version() { curl -s --noproxy '*' -m 3 "${OLLAMA_URL}/api/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'; }
result() { # status code
  local line="T022 RESULT: $1 step=${STEP} code=$2"
  {
    echo "offline=${OFFLINE} offline_check=${OFFLINE_CHECK} model=ollama/${MODEL} num_ctx=${NUM_CTX} prompt_truncated=$(prompt_truncated) ollama=$(ollama_version || true)"
    echo "$line"
    echo "time=$(date '+%F %T %Z') os=$(uname -s)-$(uname -m) fastclaw=$(fastclaw version 2>/dev/null | head -1 | tr ' ' '_' || echo none)"
  } >>"${REPORT}"
  echo "$line"
}
die() { # code message
  printf '\033[31m失败\033[0m [%s] %s\n' "$1" "$2" >&2
  result FAIL "$1"; stop_all; exit 1
}
ok() { printf '\033[32m通过\033[0m %s\n' "$*"; }
note() { printf '\033[33m提示\033[0m %s\n' "$*"; }

stop_gateway() {
  if [ -f "${PID_FILE}" ]; then kill "$(cat "${PID_FILE}")" 2>/dev/null || true; rm -f "${PID_FILE}"; fi
}
stop_ollama() { # 只停本脚本起的 ollama serve；Ollama.app / brew services 起的（11434）不动
  if [ -f "${OLLAMA_PID_FILE}" ]; then kill "$(cat "${OLLAMA_PID_FILE}")" 2>/dev/null || true; rm -f "${OLLAMA_PID_FILE}"; fi
}
stop_all() { stop_gateway; stop_ollama; }
# Ctrl-C / 被杀时也停掉本脚本起的 gateway 和 ollama（正常结束和 die 已各自 stop_all）
trap 'stop_all; exit 130' INT TERM

# 有任一外网地址能连上就算“在线”。只发 HEAD/小请求，不带任何凭据。
is_online() {
  local u
  for u in https://www.apple.com/library/test/success.html https://www.baidu.com https://1.1.1.1 https://github.com; do
    if curl -s -o /dev/null -m 4 "$u" 2>/dev/null; then return 0; fi
  done
  return 1
}

find_ollama() {
  if command -v ollama >/dev/null 2>&1; then OLLAMA_BIN="$(command -v ollama)"
  elif [ -x /Applications/Ollama.app/Contents/Resources/ollama ]; then OLLAMA_BIN=/Applications/Ollama.app/Contents/Resources/ollama
  else return 1; fi
}

prompt_truncated() { # 只看本脚本起的 serve 的日志
  if [ ! -s "${T022_HOME}/ollama.log" ]; then echo unknown
  elif grep -q 'truncating input prompt' "${T022_HOME}/ollama.log"; then echo true
  else echo false; fi
}
ollama_up() { curl -s --noproxy '*' -o /dev/null -m 2 "${OLLAMA_URL}/api/version"; }

start_ollama() {
  STEP="ollama"
  if ollama_up; then ok "复用已在运行的 Ollama（${OLLAMA_URL}，版本 $(ollama_version)）"; return 0; fi
  : >"${T022_HOME}/ollama.log"
  [ -n "${OLLAMA_BIN}" ] || find_ollama || die E_NO_OLLAMA "没找到 ollama（brew install ollama，或从 ollama.com 装 Ollama.app）"
  export OLLAMA_HOST="${OLLAMA_ADDR}" OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}" OLLAMA_CONTEXT_LENGTH="${NUM_CTX}"
  fc_env_bg "${OLLAMA_PID_FILE}" "OLLAMA_HOST OLLAMA_KEEP_ALIVE OLLAMA_CONTEXT_LENGTH OLLAMA_MODELS" nohup "${OLLAMA_BIN}" serve >"${T022_HOME}/ollama.log" 2>&1
  local _i; for _i in $(seq 1 30); do ollama_up && break; sleep 1; done
  ollama_up || die E_OLLAMA_START "Ollama 30 秒内没起来（看 ${T022_HOME}/ollama.log）"
  ok "Ollama 已在 ${OLLAMA_URL} 启动（版本 $(ollama_version)，上下文 ${NUM_CTX}）"
}

model_present() {
  local want="${MODEL}"
  case "${want}" in *:*) ;; *) want="${want}:latest" ;; esac
  OLLAMA_HOST="${OLLAMA_ADDR}" "${OLLAMA_BIN}" list 2>/dev/null | awk 'NR>1{print $1}' | grep -Fqx "${want}"
}

warm_model() { # 直接问 Ollama 一次，先把模型载入内存；失败多半是内存不够或模型损坏
  local body="{\"model\":\"${MODEL}\",\"prompt\":\"hi\",\"stream\":false,\"options\":{\"num_predict\":1}}"
  curl -s --noproxy '*' -f -m 600 -H 'Content-Type: application/json' -d "${body}" "${OLLAMA_URL}/api/generate" >>"${LOG}" 2>&1
}

install_fastclaw() {
  STEP="fastclaw"
  if command -v fastclaw >/dev/null 2>&1 && fastclaw version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}"; then
    ok "复用已装的 FastClaw ${FASTCLAW_VERSION}（$(command -v fastclaw)）"; return 0
  fi
  local os arch; os=$(uname -s | tr '[:upper:]' '[:lower:]'); arch=$(uname -m); [ "$arch" = x86_64 ] && arch=amd64; [ "$arch" = aarch64 ] && arch=arm64
  local url="https://github.com/fastclaw-ai/fastclaw/releases/download/${FASTCLAW_VERSION}/fastclaw_${os}_${arch}.tar.gz"
  local tmp; tmp=$(mktemp -d); mkdir -p "${FC_BIN_DIR}"
  curl -fsSL "$url" -o "${tmp}/fc.tgz" >>"${LOG}" 2>&1 || die E_DOWNLOAD "下载 FastClaw 失败（网络或 GitHub 不可达）"
  tar -xzf "${tmp}/fc.tgz" -C "${tmp}" && install -m 755 "$(find "${tmp}" -type f -name fastclaw | head -1)" "${FC_BIN_DIR}/fastclaw" \
    || die E_DOWNLOAD "解压 FastClaw 失败"
  rm -rf "${tmp}"
  fastclaw version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}" || die E_VERSION "FastClaw 版本不是 ${FASTCLAW_VERSION}"
  ok "FastClaw ${FASTCLAW_VERSION} 已安装到 ${FC_BIN_DIR}"
}

start_gateway() {
  STEP="gateway"
  export FASTCLAW_HOME="${FC_HOME}" FASTCLAW_PORT="${PORT}"
  stop_gateway
  if curl -s --noproxy '*' -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz"; then die E_PORT_BUSY "端口 ${PORT} 已被占用（可设 HEYBE_T022_PORT 换端口）"; fi
  fc_env_bg "${PID_FILE}" "" nohup fastclaw >"${T022_HOME}/gateway.log" 2>&1
  local _i; for _i in $(seq 1 30); do curl -s --noproxy '*' -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz" && break; sleep 1; done
  curl -s --noproxy '*' -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz" || die E_GATEWAY "FastClaw 30 秒内没起来"
  ok "FastClaw gateway 已在 127.0.0.1:${PORT} 启动（独立数据目录）"
}

phase_online() {
  : >"${REPORT}"; : >"${LOG}"
  STEP="precheck"
  command -v curl >/dev/null || die E_NO_CURL "缺少 curl"
  command -v node >/dev/null || die E_NO_NODE "缺少 Node.js（需要 20 或更新）"
  [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die E_NODE_OLD "Node.js 版本低于 20"
  command -v npm >/dev/null || die E_NO_NODE "缺少 npm"
  if ! command -v pnpm >/dev/null 2>&1; then
    command -v corepack >/dev/null && corepack enable >>"${LOG}" 2>&1 || true
    command -v pnpm >/dev/null 2>&1 || die E_NO_PNPM "缺少 pnpm（可运行 npm i -g pnpm）"
  fi
  find_ollama || die E_NO_OLLAMA "没找到 ollama（brew install ollama，或从 ollama.com 装 Ollama.app）"
  local mem_gb=""
  mem_gb=$(sysctl -n hw.memsize 2>/dev/null | awk '{printf "%d", $1/1073741824}' || true)
  [ -n "${mem_gb}" ] && [ "${mem_gb}" -lt 8 ] && note "内存只有 ${mem_gb} GB，${MODEL} 可能很慢；可设 HEYBE_T022_MODEL=qwen2.5:1.5b"
  ok "预检：node $(node -v)、pnpm、ollama（${OLLAMA_BIN}）"

  start_ollama

  STEP="model"
  if model_present; then
    ok "模型 ${MODEL} 已在本机"
  else
    note "正在下载 ${MODEL}（约 2 GB，视网速几分钟）…"
    OLLAMA_HOST="${OLLAMA_ADDR}" "${OLLAMA_BIN}" pull "${MODEL}" >>"${LOG}" 2>&1 || die E_PULL "ollama pull ${MODEL} 失败（网络或模型名不对）"
    model_present || die E_PULL "拉取后仍找不到 ${MODEL}"
    ok "模型 ${MODEL} 已下载"
  fi
  STEP="warmup"
  warm_model || die E_OLLAMA_MODEL "Ollama 直接调用 ${MODEL} 失败（多半是内存不够；看 ${T022_HOME}/ollama.log）"
  ok "Ollama 直接调用 ${MODEL} 成功（已载入内存）"

  install_fastclaw
  start_gateway

  STEP="agent"
  # 不需要任何模型密钥：FastClaw 对 ollama 自动填占位 key "ollama"（internal/agentcli/agentcli.go:557–563）。
  # init 输出可能含自动生成的控制台密码：只留在内存，不落盘。
  local init_rc=0
  fc_env_exec "" fastclaw agents init "${AGENT}" --provider ollama --model "ollama/${MODEL}" --api-base "${OLLAMA_URL}/v1" >/dev/null 2>&1 || init_rc=$?
  fc_lock_home "${FC_HOME}"
  [ "${init_rc}" = 0 ] || die E_AGENT_INIT "agents init 失败（退出码 ${init_rc}）"
  ok "Agent ${AGENT} 已配置 ollama/${MODEL}（${OLLAMA_URL}/v1）"

  STEP="apikey"
  if [ ! -s "${KEY_FILE}" ]; then
    local out
    out=$(fastclaw apikey create --name heybe-t022 --type user 2>&1) || die E_APIKEY "apikey create 失败"
    ( umask 077; printf '%s' "$out" | sed -n 's/^token:[[:space:]]*//p' | head -1 | tr -d '\r\n' >"${KEY_FILE}" )
    out=""
    [ -s "${KEY_FILE}" ] || { rm -f "${KEY_FILE}"; die E_APIKEY_PARSE "没能从输出里取到 apikey"; }
    chmod 600 "${KEY_FILE}"
  fi
  ok "FastClaw apikey 已写入 ${KEY_FILE}（600，未显示）"

  STEP="deps"
  ( cd "${REPO_ROOT}" && pnpm install --frozen-lockfile ) >>"${LOG}" 2>&1 || die E_DEPS "pnpm install 失败"
  if [ ! -x "${TSX_BIN}" ]; then
    npm install --prefix "${TSX_DIR}" --no-audit --no-fund "tsx@${TSX_VERSION}" >>"${LOG}" 2>&1 || die E_DEPS "安装 tsx 失败"
  fi
  ok "依赖已安装（tsx 已装到本地，断网也能用）"
}

wait_offline() {
  STEP="offline"
  if [ "${HEYBE_T022_SKIP_OFFLINE_CHECK:-0}" = 1 ]; then
    OFFLINE_CHECK="skipped"
    if is_online; then OFFLINE=false; else OFFLINE=true; fi
    note "已跳过断网检测（HEYBE_T022_SKIP_OFFLINE_CHECK=1），offline=${OFFLINE}；这次结果不能算 #5 验收"
    return 0
  fi
  local tries=0
  while is_online; do
    tries=$((tries + 1))
    [ "${tries}" -le 3 ] || { OFFLINE=false; OFFLINE_CHECK=failed; die E_STILL_ONLINE "仍能访问外网（请关 Wi-Fi、拔网线、关手机热点/VPN 后用 chat 子命令重跑）"; }
    printf '\n\033[1m>>> 现在请断网：点屏幕右上角 Wi-Fi 图标把 Wi-Fi 关掉（插网线的把网线拔掉）。\033[0m\n'
    if [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; then
      printf '>>> 断好后按回车继续（第 %s/3 次检查）… ' "${tries}"
      read -r _ </dev/tty || true
    else
      printf '>>> 没有交互终端，60 秒后再检查（第 %s/3 次）…\n' "${tries}"
      sleep 60
    fi
  done
  OFFLINE=true; OFFLINE_CHECK="done"
  ok "外网已不可达（offline=true），以下全部在断网状态下进行"
}

phase_offline() {
  [ -s "${KEY_FILE}" ] && [ -x "${TSX_BIN}" ] || { STEP="chat"; die E_NOT_PREPARED "联网阶段还没跑完，请先联网运行 all"; }
  [ -n "${OLLAMA_BIN}" ] || find_ollama || true
  wait_offline
  start_ollama
  if [ ! -f "${PID_FILE}" ] || ! curl -s --noproxy '*' -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz"; then start_gateway; fi

  STEP="chat"
  local json rc=0 agent_id
  agent_id=$(FASTCLAW_HOME="${FC_HOME}" fastclaw agents list 2>/dev/null | grep -o 'agt_[A-Za-z0-9_-]*' | head -1 || true)
  note "开始 3 轮对话（本地模型，首轮可能要几十秒）…"
  json=$( cd "${REPO_ROOT}" && env \
      HEYBE_FASTCLAW_BASE_URL="http://127.0.0.1:${PORT}" \
      HEYBE_FASTCLAW_CHAT_TOKEN="$(cat "${KEY_FILE}")" \
      ${agent_id:+HEYBE_FASTCLAW_AGENT_ID=$agent_id} \
      "${TSX_BIN}" scripts/poc/t022-multiturn-chat.ts 2>>"${LOG}" ) || rc=$?
  printf '%s\n' "$json" >"${T022_HOME}/chat.json"
  local summary
  summary=$(printf '%s' "$json" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      try{const r=JSON.parse(s);const v=x=>x===null||x===undefined?"null":String(x);
        for(const t of r.turns||[])console.log(["turn="+t.turn,"stream_ok="+v(t.stream_ok),"first_token_ms="+v(t.first_token_ms),"total_ms="+v(t.total_ms),"reply_chars="+v(t.reply_chars),"tool_events="+v(t.tool_events),"error_code="+v(t.error_code)].join(" "));
        console.log("recall_ok="+v(r.recall_ok)+" error_code="+v(r.error_code));
      }catch{console.log("parse_error=1 error_code=parse_error")}});')
  printf '%s\n' "${summary}" >>"${REPORT}"
  printf '%s\n' "${summary}"
  if [ "$rc" = 0 ]; then
    STEP="done"; ok "断网 3 轮流式对话成功，第 3 轮记得第 1 轮的暗号"; result PASS none
  else
    local code; code=$(printf '%s' "${summary}" | sed -n 's/^recall_ok=.* error_code=\([^ ]*\).*/\1/p; s/^parse_error=1 error_code=\(.*\)$/\1/p' | tail -1); code=${code:-unknown}
    die "E_CHAT_${code}" "对话未成功（详情 ${T022_HOME}/chat.json）"
  fi
  stop_all
  echo "报告：${REPORT}"
  [ "${OFFLINE}" = true ] && note "核验完毕，可以重新打开 Wi-Fi 了"
  return 0
}

case "${1:-all}" in
  all) phase_online; phase_offline ;;
  chat) : >"${REPORT}"; phase_offline ;;
  cleanup) stop_all; [ "${PURGE:-0}" = 1 ] && rm -rf "${T022_HOME}"; echo "已清理" ;;
  *) sed -n 2,17p "$0"; exit 2 ;;
esac
