#!/usr/bin/env bash
# Heybe 沙箱概念验证：BoxLite（主）与 Lima+docker（对照），FastClaw v1.4.0。
# 用法: scripts/poc/boxlite-poc.sh <step>
#   step: precheck | install | serve | fastclaw-boxlite | verify | metrics |
#         lima | fastclaw-docker | cleanup | all-boxlite
# 幂等；任一步骤失败立即退出（set -euo pipefail）。不打印任何密钥。
# 需要的环境变量（由用户在本机提供，脚本只读取不打印）：
#   DEEPSEEK_API_KEY   FastClaw 使用的 LLM 密钥（FastClaw 按 provider 自动读取，见 internal/provider/credentials.go）
#   FASTCLAW_API_KEY   调用 FastClaw /v1 用的 apikey（由 `fastclaw apikey create` 生成）
#   HEYBE_POC_AGENT    Agent 名或 id（默认 poc）
set -euo pipefail

FASTCLAW_VERSION="v1.4.0"
BOXLITE_VERSION="${BOXLITE_VERSION:-}"          # 留空=latest；测完后回填固定版本
POC_HOME="${HEYBE_POC_HOME:-$HOME/.local/opt/heybe-poc}"
BOXLITE_DIR="$HOME/.local/opt/boxlite/bin"
FASTCLAW_DIR="$HOME/.local/opt/fastclaw/bin"
LOG_DIR="$POC_HOME/logs"
RESULTS="$POC_HOME/results.tsv"
BOXLITE_PORT=8100
FASTCLAW_PORT="${FASTCLAW_PORT:-18953}"
AGENT="${HEYBE_POC_AGENT:-poc}"
LIMA_NAME="heybe-poc"
SECRET_FILE="$HOME/Documents/heybe-poc-secret.txt"

mkdir -p "$POC_HOME" "$LOG_DIR"
export PATH="$BOXLITE_DIR:$FASTCLAW_DIR:$PATH"

pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; printf 'PASS\t%s\t%s\n' "$(date +%FT%T)" "$*" >>"$RESULTS"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; printf 'FAIL\t%s\t%s\n' "$(date +%FT%T)" "$*" >>"$RESULTS"; exit 1; }
info() { printf '---- %s\n' "$*"; }
rec()  { printf 'METRIC\t%s\t%s\n' "$(date +%FT%T)" "$*" | tee -a "$RESULTS"; }
need() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1"; }
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
require_secret() { [ -n "${!1:-}" ] || fail "环境变量 $1 未设置（请在本机 export，脚本不会打印它）"; }

wait_http() { # url seconds
  local i; for i in $(seq 1 "$2"); do curl -fsS -o /dev/null -m 2 "$1" 2>/dev/null && return 0; curl -sS -o /dev/null -m 2 "$1" 2>/dev/null && return 0; sleep 1; done; return 1; }

# ---------------------------------------------------------------- precheck
step_precheck() {
  info "前置检查"
  [ "$(uname -s)" = Darwin ] || fail "不是 macOS"
  local arch ver major; arch=$(uname -m); ver=$(sw_vers -productVersion); major=${ver%%.*}
  [ "$arch" = arm64 ] || fail "芯片为 $arch，BoxLite 仅支持 Apple Silicon"
  [ "$major" -ge 12 ] || fail "macOS $ver < 12"
  sysctl -n kern.hv_support | grep -q 1 || fail "kern.hv_support != 1（Hypervisor 不可用）"
  need curl; need python3; need tar
  rec "macos=$ver arch=$arch cpu=$(sysctl -n machdep.cpu.brand_string | tr ' ' '_') mem_gb=$(( $(sysctl -n hw.memsize)/1073741824 ))"
  pass "precheck macOS $ver / $arch / hv_support=1"
}

