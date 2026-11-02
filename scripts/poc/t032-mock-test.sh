#!/usr/bin/env bash
# t032-runtime-checks.sh 的干跑测试：临时 HOME + 假 FastClaw（模拟 /v1 SSE 与工具事件），不需要 BoxLite/密钥。
# 用法: scripts/poc/t032-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d); trap 'kill "${MPID:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
export HOME="$T/home" HEYBE_POC_HOME="$T/poc" T032_NO_START=1
mkdir -p "$HOME/Documents" "$HEYBE_POC_HOME/boxlite"
echo keep >"$HOME/Documents/user-file.txt"
( umask 077; printf 'mock-key' >"$HEYBE_POC_HOME/boxlite/fastclaw-apikey" )
echo boxlite >"$HEYBE_POC_HOME/fastclaw.backend"
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
export FASTCLAW_PORT=$PORT
python3 - "$PORT" <<'PY' &
import sys,json,re,http.server
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_POST(self):
        assert self.headers["Authorization"]=="Bearer mock-key"
        p=json.loads(self.rfile.read(int(self.headers["Content-Length"])))["messages"][0]["content"]
        ev=[]
        if "write_file" in p:
            m=re.search(r"path '([^']+)' with exactly this content: (\S+)",p); open(m.group(1),"w").write(m.group(2)+"\n")
            ev=[{"tool":{"id":"1","name":"write_file","status":"done"}}]; txt="DONE"
        elif "CAMOUFOX" in p: ev=[{"tool":{"id":"2","name":"exec","status":"done"}}]; txt="OS=Linux\nCAMOUFOX=no"
        elif "delegate_task" in p:
            ev=[{"tool":{"id":"3","name":"exec","status":"done"}},{"tool":{"id":"4","name":"delegate_task","status":"done"}}]
            txt="PARENT BOOT=aaaa-1111 HN=box1\nCHILD BOOT=aaaa-1111 HN=box1"
        else: txt="TOOLS: exec, read_file, write_file, web_fetch, delegate_task"
        self.send_response(200); self.send_header("Content-Type","text/event-stream"); self.end_headers()
        for e in ev+[{"choices":[{"delta":{"content":txt}}]},{"choices":[{"delta":{},"finish_reason":"stop"}]}]:
            self.wfile.write(b"data: "+json.dumps(e).encode()+b"\n\n")
        self.wfile.write(b"data: [DONE]\n\n")
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
PY
MPID=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT" && break; sleep 0.1; done
out=$("$SCRIPT_DIR/t032-runtime-checks.sh")
echo "$out"
R="$HEYBE_POC_HOME/t032-report.md"
ok() { grep -q "$1" "$R" || { echo "ASSERT FAIL: $1" >&2; exit 1; }; }
ok '| C1 文件工具写 ~/Documents（B1） | B1 成立 |.*已删除临时文件'
ok '| C2 沙箱镜像内 camoufox-cli | 无 |'
ok '| C3 delegate_task 子 Agent 沙箱 | 同一沙箱 |'
ok '| C4 host_exec 未注册 | PASS |'
[ "$(ls "$HOME/Documents")" = user-file.txt ] || { echo "ASSERT FAIL: ~/Documents 有残留或用户文件被动" >&2; exit 1; }
! grep -q mock-key "$R" "$HEYBE_POC_HOME"/logs/* || { echo "ASSERT FAIL: 报告/日志含密钥" >&2; exit 1; }
echo "t032 mock test: PASS"
