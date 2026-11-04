#!/usr/bin/env bash
# product-sandbox-check.sh 的干跑测试：假本地服务进程树（服务 + 代理 + 假 serve + 假 gateway 子进程）、假 fastclaw。
# 模式 good 应 8 项全 PASS；bad 逐项出错；nosock 旧版服务没有自检接口；refuse 模型拒绝执行（HEYBE_CHECK_CHAT=1 只作参考，
# 仍 8 项全 PASS）；没有状态文件时直接 FAIL。全程不应打印任何假密钥。
# 用法: scripts/dev/product-sandbox-check-mock-test.sh   （任一断言失败退出码非 0；Linux 用 ss，macOS 用 lsof）
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CHECK="$HERE/product-sandbox-check.sh"
T=$(mktemp -d)
ROOT_PID=""
stop_fake() {
  [ -n "$ROOT_PID" ] || return 0
  kill "$ROOT_PID" 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$ROOT_PID" 2>/dev/null || break; sleep 0.2; done
  ROOT_PID=""
}
trap 'stop_fake; rm -rf "$T"' EXIT
FAILS=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; FAILS=$((FAILS + 1)); }
has() { if grep -qF -- "$2" "$T/out"; then ok "$1"; else bad "$1（输出里没有：$2）"; sed 's/^/       | /' "$T/out"; fi; }
hasnt() { if grep -qF -- "$2" "$T/out"; then bad "$1（输出里不该有：$2）"; else ok "$1"; fi; }

# 假密钥：只在这个测试的变量和子进程环境里
SVC_TOKEN="svc-token-$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
SERVE_KEY="serve-key-$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
GW_KEY="gw-boxkey-$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
FC_KEY="fc-apikey-$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
DS_KEY="sk-mock$(python3 -c 'import secrets;print(secrets.token_hex(12))')"
ALL_KEYS="$SVC_TOKEN $SERVE_KEY $GW_KEY $FC_KEY $DS_KEY"

T021="$T/t021"; STATE="$T021/service-state"
mkdir -p "$T021/fastclaw-home/fake" "$T/bin"
( umask 077; printf '%s' "$FC_KEY" >"$T021/fastclaw-apikey"; printf 'DEEPSEEK_API_KEY=%s\n' "$DS_KEY" >"$T/poc.env" )
cat >"$T/bin/fastclaw" <<'SH'
#!/bin/sh
# agents config <id> get <key>
[ "$1 $2 $4" = "agents config get" ] && { cat "$FASTCLAW_HOME/fake/camoufox"; exit 0; }
exit 1
SH
chmod +x "$T/bin/fastclaw"

cat >"$T/fake-service.py" <<'PY'
import json, os, subprocess, sys, time, signal, http.server, threading, socketserver
mode, state = sys.argv[1], sys.argv[2]