# ---------------------------------------------------------------- install
step_install() {
  info "安装 BoxLite CLI 到 $BOXLITE_DIR（无 sudo）"
  mkdir -p "$BOXLITE_DIR" "$FASTCLAW_DIR"
  if ! [ -x "$BOXLITE_DIR/boxlite" ]; then
    # 官方: https://docs.boxlite.ai/getting-started/installation （变量须放在 sh 一侧）
    curl -fsSL https://sh.boxlite.ai | BOXLITE_INSTALL_DIR="$BOXLITE_DIR" ${BOXLITE_VERSION:+BOXLITE_VERSION=$BOXLITE_VERSION} sh \
      >"$LOG_DIR/boxlite-install.log" 2>&1 || fail "BoxLite 安装失败，见 $LOG_DIR/boxlite-install.log"
  fi
  boxlite --version >/dev/null 2>&1 || fail "boxlite --version 失败"
  rec "boxlite_version=$(boxlite --version 2>&1 | head -1 | tr ' ' '_')"
  pass "boxlite 已安装"

  info "安装 FastClaw $FASTCLAW_VERSION 到 $FASTCLAW_DIR"
  if ! { [ -x "$FASTCLAW_DIR/fastclaw" ] && "$FASTCLAW_DIR/fastclaw" --version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}"; }; then
    # 资产名格式取自 v1.4.0 install.sh：fastclaw_${OS}_${ARCH}.tar.gz（OS/ARCH 取值待核实：darwin_arm64）
    local url="https://github.com/fastclaw-ai/fastclaw/releases/download/$FASTCLAW_VERSION/fastclaw_darwin_arm64.tar.gz"
    local tmp; tmp=$(mktemp -d)
    curl -fsSL "$url" -o "$tmp/fc.tgz" || fail "下载失败 $url（排查：curl -sI $url；或查看 release 资产列表）"
    tar -xzf "$tmp/fc.tgz" -C "$tmp" && install -m 755 "$(find "$tmp" -type f -name fastclaw | head -1)" "$FASTCLAW_DIR/fastclaw"
    rm -rf "$tmp"
  fi
  rec "fastclaw_version=$(fastclaw --version 2>&1 | head -1 | tr ' ' '_')"
  pass "fastclaw 已安装"
  rec "install_size_boxlite=$(du -sh "$HOME/.local/opt/boxlite" | cut -f1) install_size_fastclaw=$(du -sh "$HOME/.local/opt/fastclaw" | cut -f1)"
}

# ---------------------------------------------------------------- serve
step_serve() {
  info "启动 boxlite serve（仅 127.0.0.1:$BOXLITE_PORT）"
  if ! curl -sS -o /dev/null -m 2 "http://127.0.0.1:$BOXLITE_PORT/" 2>/dev/null; then
    # 默认就绑定 127.0.0.1（0.10.6+）；显式写出 --host 127.0.0.1 --port
    nohup boxlite serve --host 127.0.0.1 --port "$BOXLITE_PORT" >"$LOG_DIR/boxlite-serve.log" 2>&1 &
    echo $! >"$POC_HOME/boxlite.pid"
    wait_http "http://127.0.0.1:$BOXLITE_PORT/" 20 || fail "boxlite serve 未起来，见 $LOG_DIR/boxlite-serve.log"
  fi
  lsof -nP -iTCP:"$BOXLITE_PORT" -sTCP:LISTEN | grep -q '127.0.0.1' || fail "监听地址不是 127.0.0.1（lsof -nP -iTCP:$BOXLITE_PORT）"
  pass "boxlite serve 只监听 127.0.0.1:$BOXLITE_PORT"

  info "直接探测 BoxLite REST（FastClaw 用的路径 /v1/default/boxes）"
  local code; code=$(curl -sS -o "$LOG_DIR/probe-list.json" -w '%{http_code}' "http://127.0.0.1:$BOXLITE_PORT/v1/default/boxes" || true)
  rec "boxlite_rest_list_http=$code"
  [ "$code" = 200 ] && pass "REST /v1/default/boxes 可用" || info "REST 返回 $code（待核实路径前缀；排查：curl -s http://127.0.0.1:$BOXLITE_PORT/openapi.json | head）"
}

