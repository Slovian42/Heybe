#!/usr/bin/env bash
# lib-fc-agent.sh 的干跑测试：假 /v1/agents（分页）+ 假 fastclaw CLI，覆盖 id 查找的各级兜底。不需要 FastClaw/密钥。
# 用法: scripts/poc/fc-agent-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-fc-agent.sh
. "$SCRIPT_DIR/lib-fc-agent.sh"
T=$(mktemp -d); trap 'kill "${MPID:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
python3 - "$PORT" <<'PY' &
import sys,json,http.server
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        if self.headers.get("Authorization")!="Bearer k1": code,obj=401,{"error":{"code":"unauthorized"}}
        elif "cursor=c2" in self.path: code,obj=200,{"agents":[{"id":"agt_new2","display_name":"poc"},{"id":"agt_old1","display_name":"poc"}],"has_more":False}
        else: code,obj=200,{"agents":[{"id":"agt_x","display_name":"poc2"},{"id":"agt_y","display_name":"other"}],"has_more":True,"next_cursor":"c2"}
        b=json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
PY
MPID=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT" && break; sleep 0.1; done
n=0
eq() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "ASSERT FAIL [$1]: 期望 '$3'，实际 '$2'" >&2; exit 1; }; }
# 假 CLI：输出格式参照 fastclaw agents list（表格，含名字和 id）
mkdir -p "$T/bin"
cat >"$T/bin/fastclaw" <<'SH'
#!/bin/sh
[ "$1 $2" = "agents list" ] || exit 2
printf 'ID              NAME   MODEL\nagt_cli9        poc2   deepseek/deepseek-chat\nagt_cli7        poc    deepseek/deepseek-chat\n'
SH
chmod +x "$T/bin/fastclaw"
echo agt_cache5 >"$T/agent-id"
NOFC="$T/no-such-fastclaw"

eq "API 翻页 + display_name 精确匹配（同名取最新）" "$(FASTCLAW_API_KEY=k1 fc_resolve_agent_id "$PORT" poc "$NOFC")" agt_new2
eq "手动 agt_ 直接用" "$(FASTCLAW_API_KEY=k1 fc_resolve_agent_id "$PORT" agt_manual "$NOFC")" agt_manual
eq "API 401 → CLI 整词匹配" "$(FASTCLAW_API_KEY=bad fc_resolve_agent_id "$PORT" poc "$T/bin/fastclaw")" agt_cli7
eq "API/CLI 都没有 → setup 缓存" "$(FASTCLAW_API_KEY=bad fc_resolve_agent_id "$PORT" poc "$NOFC" "$T/agent-id")" agt_cache5
rc=0; err=$(FASTCLAW_API_KEY=k1 fc_resolve_agent_id "$PORT" nobody "$NOFC" 2>&1 >/dev/null) || rc=$?
eq "全查不到 → 返回 1" "$rc" 1
case "$err" in *HEYBE_POC_AGENT=agt_*) ;; *) echo "ASSERT FAIL: 失败提示里没有手动指定方法：$err" >&2; exit 1 ;; esac
eq "init 输出（新建）" "$(fc_agent_id_from_init "$(printf 'Created agent poc\nAgent ID: agt_abc-1\nadmin password: xxx\n')")" agt_abc-1
eq "init 输出（已存在）" "$(fc_agent_id_from_init 'Error: agent "poc" already exists (id agt_def_2)')" agt_def_2
eq "init 输出（无 id）" "$(fc_agent_id_from_init 'something else')" ""
echo "fc-agent mock test: PASS（${n} 项）"
