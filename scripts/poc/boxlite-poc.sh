#!/usr/bin/env bash
# Heybe 沙箱概念验证：BoxLite（主线）与 Lima+docker（对照），FastClaw v1.4.0（b5ad3dff）。
# 用法: scripts/poc/boxlite-poc.sh <step> [backend]
#   all                         按顺序跑全部步骤，某步失败后继续跑不依赖它的步骤，最后生成 report.md（不自动 cleanup）
#   precheck | install | serve | fastclaw-boxlite | setup boxlite | verify boxlite | metrics
#   lima | fastclaw-docker | setup docker | verify docker | report | cleanup-fastclaw | cleanup
# 密钥：
#   DEEPSEEK_API_KEY  从 ${HEYBE_POC_ENV:-~/.heybe-poc.env} 读取（文件权限必须是 600，内容一行 DEEPSEEK_API_KEY=...）
#   FastClaw apikey   由脚本自动生成，只写进 $POC_HOME/<backend>/fastclaw-apikey（600），不输出到终端
# 任何密钥都不会打印、写进日志或报告；报告写入前会再做一次脱敏。
set -euo pipefail
umask 077

FASTCLAW_VERSION="v1.4.0"
BOXLITE_VERSION="${BOXLITE_VERSION:-}"          # 留空=latest；跑通后回填固定版本
POC_HOME="${HEYBE_POC_HOME:-$HOME/.local/opt/heybe-poc}"
POC_ENV="${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}"
BOXLITE_DIR="$HOME/.local/opt/boxlite/bin"
FASTCLAW_DIR="$HOME/.local/opt/fastclaw/bin"
LOG_DIR="$POC_HOME/logs"
RESULTS="$POC_HOME/results.tsv"
REPORT="$POC_HOME/report.md"
STATUS_DIR="$POC_HOME/status"
BOXLITE_PORT=8100
FASTCLAW_PORT="${FASTCLAW_PORT:-18953}"
AGENT="${HEYBE_POC_AGENT:-poc}"
MODEL="${HEYBE_POC_MODEL:-deepseek/deepseek-chat}"
LIMA_NAME="heybe-poc"
SECRET_FILE="$HOME/Documents/heybe-poc-secret.txt"
SANDBOX_IMAGE="${FASTCLAW_SANDBOX_IMAGE:-thinkany/fastclaw-sandbox:latest}"

mkdir -p "$POC_HOME" "$LOG_DIR" "$STATUS_DIR"
export PATH="$BOXLITE_DIR:$FASTCLAW_DIR:$PATH"