# 用 BoxLite REST 直接跑一条 exec 并测 attach WebSocket（不经 FastClaw），把风险点单独隔离出来
step_ws_probe() {
  info "WebSocket attach 直测（FastClaw 依赖 GET …/executions/{id}/attach）"
  local base="http://127.0.0.1:$BOXLITE_PORT/v1/default" img="${FASTCLAW_SANDBOX_IMAGE:-thinkany/fastclaw-sandbox:latest}"
  local t0 t1 box exe
  t0=$(now_ms)
  box=$(curl -fsS -X POST "$base/boxes" -H 'Content-Type: application/json' -d "{\"image\":\"$img\",\"auto_remove\":true}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["box_id"])') || fail "创建 box 失败"
  curl -fsS -X POST "$base/boxes/$box/start" -o /dev/null || fail "start box 失败"
  t1=$(now_ms); rec "boxlite_cold_create_start_ms=$((t1-t0)) (首次含镜像拉取)"
  echo "$box" >"$POC_HOME/probe-box.id"
  exe=$(curl -fsS -X POST "$base/boxes/$box/exec" -H 'Content-Type: application/json' \
        -d '{"command":"sh","args":["-c","for i in 1 2 3; do echo HEYBE_WS_$i; sleep 1; done"]}' \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["execution_id"])') || fail "exec 失败（请求体字段待核实：curl -s $base/../openapi.json）"
  python3 - "$BOXLITE_PORT" "$box" "$exe" <<'PY' || fail "WebSocket attach 不可用 —— 最大风险点命中，需要 shim"
import sys,socket,base64,os
port,box,exe=sys.argv[1:]
s=socket.create_connection(("127.0.0.1",int(port)),timeout=15)
key=base64.b64encode(os.urandom(16)).decode()
s.send((f"GET /v1/default/boxes/{box}/executions/{exe}/attach HTTP/1.1\r\nHost: 127.0.0.1\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
data=b""
while b"\r\n\r\n" not in data: data+=s.recv(4096)
head=data.split(b"\r\n")[0].decode(); print("handshake:",head)
if " 101 " not in head: sys.exit(1)
buf=data.split(b"\r\n\r\n",1)[1]
try:
    while True:
        c=s.recv(4096)
        if not c: break
        buf+=c
        if b'"exit"' in buf: break
except socket.timeout: pass
n=sum(1 for i in (1,2,3) if f"HEYBE_WS_{i}".encode() in buf)
print("frames_with_marker:",n); sys.exit(0 if n==3 else 1)
PY
  pass "WebSocket attach 流式输出 3/3"
  local w0 w1; w0=$(now_ms)
  curl -fsS -X POST "$base/boxes/$box/exec" -H 'Content-Type: application/json' -d '{"command":"true"}' -o /dev/null
  w1=$(now_ms); rec "boxlite_warm_exec_submit_ms=$((w1-w0))"
  curl -fsS -X DELETE "$base/boxes/$box?force=true" -o /dev/null || true
}

# ---------------------------------------------------------------- fastclaw
start_fastclaw() { # backend
  local backend=$1
  require_secret DEEPSEEK_API_KEY
  if curl -sS -o /dev/null -m 2 "http://127.0.0.1:$FASTCLAW_PORT/" 2>/dev/null; then
    info "FastClaw 已在 $FASTCLAW_PORT 运行；如要切换后端请先 cleanup-fastclaw"; return 0; fi
  unset FASTCLAW_ALLOW_HOST_EXEC
  export FASTCLAW_PORT FASTCLAW_HOME="$POC_HOME/fastclaw-$backend"
  export FASTCLAW_SANDBOX_ENABLED=1 FASTCLAW_SANDBOX_ENFORCE=1 FASTCLAW_SANDBOX_BACKEND="$backend"
  if [ "$backend" = boxlite ]; then
    export FASTCLAW_SANDBOX_BOXLITE_URL="http://127.0.0.1:$BOXLITE_PORT/v1" FASTCLAW_SANDBOX_BOXLITE_PREFIX=default
    export BOXLITE_API_KEY="${BOXLITE_API_KEY:-local-poc}"   # 本地 serve 未设 --api-key 时为宽松模式，任意值即可
  fi
  mkdir -p "$FASTCLAW_HOME"
  # `fastclaw`（无子命令）在 18953 启动 gateway，见 cmd/fastclaw/main.go:127；子命令名 gateway 亦可（待核实其语义）
  nohup fastclaw >"$LOG_DIR/fastclaw-$backend.log" 2>&1 &
  echo $! >"$POC_HOME/fastclaw.pid"
  wait_http "http://127.0.0.1:$FASTCLAW_PORT/" 30 || fail "FastClaw 未起来，见 $LOG_DIR/fastclaw-$backend.log"
  grep -q "system sandbox executor pool created" "$LOG_DIR/fastclaw-$backend.log" \
    && grep "system sandbox executor pool created" "$LOG_DIR/fastclaw-$backend.log" | tail -1 \
    || info "日志里未见 sandbox pool 创建行（可能要首个会话才创建；待核实）"
  env | grep -q '^FASTCLAW_ALLOW_HOST_EXEC=' && fail "FASTCLAW_ALLOW_HOST_EXEC 不应设置"
  pass "FastClaw 以 backend=$backend 强制沙箱启动"
}

chat() { # prompt -> 流式回复正文（SSE 拼接）写到 stdout
  require_secret FASTCLAW_API_KEY
  python3 - "$FASTCLAW_PORT" "$AGENT" "$1" <<'PY'
import sys,os,json,urllib.request
port,agent,prompt=sys.argv[1:]
body=json.dumps({"model":agent,"agent_id":agent,"stream":True,"messages":[{"role":"user","content":prompt}]}).encode()
req=urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",data=body,
    headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["FASTCLAW_API_KEY"],"x-fastclaw-agent-id":agent})
out=[]
with urllib.request.urlopen(req,timeout=300) as r:
    for line in r:
        line=line.decode().strip()
        if not line.startswith("data:"): continue
        d=line[5:].strip()
        if d=="[DONE]": break
        try: out.append(json.loads(d)["choices"][0].get("delta",{}).get("content") or "")
        except Exception: pass
print("".join(out))
PY
}

step_verify() { # 三项验证，经 FastClaw /v1
  local tag=${1:-boxlite} log="$LOG_DIR/fastclaw-${1:-boxlite}.log" out t0 t1
  info "[$tag] 验证 1：命令输出经沙箱流式取回"
  t0=$(now_ms)
  out=$(chat 'Use the exec tool to run exactly: echo HEYBE_EXEC_$((40+2)) && uname -a . Reply with the raw tool output only.') || fail "[$tag] /v1 调用失败"
  t1=$(now_ms); rec "[$tag] first_turn_ms=$((t1-t0))"
  echo "$out" >"$LOG_DIR/verify1-$tag.txt"
  grep -q 'HEYBE_EXEC_42' <<<"$out" || fail "[$tag] 回复中无 HEYBE_EXEC_42（见 $LOG_DIR/verify1-$tag.txt；grep -i 'attach\|sandbox' $log）"
  grep -qi 'linux' <<<"$out" || fail "[$tag] uname 不是 Linux —— 命令可能跑在宿主上"
  if grep -qi 'boxlite attach\|attach read' "$log"; then fail "[$tag] 日志有 attach 错误"; fi
  pass "[$tag] exec 在 Linux 沙箱内执行并取回输出"

  info "[$tag] 验证 2：读取宿主 ~/Documents 测试文件应失败"
  local token; token="HEYBE_SECRET_$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
  mkdir -p "$HOME/Documents"; echo "$token" >"$SECRET_FILE"
  out=$(chat "Use the exec tool to run: cat '$SECRET_FILE' ; ls -la '$HOME/Documents' . Reply with raw output.")
  echo "$out" >"$LOG_DIR/verify2-$tag.txt"
  grep -q "$token" <<<"$out" && fail "[$tag] 沙箱读到了宿主文件！"
  pass "[$tag] 宿主 ~/Documents 不可见"

  info "[$tag] 验证 3：非白名单出网应失败"
  out=$(chat "Use the exec tool to run: curl -sS -m 8 -o /dev/null -w 'HTTP_%{http_code}' https://example.com || echo NET_BLOCKED . Reply with raw output.")
  echo "$out" >"$LOG_DIR/verify3-$tag.txt"
  if grep -q 'HTTP_200\|HTTP_30' <<<"$out"; then
    fail "[$tag] 出网未被拦截（预期风险：FastClaw v1.4.0 创建 box 时只发 image/auto_remove，不带 allow_net；docker 后端网络来自 DB 配置 sandbox.network）"
  fi
  pass "[$tag] 出网被拦截"
}

step_metrics() {
  info "资源与体积"
  local pid; pid=$(cat "$POC_HOME/boxlite.pid" 2>/dev/null || true)
  [ -n "$pid" ] && rec "boxlite_serve_rss_mb=$(( $(ps -o rss= -p "$pid" 2>/dev/null || echo 0)/1024 ))"
  rec "vm_processes_rss_mb=$(ps -axo rss,comm | awk '/boxlite|krun|shim/ {s+=$1} END {print int(s/1024)}')"
  rec "boxlite_data_size=$(du -sh "$HOME/.boxlite" 2>/dev/null | cut -f1 || echo 待核实路径)"
  rec "install_size_total=$(du -sh "$HOME/.local/opt" | cut -f1)"
  pass "metrics 已记录到 $RESULTS"
}

# ---------------------------------------------------------------- lima
step_lima() {
  info "Lima 对照：vz + docker 模板"
  need brew
  brew list lima >/dev/null 2>&1 || brew install lima
  command -v docker >/dev/null || brew install docker   # 只装 docker CLI（FastClaw 调 docker 二进制）
  if ! limactl list -q 2>/dev/null | grep -qx "$LIMA_NAME"; then
    local t0 t1; t0=$(now_ms)
    limactl start --name="$LIMA_NAME" --vm-type=vz --tty=false template://docker >"$LOG_DIR/lima-start.log" 2>&1 \
      || fail "limactl start 失败，见 $LOG_DIR/lima-start.log"
    t1=$(now_ms); rec "lima_cold_start_ms=$((t1-t0))"
  else
    limactl list "$LIMA_NAME" | grep -q Running || limactl start "$LIMA_NAME" --tty=false >>"$LOG_DIR/lima-start.log" 2>&1
  fi
  export DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock"
  docker info >/dev/null 2>&1 || fail "docker info 失败（DOCKER_HOST=$DOCKER_HOST；排查：limactl list; ls ~/.lima/$LIMA_NAME/sock）"
  local img="${FASTCLAW_SANDBOX_IMAGE:-thinkany/fastclaw-sandbox:latest}"
  docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img" >/dev/null
  local w0 w1; w0=$(now_ms); docker run --rm "$img" true; w1=$(now_ms); rec "lima_warm_container_ms=$((w1-w0))"
  rec "lima_disk=$(du -sh "$HOME/.lima/$LIMA_NAME" | cut -f1) lima_install=$(du -sh "$(brew --prefix lima)" | cut -f1)"
  rec "lima_vm_rss_mb=$(ps -axo rss,command | awk '/limactl|vz/ {s+=$1} END {print int(s/1024)}')"
  pass "Lima docker 可用：$DOCKER_HOST"
}

# ---------------------------------------------------------------- cleanup
cleanup_fastclaw() {
  [ -f "$POC_HOME/fastclaw.pid" ] && kill "$(cat "$POC_HOME/fastclaw.pid")" 2>/dev/null || true
  rm -f "$POC_HOME/fastclaw.pid"
}
step_cleanup() {
  info "清理"
  cleanup_fastclaw
  [ -f "$POC_HOME/boxlite.pid" ] && kill "$(cat "$POC_HOME/boxlite.pid")" 2>/dev/null || true
  rm -f "$POC_HOME/boxlite.pid" "$SECRET_FILE"
  if command -v docker >/dev/null && [ -S "$HOME/.lima/$LIMA_NAME/sock/docker.sock" ]; then
    DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock" docker ps -aq --filter label=fastclaw=sandbox | xargs -r docker rm -f >/dev/null 2>&1 || true
  fi
  if command -v limactl >/dev/null && limactl list -q 2>/dev/null | grep -qx "$LIMA_NAME"; then
    limactl stop "$LIMA_NAME" >/dev/null 2>&1 || true
    [ "${PURGE:-0}" = 1 ] && limactl delete -f "$LIMA_NAME"
  fi
  if [ "${PURGE:-0}" = 1 ]; then rm -rf "$HOME/.local/opt/boxlite" "$HOME/.local/opt/fastclaw" "$POC_HOME"; fi
  pass "清理完成（PURGE=1 会删除安装与数据；brew 包需手动 brew uninstall lima docker）"
}

case "${1:-}" in
  precheck) step_precheck ;;
  install) step_install ;;
  serve) step_serve; step_ws_probe ;;
  fastclaw-boxlite) start_fastclaw boxlite ;;
  verify) step_verify "${2:-boxlite}" ;;
  metrics) step_metrics ;;
  lima) step_lima ;;
  fastclaw-docker) cleanup_fastclaw; export DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock"; start_fastclaw docker ;;
  cleanup-fastclaw) cleanup_fastclaw; pass "FastClaw 已停止" ;;
  cleanup) step_cleanup ;;
  all-boxlite) step_precheck; step_install; step_serve; step_ws_probe; start_fastclaw boxlite; step_verify boxlite; step_metrics ;;
  *) sed -n 2,12p "$0"; exit 2 ;;
esac
