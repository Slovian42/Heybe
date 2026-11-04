#!/usr/bin/env bash
# t032-runtime-checks.sh 的干跑测试：临时 HOME + 假 FastClaw（模拟 /v1 SSE 与工具事件），不需要 BoxLite/密钥。
# 假 FastClaw 和真的一样只认 agt_… id：传名字 poc 会 404 agent_not_found；GET /v1/agents 分两页返回。
# 用法: scripts/poc/t032-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
T=$(mktemp -d); trap 'kill "${MPID:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
export HOME="$T/home" HEYBE_POC_HOME="$T/poc" T032_NO_START=1
mkdir -p "$HOME/Documents" "$HEYBE_POC_HOME/boxlite"
echo keep >"$HOME/Documents/user-file.txt"
( umask 077; printf 'mock-key' >"$HEYBE_POC_HOME/boxlite/fastclaw-apikey" )
echo boxlite >"$HEYBE_POC_HOME/fastclaw.backend"; echo self-hosted >"$HEYBE_POC_HOME/fastclaw.deploy"
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
export FASTCLAW_PORT=$PORT
python3 - "$PORT" "$T/hosted" "$T/edit-bad" <<'PY' &
import sys,os,json,re,http.server
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def js(self,code,obj):
        b=json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if not self.path.startswith("/v1/agents"): return self.js(404,{"error":{"code":"not_found"}})
        if self.headers.get("Authorization")!="Bearer mock-key": return self.js(401,{"error":{"code":"unauthorized"}})
        if "cursor=p2" in self.path:
            return self.js(200,{"agents":[{"id":"agt_mock123","name":"agt_mock123","display_name":"poc"}],"has_more":False,"next_cursor":None})
        return self.js(200,{"agents":[{"id":"agt_other9","name":"agt_other9","display_name":"poc-old-copy"}],"has_more":True,"next_cursor":"p2"})
    def do_POST(self):
        assert self.headers["Authorization"]=="Bearer mock-key"
        j=json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if j.get("agent_id")!="agt_mock123" or self.headers.get("x-fastclaw-agent-id")!="agt_mock123":
            return self.js(404,{"error":{"code":"agent_not_found","message":"agent not found"}})
        p=j["messages"][0]["content"]
        ev=[]
        hosted=os.path.exists(sys.argv[2])   # 模拟 FASTCLAW_DEPLOY=hosted：文件工具都不碰宿主机
        if "apply_patch" in p and "old_string" not in p:   # C1b 提示词里也写了“禁止 apply_patch”；沙箱版 apply_patch 只写沙箱（与源码一致），两种模式都不碰宿主机
            ev=[{"tool":{"id":"1","name":"apply_patch","status":"done"}}]; txt="DONE"
        elif "edit_file" in p:
            m=re.search(r'"path":"([^"]+)","old_string":"([^"]+)","new_string":"([^"]+)"',p)
            bad=sys.argv[3]   # 文件里的数字 = 还要“不听话”几次：先 read_file 再 exec，不调 edit_file
            n=int(open(bad).read() or 0) if os.path.exists(bad) else 0
            if n>0:
                open(bad,"w").write(str(n-1))
                ev=[{"tool":{"id":"1","name":"read_file","status":"running"}},{"tool":{"id":"1","name":"read_file","status":"done"}},
                    {"tool":{"id":"2","name":"exec","status":"done"}}]; txt="I used exec instead"
            else:
                if not hosted: c=open(m.group(1)).read(); open(m.group(1),"w").write(c.replace(m.group(2),m.group(3)))
                ev=[{"tool":{"id":"1","name":"edit_file","status":"running"}},{"tool":{"id":"1","name":"edit_file","status":"done"}}]; txt="DONE"
        elif "write_file" in p:
            m=re.search(r"path '([^']+)' with exactly this content: (\S+)",p)
            if not hosted: open(m.group(1),"w").write(m.group(2)+"\n")
            ev=[{"tool":{"id":"1","name":"write_file","status":"done"}}]; txt="DONE"
        elif "CAMOUFOX" in p: ev=[{"tool":{"id":"2","name":"exec","status":"done"}}]; txt="OS=Linux\nCAMOUFOX=no"
        elif "delegate_task" in p:
            ev=[{"tool":{"id":"3","name":"exec","status":"done"}},{"tool":{"id":"4","name":"delegate_task","status":"done"}}]
            txt="PARENT BOOT=aaaa-1111 HN=box1\nCHILD BOOT=aaaa-1111 HN=box1"
        else: txt="TOOLS: exec, read_file, write_file, edit_file, apply_patch, web_fetch, delegate_task"
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
echo "$out" | grep -q '/v1 使用 Agent id agt_mock123' || { echo "ASSERT FAIL: 没按名字 poc 查到 agt_mock123" >&2; exit 1; }
R="$HEYBE_POC_HOME/t032-report.md"
ok() { grep -q "$1" "$R" || { echo "ASSERT FAIL: $1" >&2; exit 1; }; }
ok '| C1a write_file 写 ~/Documents（B1） | B1 成立 |.*已删除临时文件'
ok '| C1b edit_file 改 ~/Documents（B1） | B1 成立 |.*已删除临时文件'
ok '| C1c apply_patch 写 ~/Documents（B1） | 未落宿主机 |'
ok '| C2 沙箱镜像内 camoufox-cli | 无 |'
ok '| C3 delegate_task 子 Agent 沙箱 | 同一沙箱 |'
ok '| C4 host_exec 未注册 | PASS |'
ok '| C4b 能写文件的工具 | 有：write_file,edit_file,apply_patch |'
clean() {
  [ "$(ls "$HOME/Documents")" = user-file.txt ] || { echo "ASSERT FAIL: ~/Documents 有残留或用户文件被动" >&2; exit 1; }
  [ "$(cat "$HOME/Documents/user-file.txt")" = keep ] || { echo "ASSERT FAIL: 用户文件内容被改" >&2; exit 1; }
  ! grep -q mock-key "$R" "$HEYBE_POC_HOME"/logs/* || { echo "ASSERT FAIL: 报告/日志含密钥" >&2; exit 1; }
}
clean

# 第二轮：模拟 FASTCLAW_DEPLOY=hosted（文件工具不碰宿主机），三个 C1 子项都应是“未落宿主机”，临时文件都清掉
: >"$T/hosted"; echo hosted >"$HEYBE_POC_HOME/fastclaw.deploy"
"$SCRIPT_DIR/t032-runtime-checks.sh" >/dev/null
ok '| C1a write_file 写 ~/Documents（B1） | 未落宿主机 |'
ok '| C1b edit_file 改 ~/Documents（B1） | 未落宿主机 |.*已删除临时文件'
ok '| C1c apply_patch 写 ~/Documents（B1） | 未落宿主机 |'
ok 'FastClaw 部署模式：hosted'
clean

# 第三轮：前 2 次模型不听话（read_file + exec），第 3 次才只调 edit_file → 按第 3 次判定
echo 2 >"$T/edit-bad"
"$SCRIPT_DIR/t032-runtime-checks.sh" >/dev/null
ok '| C1b edit_file 改 ~/Documents（B1） | 未落宿主机 |.*edit_file（第 3 次尝试）'
[ -s "$HEYBE_POC_HOME/logs/t032-edit_file-try1-tools.txt" ] && grep -q '^exec done$' "$HEYBE_POC_HOME/logs/t032-edit_file-try1-tools.txt" \
  || { echo "ASSERT FAIL: 第 1 次的工具事件没留档" >&2; exit 1; }
clean

# 第四轮：3 次都不听话 → INCONCLUSIVE，不是 PASS/未落宿主机；临时文件清理
echo 3 >"$T/edit-bad"
"$SCRIPT_DIR/t032-runtime-checks.sh" >/dev/null
ok '| C1b edit_file 改 ~/Documents（B1） | INCONCLUSIVE（未判定） |.*第1次\[exec done,read_file done,read_file running\]'
! grep -q '| C1b edit_file 改 ~/Documents（B1） | \(PASS\|未落宿主机\|B1 成立\) |' "$HEYBE_POC_HOME/t032-report.md" || { echo "ASSERT FAIL: 3 次无效却给了结论" >&2; exit 1; }
clean

# 第五轮：非 hosted 模式下第 2 次才听话 → 仍能判出 B1 成立（重试前文件被恢复成原值）
rm -f "$T/hosted"; echo self-hosted >"$HEYBE_POC_HOME/fastclaw.deploy"; echo 1 >"$T/edit-bad"
"$SCRIPT_DIR/t032-runtime-checks.sh" >/dev/null
ok '| C1b edit_file 改 ~/Documents（B1） | B1 成立 |.*edit_file（第 2 次尝试）'
clean
echo "t032 mock test: PASS"