class Srv(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def serve(host, handler):
    s = Srv((host, 0), handler); threading.Thread(target=s.serve_forever, daemon=True).start(); return s.server_address[1]

class H401(http.server.BaseHTTPRequestHandler):
    # 像真的 serve：GET /v1/config 是公开路由（永远 200）；其余不带 key → 401，FAKE_OPEN=1 时 200（serve 没拿到 key）
    public_config = False
    def log_message(self, *a): pass
    def reply(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n: self.rfile.read(n)
        if self.public_config and self.path == "/v1/config": code = 200
        else: code = 200 if os.environ.get("FAKE_OPEN") == "1" else 401
        self.send_response(code); self.send_header("Content-Length", "0"); self.end_headers()
    do_GET = reply
    do_POST = reply

class Serve(H401):
    public_config = True

class GW(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def auth(self):
        if self.headers.get("Authorization") != "Bearer " + os.environ["FAKE_FC_KEY"]:
            self.send_response(401); self.send_header("Content-Length", "0"); self.end_headers(); return False
        return True
    def do_GET(self):
        if not self.auth(): return
        b = json.dumps({"agents": [{"id": "agt_mock1", "display_name": "heybe-t021"}], "has_more": False}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_POST(self):
        if not self.auth(): return
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        open(os.environ["FAKE_PROMPT"], "w").write(body["messages"][0]["content"])
        m = os.environ["FAKE_MODE"]
        ext = "OPEN" if m == "bad" else "NET_BLOCKED"
        chunks = [] if m == "refuse" else [{"tool": {"name": "exec", "status": "running"}}, {"tool": {"name": "exec", "status": "done"}}]
        chunks.append({"choices": [{"delta": {"content": f"CURL=yes\nEXT={ext}\nHOST8100=NET_BLOCKED\nHOST11434=NET_BLOCKED\nDNS=NET_BLOCKED\n"}}]})
        self.send_response(200); self.send_header("Content-Type", "text/event-stream"); self.end_headers()
        for c in chunks: self.wfile.write(f"data: {json.dumps(c)}\n\n".encode())
        self.wfile.write(b"data: [DONE]\n\n")

class SelfcheckSrv(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

class SC(http.server.BaseHTTPRequestHandler):
    # 假自检接口：像本地服务那样经代理建箱 → 代理日志新增一条建箱 POST → 回标记（bad：没强制禁出网，EXT=OPEN）
    def log_message(self, *a): pass
    def address_string(self): return "unix"
    def do_POST(self):
        bad = os.environ["FAKE_MODE"] == "bad"
        with open(os.path.join(state, "sandbox.log"), "a") as f:
            f.write("x POST /v1/boxes: stripped auto_remove; network set\n" if bad else "x POST /v1/boxes: stripped auto_remove; network set; outbound=disabled\n")
        mk = {"CURL": "yes", "EXT": "OPEN" if bad else "NET_BLOCKED", "HOST8100": "NET_BLOCKED", "HOST11434": "NET_BLOCKED", "DNS": "NET_BLOCKED"}
        b = json.dumps({"ok": not bad, "request_network": "not_specified", "image": "thinkany/fastclaw-sandbox:latest", "create_http": 201,
                        "start_http": 204, "exec_http": 201, "attach": "101", "markers": mk, "delete_http": 204, "elapsed_ms": 4200}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)

role = os.environ.get("FAKE_ROLE", "root")
if role == "serve":
    print(serve("127.0.0.1", Serve), flush=True); time.sleep(3600)
if role == "gateway":
    print(serve("0.0.0.0" if os.environ["FAKE_MODE"] == "bad" else "127.0.0.1", GW), flush=True); time.sleep(3600)

kids = []
def child(r, extra):
    env = dict(os.environ, FAKE_ROLE=r, **extra)
    p = subprocess.Popen([sys.executable, __file__, mode, state], env=env, stdout=subprocess.PIPE, text=True)
    kids.append(p); return int(p.stdout.readline())
def bye(*_):
    for p in kids: p.kill()
    sys.exit(0)
signal.signal(signal.SIGTERM, bye)
serve_port = child("serve", {"BOXLITE_SERVE_API_KEY": os.environ["FAKE_SERVE_KEY"], "FAKE_OPEN": "1" if mode == "bad" else "0"})
gw_env = {"FASTCLAW_DEPLOY": "hosted", "BOXLITE_API_KEY": os.environ["FAKE_GW_KEY"]}
if mode == "bad": gw_env["FASTCLAW_ALLOW_HOST_EXEC"] = "1"
gw_port = child("gateway", gw_env)
proxy_port = serve("127.0.0.1", H401)
svc_port = serve("127.0.0.1", H401)
if mode == "bad":  # 密钥出现在 argv
    kids.append(subprocess.Popen([sys.executable, "-c", "import time; time.sleep(3600)", os.environ["FAKE_SERVE_KEY"]]))
os.makedirs(state, mode=0o700, exist_ok=True)
with open(os.path.join(state, "sandbox.log"), "w") as f:
    f.write(f"x listening 127.0.0.1:{proxy_port} -> 127.0.0.1:{serve_port} (outbound network forced to disabled; auto_remove stripped)\n")
    f.write("x refused GET /v1/boxes: box creation route without network override\n")
    f.write("x POST /v1/default/boxes: network set; outbound=disabled\n" if mode != "bad" else "x POST /v1/default/boxes: network set\n")
json.dump({"pid": os.getpid(), "service_port": svc_port, "sandbox": "boxlite", "deploy": "hosted",
           "gateway_port": gw_port, "serve_port": serve_port, "proxy_port": proxy_port, "started_at": "x"},
          open(os.path.join(state, "service-state.json"), "w"))
if mode != "nosock":
    sock = os.path.join(state, "selfcheck.sock")
    sc = SelfcheckSrv(sock, SC); os.chmod(sock, 0o600)
    threading.Thread(target=sc.serve_forever, daemon=True).start()
open(os.path.join(state, "task-manager.pid"), "w").write(f"{os.getpid()}\n")
time.sleep(3600)
PY

start_fake() { # mode camoufox值
  stop_fake; rm -rf "$STATE"; printf '%s\n' "$2" >"$T021/fastclaw-home/fake/camoufox"
  HEYBE_SERVICE_TOKEN="$SVC_TOKEN" FAKE_SERVE_KEY="$SERVE_KEY" FAKE_GW_KEY="$GW_KEY" FAKE_FC_KEY="$FC_KEY" \
    FAKE_MODE="$1" FAKE_PROMPT="$T/prompt.txt" python3 "$T/fake-service.py" "$1" "$STATE" &
  ROOT_PID=$!
  for _ in $(seq 1 50); do [ -s "$STATE/task-manager.pid" ] && return 0; sleep 0.1; done
  echo "假服务没起来" >&2; exit 1
}
run_check() { # 退出码写 $T/rc；可在前面加 HEYBE_CHECK_CHAT=1
  HEYBE_T021_HOME="$T021" HEYBE_FASTCLAW_BIN="$T/bin/fastclaw" HEYBE_POC_ENV="$T/poc.env" HEYBE_CHECK_LOG_DIR="$T" \
    bash "$CHECK" >"$T/out" 2>&1
  echo $? >"$T/rc"
}
no_keys() { local k n=0; for k in $ALL_KEYS; do grep -qF -- "$k" "$T/out" && n=$((n + 1)); done
  if [ "$n" = 0 ]; then ok "$1：输出里没有任何假密钥"; else bad "$1：输出里出现了 ${n} 个假密钥"; fi; }

echo "== 1 没有状态文件"
rm -rf "$STATE"; run_check
[ "$(cat "$T/rc")" != 0 ] && ok "退出码非 0" || bad "没有状态文件也返回 0"
has "提示用 --sandbox boxlite 启动" "--sandbox boxlite"
has "汇总全 FAIL" "PASS 0 / FAIL 8"

echo "== 2 good：全部 PASS"
start_fake good false; run_check
[ "$(cat "$T/rc")" = 0 ] && ok "退出码 0" || { bad "退出码 $(cat "$T/rc")"; sed 's/^/       | /' "$T/out"; }
for i in 1 2 3 4 5 6 7 8; do has "第 ${i} 项 PASS" "PASS ${i}/8"; done
has "汇总" "PASS 8 / FAIL 0"
has "代理日志拒绝行单独计数" "拒绝 1 条"
has "serve 的 /v1/config 公开 200 不算失败（#90 第三次复验第 1 项的根因）" "GET /v1/config=200，公开路由，不计"
has "第 3 项看的是本次自检新增的建箱记录" "新增建箱 POST 1 条，全部 outbound=disabled"
has "第 7 项走自检接口" "沙箱自检：外网、宿主机 serve"
hasnt "默认不做对话" "参考（不计入）"
[ ! -e "$T/prompt.txt" ] && ok "默认没有给模型发对话" || bad "默认不该发对话"
no_keys good

echo "== 3 bad：逐项出错"
start_fake bad true; run_check
[ "$(cat "$T/rc")" = 1 ] && ok "退出码 1" || bad "退出码 $(cat "$T/rc")"
for i in 1 2 3 5 6 7 8; do has "第 ${i} 项 FAIL" "FAIL ${i}/8"; done
has "第 3 项：本次建箱没 outbound=disabled" "本次新增建箱 POST 1 条，其中 outbound=disabled 0 条"
has "部署模式仍是 hosted" "PASS 4/8"
has "不在 127.0.0.1 的计数" "其中不在 127.0.0.1 的 1 个"
has "外网未拦截" "EXT=OPEN"
has "camoufox 读回 true" "读回「true」"
has "argv 已知密钥命中" "已知值 1"
no_keys bad

echo "== 4 nosock：旧版服务没有自检接口"
start_fake nosock false; run_check
[ "$(cat "$T/rc")" = 1 ] && ok "退出码 1" || bad "退出码 $(cat "$T/rc")"
has "第 7 项 FAIL 并提示重启" "FAIL 7/8 没有自检接口"
has "第 3 项 FAIL（本次没有新建箱记录）" "FAIL 3/8"
has "其余 6 项 PASS" "PASS 6 / FAIL 2"
no_keys nosock

echo "== 5 refuse：HEYBE_CHECK_CHAT=1，模型拒绝执行，只作参考"
start_fake refuse false
HEYBE_CHECK_CHAT=1 run_check
[ "$(cat "$T/rc")" = 0 ] && ok "退出码 0（对话不计入）" || { bad "退出码 $(cat "$T/rc")"; sed 's/^/       | /' "$T/out"; }
has "参考行" "参考（不计入）/v1 对话：模型没调 exec"
has "仍 8 项 PASS" "PASS 8 / FAIL 0"
SERVE_PORT=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["serve_port"])' "$STATE/service-state.json")
if grep -qF ":${SERVE_PORT}/v1/config" "$T/prompt.txt" && ! grep -qF ':8100/' "$T/prompt.txt"; then ok "参考对话的探测命令里宿主机端口换成了 serve 端口 ${SERVE_PORT}"
else bad "探测命令没换端口"; fi
no_keys refuse
stop_fake

if [ "$FAILS" = 0 ]; then echo "全部通过"; else echo "失败 ${FAILS} 项"; exit 1; fi