pass() { printf '\033[32mPASS\033[0m %s\n' "$*"; printf 'PASS\t%s\t%s\n' "$(date +%FT%T)" "$*" >>"$RESULTS"; }
fail() { printf '\033[31mFAIL\033[0m %s\n' "$*" >&2; printf 'FAIL\t%s\t%s\n' "$(date +%FT%T)" "$*" >>"$RESULTS"; exit 1; }
info() { printf -- '---- %s\n' "$*"; }
rec()  { printf 'METRIC\t%s\t%s\n' "$(date +%FT%T)" "$*" | tee -a "$RESULTS"; }
need() { command -v "$1" >/dev/null 2>&1 || fail "缺少命令 $1"; }
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }
home_for() { echo "$POC_HOME/$1"; }               # 每个后端独立的 FASTCLAW_HOME
apikey_file() { echo "$POC_HOME/$1/fastclaw-apikey"; }
file_mode() { stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1"; }   # macOS / Linux

wait_http() { local _i; for _i in $(seq 1 "$2"); do curl -sS -o /dev/null -m 2 "$1" 2>/dev/null && return 0; sleep 1; done; return 1; }

# ---------------------------------------------------------------- secrets
load_deepseek() {
  [ -f "$POC_ENV" ] || fail "找不到 $POC_ENV（新建：umask 077; printf 'DEEPSEEK_API_KEY=%s\\n' '<key>' > $POC_ENV）"
  local mode; mode=$(file_mode "$POC_ENV")
  [ "$mode" = 600 ] || fail "$POC_ENV 权限是 $mode，必须是 600（chmod 600 $POC_ENV）"
  local v; v=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DEEPSEEK_API_KEY=//p' "$POC_ENV" | tail -1)
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  [ -n "$v" ] || fail "$POC_ENV 里没有 DEEPSEEK_API_KEY=..."
  export DEEPSEEK_API_KEY="$v"
}
load_apikey() { # backend
  local f; f=$(apikey_file "$1")
  [ -s "$f" ] || fail "缺少 $f（先跑 setup $1）"
  [ "$(file_mode "$f")" = 600 ] || fail "$f 权限不是 600"
  FASTCLAW_API_KEY=$(cat "$f"); export FASTCLAW_API_KEY
}

# ---------------------------------------------------------------- precheck
step_precheck() {
  info "前置检查"
  [ "$(uname -s)" = Darwin ] || fail "不是 macOS"
  local arch ver major; arch=$(uname -m); ver=$(sw_vers -productVersion); major=${ver%%.*}
  [ "$arch" = arm64 ] || fail "芯片为 $arch，BoxLite 仅支持 Apple Silicon"
  [ "$major" -ge 12 ] || fail "macOS $ver < 12"
  [ "$(sysctl -n kern.hv_support)" = 1 ] || fail "kern.hv_support != 1（Hypervisor 不可用）"
  need curl; need python3; need tar; need lsof
  load_deepseek   # 仅检查文件与权限，不输出
  rec "macos=$ver arch=$arch cpu=$(sysctl -n machdep.cpu.brand_string | tr ' ' '_') mem_gb=$(( $(sysctl -n hw.memsize)/1073741824 ))"
  pass "precheck macOS $ver / $arch / hv_support=1 / $POC_ENV 权限 600"
}

# ---------------------------------------------------------------- install
step_install() {
  info "安装 BoxLite CLI 到 $BOXLITE_DIR（无 sudo）"
  mkdir -p "$BOXLITE_DIR" "$FASTCLAW_DIR"
  if ! [ -x "$BOXLITE_DIR/boxlite" ]; then
    # https://docs.boxlite.ai/getting-started/installation （变量必须放在 sh 一侧）
    curl -fsSL https://sh.boxlite.ai | env BOXLITE_INSTALL_DIR="$BOXLITE_DIR" ${BOXLITE_VERSION:+BOXLITE_VERSION=$BOXLITE_VERSION} sh \
      >"$LOG_DIR/boxlite-install.log" 2>&1 || fail "BoxLite 安装失败，见 $LOG_DIR/boxlite-install.log"
  fi
  boxlite --version >/dev/null 2>&1 || fail "boxlite --version 失败"
  rec "boxlite_version=$(boxlite --version 2>&1 | head -1 | tr ' ' '_')"
  pass "boxlite 已安装"

  info "安装 FastClaw $FASTCLAW_VERSION 到 $FASTCLAW_DIR"
  if ! { [ -x "$FASTCLAW_DIR/fastclaw" ] && "$FASTCLAW_DIR/fastclaw" version 2>/dev/null | grep -q "${FASTCLAW_VERSION#v}"; }; then
    # 资产名取自 v1.4.0 install.sh：fastclaw_${OS}_${ARCH}.tar.gz（darwin_arm64 待核实）
    local url="https://github.com/fastclaw-ai/fastclaw/releases/download/$FASTCLAW_VERSION/fastclaw_darwin_arm64.tar.gz"
    local tmp; tmp=$(mktemp -d)
    curl -fsSL "$url" -o "$tmp/fc.tgz" || fail "下载失败 $url（排查：curl -s https://api.github.com/repos/fastclaw-ai/fastclaw/releases/tags/$FASTCLAW_VERSION | grep name）"
    tar -xzf "$tmp/fc.tgz" -C "$tmp"
    install -m 755 "$(find "$tmp" -type f -name fastclaw | head -1)" "$FASTCLAW_DIR/fastclaw"
    rm -rf "$tmp"
  fi
  fastclaw version | grep -q "${FASTCLAW_VERSION#v}" || fail "fastclaw 版本不是 $FASTCLAW_VERSION"
  rec "fastclaw_version=$(fastclaw version | head -1 | tr ' ' '_')"
  pass "fastclaw $FASTCLAW_VERSION 已安装"
  rec "install_size_boxlite=$(du -sh "$HOME/.local/opt/boxlite" | cut -f1) install_size_fastclaw=$(du -sh "$HOME/.local/opt/fastclaw" | cut -f1)"
  { echo '$ boxlite serve --help'; boxlite serve --help 2>&1 || true
    echo; echo '$ fastclaw --help'; fastclaw --help 2>&1 || true
    echo; echo '$ fastclaw apikey create --help'; fastclaw apikey create --help 2>&1 || true; } >"$LOG_DIR/help.txt"
}

# ---------------------------------------------------------------- serve + WS probe
step_serve() {
  info "启动 boxlite serve（仅 127.0.0.1:$BOXLITE_PORT）"
  if ! curl -sS -o /dev/null -m 2 "http://127.0.0.1:$BOXLITE_PORT/" 2>/dev/null; then
    nohup boxlite serve --host 127.0.0.1 --port "$BOXLITE_PORT" >"$LOG_DIR/boxlite-serve.log" 2>&1 &
    echo $! >"$POC_HOME/boxlite.pid"
    wait_http "http://127.0.0.1:$BOXLITE_PORT/" 20 || fail "boxlite serve 未起来，见 $LOG_DIR/boxlite-serve.log（flag 待核实：boxlite serve --help）"
  fi
  lsof -nP -iTCP:"$BOXLITE_PORT" -sTCP:LISTEN | awk 'NR>1{print $9}' | grep -qv '^127\.0\.0\.1:' \
    && fail "boxlite serve 监听了非回环地址（lsof -nP -iTCP:$BOXLITE_PORT -sTCP:LISTEN）"
  pass "boxlite serve 只监听 127.0.0.1:$BOXLITE_PORT"
  local code; code=$(curl -sS -o "$LOG_DIR/probe-list.json" -w '%{http_code}' "http://127.0.0.1:$BOXLITE_PORT/v1/default/boxes" || true)
  rec "boxlite_rest_list_http=$code"
  [ "$code" = 200 ] || fail "REST /v1/default/boxes 返回 $code（路径前缀待核实：curl -s http://127.0.0.1:$BOXLITE_PORT/openapi.json | head）"
  pass "REST /v1/default/boxes 可用"
}

step_ws_probe() {
  info "WebSocket attach 直测（FastClaw 依赖 GET …/executions/{id}/attach）"
  local base="http://127.0.0.1:$BOXLITE_PORT/v1/default" t0 t1 box exe
  t0=$(now_ms)
  box=$(curl -fsS -X POST "$base/boxes" -H 'Content-Type: application/json' -d "{\"image\":\"$SANDBOX_IMAGE\",\"auto_remove\":true}" \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["box_id"])') || fail "创建 box 失败"
  curl -fsS -X POST "$base/boxes/$box/start" -o /dev/null || fail "start box 失败"
  t1=$(now_ms); rec "boxlite_cold_create_start_ms=$((t1-t0)) (首次含镜像拉取)"
  exe=$(curl -fsS -X POST "$base/boxes/$box/exec" -H 'Content-Type: application/json' \
        -d '{"command":"sh","args":["-c","for i in 1 2 3; do echo HEYBE_WS_$i; sleep 1; done"]}' \
        | python3 -c 'import sys,json;print(json.load(sys.stdin)["execution_id"])') || fail "exec 失败（请求体字段待核实）"
  python3 - "$BOXLITE_PORT" "$box" "$exe" <<'PY' 2>&1 | tee "$LOG_DIR/ws-probe.txt"
import sys,socket,base64,os
port,box,exe=sys.argv[1:]
s=socket.create_connection(("127.0.0.1",int(port)),timeout=15)
key=base64.b64encode(os.urandom(16)).decode()
s.send((f"GET /v1/default/boxes/{box}/executions/{exe}/attach HTTP/1.1\r\nHost: 127.0.0.1\r\n"
        f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
data=b""
while b"\r\n\r\n" not in data:
    c=s.recv(4096)
    if not c: break
    data+=c
head=data.split(b"\r\n")[0].decode(errors="replace"); print("handshake:",head)
buf=data.split(b"\r\n\r\n",1)[1] if b"\r\n\r\n" in data else b""
if " 101 " in head:
    try:
        while b'"exit"' not in buf:
            c=s.recv(4096)
            if not c: break
            buf+=c
    except socket.timeout: pass
print("frames_with_marker:",sum(1 for i in (1,2,3) if f"HEYBE_WS_{i}".encode() in buf),"/3")
PY
  local w0 w1; w0=$(now_ms)
  curl -fsS -X POST "$base/boxes/$box/exec" -H 'Content-Type: application/json' -d '{"command":"true"}' -o /dev/null || true
  w1=$(now_ms); rec "boxlite_warm_exec_submit_ms=$((w1-w0))"
  curl -fsS -X DELETE "$base/boxes/$box?force=true" -o /dev/null || true
  grep -q 'handshake:.* 101 ' "$LOG_DIR/ws-probe.txt" && grep -q 'frames_with_marker: 3 /3' "$LOG_DIR/ws-probe.txt" \
    || fail "WebSocket attach 不可用 —— 最大风险点命中（见 $LOG_DIR/ws-probe.txt）"
  pass "WebSocket attach 流式输出 3/3"
}

# ---------------------------------------------------------------- fastclaw gateway
fc_env() { # backend：导出该后端的 FastClaw 环境（不含 FASTCLAW_ALLOW_HOST_EXEC）
  unset FASTCLAW_ALLOW_HOST_EXEC
  export FASTCLAW_PORT FASTCLAW_HOME; FASTCLAW_HOME=$(home_for "$1"); mkdir -p "$FASTCLAW_HOME"
  export FASTCLAW_SANDBOX_ENABLED=1 FASTCLAW_SANDBOX_ENFORCE=1 FASTCLAW_SANDBOX_BACKEND="$1"
  if [ "$1" = boxlite ]; then
    export FASTCLAW_SANDBOX_BOXLITE_URL="http://127.0.0.1:$BOXLITE_PORT/v1" FASTCLAW_SANDBOX_BOXLITE_PREFIX=default
    export BOXLITE_API_KEY="${BOXLITE_API_KEY:-local-poc}"   # 本地 serve 未加 --api-key 时为宽松模式，占位值（待核实）
  else
    export DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock"
  fi
}

start_fastclaw() { # backend
  local backend=$1
  load_deepseek; fc_env "$backend"
  if curl -sS -o /dev/null -m 2 "http://127.0.0.1:$FASTCLAW_PORT/" 2>/dev/null; then
    [ "$(cat "$POC_HOME/fastclaw.backend" 2>/dev/null)" = "$backend" ] || fail "端口 $FASTCLAW_PORT 已被其他 FastClaw 占用（先跑 cleanup-fastclaw）"
    pass "FastClaw(backend=$backend) 已在运行"; return 0
  fi
  # `fastclaw` 无子命令即启动 gateway（FC:cmd/fastclaw/main.go:127）
  nohup fastclaw >"$LOG_DIR/fastclaw-$backend.log" 2>&1 &
  echo $! >"$POC_HOME/fastclaw.pid"; echo "$backend" >"$POC_HOME/fastclaw.backend"
  wait_http "http://127.0.0.1:$FASTCLAW_PORT/" 30 || fail "FastClaw 未起来，见 $LOG_DIR/fastclaw-$backend.log"
  pass "FastClaw 以 backend=$backend、ENFORCE=1 启动（未设置 FASTCLAW_ALLOW_HOST_EXEC）"
}

# 配置 Agent（CLI，不走 /api/*）+ 生成 apikey（只写 600 文件）
step_setup() { # backend
  local backend=$1 home kf out
  load_deepseek; fc_env "$backend"; home=$(home_for "$backend"); kf=$(apikey_file "$backend")
  info "[$backend] agents init（DeepSeek，CLI：FC:cmd/fastclaw/cmd_agents.go）"
  # --api-key-env 只写入变量名，密钥值由 gateway 进程环境提供；init 会在没有用户时创建 super_admin "admin"（生成的密码只进 600 日志，不进报告）
  fastclaw agents init "$AGENT" --provider deepseek --model "$MODEL" --api-key-env DEEPSEEK_API_KEY \
    >"$home/agents-init.log" 2>&1 || fail "[$backend] agents init 失败（见 $home/agents-init.log）"
  pass "[$backend] Agent $AGENT 已配置 provider=deepseek model=$MODEL"
  if [ "$backend" = docker ]; then
    # 沙箱网络：agent 作用域 setting（FC:internal/agentcli/agentcli.go settingKey，sandbox.* 为 agent scope）
    fastclaw agents config "$AGENT" set sandbox.network none >>"$home/agents-init.log" 2>&1 \
      || fail "[$backend] 设置 sandbox.network=none 失败"
    pass "[$backend] sandbox.network=none 已写入 Agent 配置（是否作用于系统沙箱池待核实，见验证 3）"
  fi
  fastclaw agents doctor "$AGENT" >"$LOG_DIR/doctor-$backend.txt" 2>&1 || fail "[$backend] agents doctor 未通过（见 $LOG_DIR/doctor-$backend.txt）"
  pass "[$backend] agents doctor 通过"

  info "[$backend] 生成 FastClaw apikey"
  if [ -s "$kf" ]; then pass "[$backend] apikey 文件已存在（复用）"; return 0; fi
  fastclaw apikey create --help >"$LOG_DIR/apikey-help-$backend.txt" 2>&1 || fail "[$backend] fastclaw apikey create --help 运行失败"
  grep -q -- '--name' "$LOG_DIR/apikey-help-$backend.txt" || fail "[$backend] apikey create --help 中找不到 --name 参数，无法自动生成；请手动运行 fastclaw apikey create --help 并反馈输出"
  local args=(--name "heybe-poc-$backend")
  grep -q -- '--type' "$LOG_DIR/apikey-help-$backend.txt" && args+=(--type user)
  # 输出含 "token: <key>"：整段只在内存，提取后写 600 文件，不落终端/日志
  out=$(fastclaw apikey create "${args[@]}" 2>&1) || { fail "[$backend] apikey create 失败（常见原因：无 super_admin，可用 fastclaw admin list-users 排查）"; }
  ( umask 077; printf '%s' "$out" | sed -n 's/^token:[[:space:]]*//p' | head -1 | tr -d '\r\n' >"$kf" )
  out=""
  [ -s "$kf" ] || { rm -f "$kf"; fail "[$backend] 未能从 apikey create 输出中解析 token（输出格式待核实）"; }
  chmod 600 "$kf"
  pass "[$backend] apikey 已写入 $kf（600）"
}

chat() { # backend prompt
  load_apikey "$1"
  python3 - "$FASTCLAW_PORT" "$AGENT" "$2" <<'PY'
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

# 三项验证分别记录；任何一项失败，整体返回失败，但三项都会跑完
step_verify() { # backend
  local b=$1 log="$LOG_DIR/fastclaw-$1.log" out t0 t1 bad=0
  [ "$(cat "$POC_HOME/fastclaw.backend" 2>/dev/null)" = "$b" ] || fail "[$b] 当前运行的 FastClaw 不是 $b 后端"
  ( info "[$b] 验证 1：命令输出经沙箱流式取回"
    t0=$(now_ms)
    out=$(chat "$b" 'Use the exec tool to run exactly: echo HEYBE_EXEC_$((40+2)) && uname -a . Reply with the raw tool output only.') || fail "[$b] /v1 调用失败"
    t1=$(now_ms); rec "[$b] first_turn_ms=$((t1-t0))"
    echo "$out" >"$LOG_DIR/verify1-$b.txt"
    grep -q 'HEYBE_EXEC_42' <<<"$out" || fail "[$b] 验证1 回复中无 HEYBE_EXEC_42"
    grep -qi 'linux' <<<"$out" || fail "[$b] 验证1 uname 不是 Linux —— 命令可能跑在宿主上"
    ! grep -qi 'boxlite attach\|attach read' "$log" || fail "[$b] 验证1 日志有 attach 错误"
    pass "[$b] 验证1 exec 在 Linux 沙箱内执行并取回输出" ) || bad=1
  ( info "[$b] 验证 2：读取宿主 ~/Documents 测试文件应失败"
    local token; token="HEYBE_DOC_$(python3 -c 'import secrets;print(secrets.token_hex(6))')"
    mkdir -p "$HOME/Documents"; echo "$token" >"$SECRET_FILE"
    out=$(chat "$b" "Use the exec tool to run: cat '$SECRET_FILE' ; ls -la '$HOME/Documents' . Reply with raw output.") || fail "[$b] /v1 调用失败"
    echo "$out" >"$LOG_DIR/verify2-$b.txt"
    ! grep -q "$token" <<<"$out" || fail "[$b] 验证2 沙箱读到了宿主文件！"
    pass "[$b] 验证2 宿主 ~/Documents 不可见" ) || bad=1
  ( info "[$b] 验证 3：非白名单出网应失败"
    out=$(chat "$b" "Use the exec tool to run: curl -sS -m 8 -o /dev/null -w 'HTTP_%{http_code}' https://example.com || echo NET_BLOCKED . Reply with raw output.") || fail "[$b] /v1 调用失败"
    echo "$out" >"$LOG_DIR/verify3-$b.txt"
    ! grep -q 'HTTP_200\|HTTP_30' <<<"$out" || fail "[$b] 验证3 出网未被拦截（boxlite：FastClaw 创建 box 不带 allow_net；docker：sandbox.network 可能未作用于系统池）"
    pass "[$b] 验证3 出网被拦截" ) || bad=1
  [ $bad = 0 ] || fail "[$b] verify 有失败项"
}

step_metrics() {
  info "资源与体积"
  local pid; pid=$(cat "$POC_HOME/boxlite.pid" 2>/dev/null || true)
  [ -n "$pid" ] && rec "boxlite_serve_rss_mb=$(( $(ps -o rss= -p "$pid" 2>/dev/null || echo 0)/1024 ))"
  rec "boxlite_vm_rss_mb=$(ps -axo rss,comm | awk '/boxlite|krun|shim/ {s+=$1} END {print int(s/1024)}')"
  rec "boxlite_data_size=$(du -sh "$HOME/.boxlite" 2>/dev/null | cut -f1 || echo 待核实路径)"
  rec "install_size_total=$(du -sh "$HOME/.local/opt" | cut -f1)"
  pass "metrics 已记录"
}

# ---------------------------------------------------------------- lima
step_lima() {
  info "Lima 对照：vz + docker 模板"
  need brew
  brew list lima >/dev/null 2>&1 || brew install lima >"$LOG_DIR/brew-lima.log" 2>&1 || fail "brew install lima 失败"
  command -v docker >/dev/null || brew install docker >"$LOG_DIR/brew-docker.log" 2>&1 || fail "brew install docker（CLI）失败"
  if ! limactl list -q 2>/dev/null | grep -qx "$LIMA_NAME"; then
    local t0 t1; t0=$(now_ms)
    limactl start --name="$LIMA_NAME" --vm-type=vz --tty=false template://docker >"$LOG_DIR/lima-start.log" 2>&1 \
      || fail "limactl start 失败，见 $LOG_DIR/lima-start.log"
    t1=$(now_ms); rec "lima_cold_start_ms=$((t1-t0))"
  elif ! limactl list "$LIMA_NAME" | grep -q Running; then
    local t0 t1; t0=$(now_ms); limactl start "$LIMA_NAME" --tty=false >>"$LOG_DIR/lima-start.log" 2>&1 || fail "limactl start 失败"
    t1=$(now_ms); rec "lima_restart_ms=$((t1-t0))"
  fi
  export DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock"
  docker info >/dev/null 2>&1 || fail "docker info 失败（DOCKER_HOST=$DOCKER_HOST；排查：limactl list; ls ~/.lima/$LIMA_NAME/sock）"
  docker image inspect "$SANDBOX_IMAGE" >/dev/null 2>&1 || docker pull "$SANDBOX_IMAGE" >"$LOG_DIR/docker-pull.log" 2>&1 || fail "拉取 $SANDBOX_IMAGE 失败"
  local w0 w1; w0=$(now_ms); docker run --rm "$SANDBOX_IMAGE" true; w1=$(now_ms); rec "lima_warm_container_ms=$((w1-w0))"
  rec "lima_disk=$(du -sh "$HOME/.lima/$LIMA_NAME" | cut -f1) lima_install=$(du -shL "$(brew --prefix lima)" | cut -f1)"
  rec "lima_vm_rss_mb=$(ps -axo rss,command | awk '/limactl|vz|Virtualization/ {s+=$1} END {print int(s/1024)}')"
  pass "Lima docker 可用：$DOCKER_HOST"
}

# ---------------------------------------------------------------- cleanup
cleanup_fastclaw() {
  if [ -f "$POC_HOME/fastclaw.pid" ]; then kill "$(cat "$POC_HOME/fastclaw.pid")" 2>/dev/null || true; sleep 2; fi
  rm -f "$POC_HOME/fastclaw.pid" "$POC_HOME/fastclaw.backend"
}
step_cleanup() {
  info "清理"
  cleanup_fastclaw
  [ -f "$POC_HOME/boxlite.pid" ] && kill "$(cat "$POC_HOME/boxlite.pid")" 2>/dev/null || true
  rm -f "$POC_HOME/boxlite.pid" "$SECRET_FILE"
  if command -v docker >/dev/null && [ -S "$HOME/.lima/$LIMA_NAME/sock/docker.sock" ]; then
    DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock" docker ps -aq --filter label=fastclaw=sandbox \
      | xargs env DOCKER_HOST="unix://$HOME/.lima/$LIMA_NAME/sock/docker.sock" docker rm -f >/dev/null 2>&1 || true
  fi
  if command -v limactl >/dev/null && limactl list -q 2>/dev/null | grep -qx "$LIMA_NAME"; then
    limactl stop "$LIMA_NAME" >/dev/null 2>&1 || true
    [ "${PURGE:-0}" = 1 ] && limactl delete -f "$LIMA_NAME"
  fi
  [ "${PURGE:-0}" = 1 ] && rm -rf "$HOME/.local/opt/boxlite" "$HOME/.local/opt/fastclaw" "$POC_HOME"
  pass "清理完成（PURGE=1 删除安装、数据与 apikey 文件；brew 包需手动 brew uninstall lima docker）"
}

# ---------------------------------------------------------------- report（脱敏）
step_report() {
  info "生成 $REPORT"
  local raw="$POC_HOME/.report.raw"
  {
    echo "# Heybe 沙箱 PoC 报告"; echo; echo "生成时间：$(date '+%F %T %Z')；FastClaw $FASTCLAW_VERSION"; echo
    echo "## 步骤状态"; echo; echo '| 步骤 | 状态 |'; echo '|---|---|'
    for s in "${ALL_STEPS[@]}"; do echo "| $s | $(cat "$STATUS_DIR/$s" 2>/dev/null || echo 未运行) |"; done; echo
    echo "## WebSocket 直测"; echo; echo '```'; grep -E '^(handshake|frames_with_marker):' "$LOG_DIR/ws-probe.txt" 2>/dev/null || echo "（未运行）"; echo '```'; echo
    echo "## 回填表（自动）"; echo; python3 - "$RESULTS" "$STATUS_DIR" <<'PY'
import sys,re,os
res,sd=sys.argv[1:]
m={}; st=lambda k: open(os.path.join(sd,k)).read().strip() if os.path.exists(os.path.join(sd,k)) else "未运行"
lines=open(res).read().splitlines() if os.path.exists(res) else []
for l in lines:
    p=l.split("\t",2)
    if len(p)<3: continue
    if p[0]=="METRIC":
        for kv in re.findall(r'(\[\w+\] )?(\w+)=(\S+)',p[2]): m[(kv[0].strip()+kv[1])]=kv[2]
def r(kind,b,n):
    pat=f"[{b}] 验证{n}"
    hit=[l.split("\t")[0] for l in lines if pat in l]
    return hit[-1] if hit else "未运行"
g=lambda k: m.get(k,"")
rows=[("macOS / 芯片 / 内存",f"{g('macos')} / {g('arch')} / {g('mem_gb')}GB","同左"),
("组件版本",f"boxlite={g('boxlite_version')} / {g('fastclaw_version')}",f"lima_install={g('lima_install')}"),
("REST /v1/default/boxes",g('boxlite_rest_list_http'),"—"),
("验证1 /v1 流式输出",r(0,'boxlite',1),r(0,'docker',1)),
("验证2 ~/Documents 不可读",r(0,'boxlite',2),r(0,'docker',2)),
("验证3 出网被拦",r(0,'boxlite',3),r(0,'docker',3)),
("冷启动 ms",g('boxlite_cold_create_start_ms'),g('lima_cold_start_ms') or g('lima_restart_ms')),
("热启动 ms",g('boxlite_warm_exec_submit_ms'),g('lima_warm_container_ms')),
("首轮对话 ms",g('[boxlite]first_turn_ms'),g('[docker]first_turn_ms')),
("安装/数据体积",f"{g('install_size_boxlite')} / {g('boxlite_data_size')}",f"{g('lima_install')} / {g('lima_disk')}"),
("内存 MB",f"serve={g('boxlite_serve_rss_mb')} vm={g('boxlite_vm_rss_mb')}",g('lima_vm_rss_mb'))]
print("| 项 | BoxLite | Lima+docker |\n|---|---|---|")
for a,b,c in rows: print(f"| {a} | {b or '—'} | {c or '—'} |")
PY
    echo; echo "## results.tsv"; echo; echo '```'; cat "$RESULTS" 2>/dev/null; echo '```'; echo
    echo "## --help 输出"; echo; echo '```'; cat "$LOG_DIR/help.txt" 2>/dev/null || echo "（未运行 install）"; echo '```'; echo
    echo "## 失败步骤日志尾部"; echo
    for s in "${ALL_STEPS[@]}"; do
      [ "$(cat "$STATUS_DIR/$s" 2>/dev/null)" = FAIL ] || continue
      echo "### $s"; echo '```'; tail -n 60 "$LOG_DIR/step-$s.log" 2>/dev/null
      case $s in
        verify-*|fastclaw-*|setup-*) b=${s#*-}; echo "--- fastclaw-$b.log"; tail -n 40 "$LOG_DIR/fastclaw-$b.log" 2>/dev/null ;;
        serve) echo "--- boxlite-serve.log"; tail -n 40 "$LOG_DIR/boxlite-serve.log" 2>/dev/null ;;
        lima) echo "--- lima-start.log"; tail -n 40 "$LOG_DIR/lima-start.log" 2>/dev/null ;;
      esac; echo '```'; echo
    done
  } >"$raw" 2>&1
  # 脱敏：两个 key 的值 → ***；另外抹掉 token:/password/Bearer 形态
  python3 - "$raw" "$REPORT" "$POC_ENV" "$(apikey_file boxlite)" "$(apikey_file docker)" <<'PY'
import sys,re,os
raw,out,envf,*kfs=sys.argv[1:]
secrets=[]
try:
    for l in open(envf):
        m=re.match(r'\s*(?:export\s+)?DEEPSEEK_API_KEY=(.*)',l)
        if m: secrets.append(m.group(1).strip().strip('"\''))
except Exception: pass
for f in kfs:
    try: secrets.append(open(f).read().strip())
    except Exception: pass
t=open(raw,errors="replace").read()
for s in filter(None,secrets): t=t.replace(s,"***")
t=re.sub(r'(?i)(token:\s*)\S+',r'\1***',t)
t=re.sub(r'(?i)(password\S*\s*[:=]\s*)\S+',r'\1***',t)
t=re.sub(r'(?i)(bearer\s+)[A-Za-z0-9._\-]{8,}',r'\1***',t)
t=re.sub(r'sk-[A-Za-z0-9]{16,}','***',t)
open(out,"w").write(t); os.chmod(out,0o600)
PY
  rm -f "$raw"
  echo "报告：$REPORT"
}

# ---------------------------------------------------------------- all
ALL_STEPS=(precheck install serve ws-probe fastclaw-boxlite setup-boxlite verify-boxlite metrics lima fastclaw-docker setup-docker verify-docker)
deps_of() { # macOS 自带 bash 3.2 没有关联数组
  case $1 in
    install|lima) echo precheck ;; serve|metrics) echo install ;; ws-probe|fastclaw-boxlite) echo serve ;;
    setup-boxlite) echo fastclaw-boxlite ;; verify-boxlite) echo setup-boxlite ;;
    fastclaw-docker) echo "lima install" ;; setup-docker) echo fastclaw-docker ;; verify-docker) echo setup-docker ;;
  esac
}
run_one() { # name -> 在子 shell 里跑，记状态，不中断 all
  local s=$1 d
  for d in $(deps_of "$s"); do
    if [ "$(cat "$STATUS_DIR/$d" 2>/dev/null)" != PASS ]; then
      echo SKIP >"$STATUS_DIR/$s"; printf 'SKIP\t%s\t%s（依赖 %s 未通过）\n' "$(date +%FT%T)" "$s" "$d" >>"$RESULTS"
      printf '\033[33mSKIP\033[0m %s（依赖 %s 未通过）\n' "$s" "$d"; return 0; fi
  done
  if ( set -euo pipefail; dispatch "$s" ) > >(tee "$LOG_DIR/step-$s.log") 2>&1; then echo PASS >"$STATUS_DIR/$s"; else echo FAIL >"$STATUS_DIR/$s"; fi
  sleep 0.2
}
dispatch() {
  case $1 in
    precheck) step_precheck ;; install) step_install ;; serve) step_serve ;; ws-probe) step_ws_probe ;;
    fastclaw-boxlite) start_fastclaw boxlite ;; setup-boxlite) step_setup boxlite ;; verify-boxlite) step_verify boxlite ;;
    metrics) step_metrics ;; lima) step_lima ;;
    fastclaw-docker) cleanup_fastclaw; start_fastclaw docker ;; setup-docker) step_setup docker ;; verify-docker) step_verify docker ;;
    *) echo "未知步骤 $1" >&2; return 2 ;;
  esac
}
step_all() {
  rm -f "$STATUS_DIR"/*; : >"$RESULTS"
  local s; for s in "${ALL_STEPS[@]}"; do run_one "$s"; done
  step_report
  echo "完成（未自动 cleanup；需要时运行 cleanup）。失败/跳过的步骤见 $REPORT"
}

case "${1:-}" in
  all) step_all ;;
  precheck|install|ws-probe|metrics|lima) dispatch "$1" ;;
  serve) step_serve; step_ws_probe ;;
  fastclaw-boxlite|fastclaw-docker) dispatch "$1" ;;
  setup) step_setup "${2:?backend: boxlite|docker}" ;;
  verify) step_verify "${2:?backend: boxlite|docker}" ;;
  report) step_report ;;
  cleanup-fastclaw) cleanup_fastclaw; pass "FastClaw 已停止" ;;
  cleanup) step_cleanup ;;
  *) sed -n 2,11p "$0"; exit 2 ;;
esac
