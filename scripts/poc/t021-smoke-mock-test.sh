#!/usr/bin/env bash
# t021-mac.sh 聊天冒烟测试开关的干跑测试（#19 Mac 复验 ③b）：假 fastclaw（含假 gateway）+ 假 pnpm，只用假 key。
# 覆盖：默认照常冒烟；HEYBE_SKIP_CHAT_SMOKE=1 跳过并打中文提示；默认遇到上游 401 → E_KEY_INVALID 退出并删指纹；
#       单独跑 t021 时 HEYBE_SKIP_KEY_TEST=1 不影响冒烟；heybe-desktop-dev.sh 的调用方式（HEYBE_SKIP_KEY_TEST=1 → 跳过）。
# 用法: scripts/poc/t021-smoke-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=lib-fc-env.sh
. "$SCRIPT_DIR/lib-fc-env.sh"
# shellcheck source=lib-fc-agent.sh
. "$SCRIPT_DIR/lib-fc-agent.sh"
# shellcheck source=lib-fc-key.sh
. "$SCRIPT_DIR/lib-fc-key.sh"
unset DEEPSEEK_API_KEY HEYBE_SKIP_KEY_TEST HEYBE_SKIP_CHAT_SMOKE  # 只用假 key；外面的开关不算数
T=$(mktemp -d)
cleanup() { [ -f "$T/t021/gateway.pid" ] && kill "$(cat "$T/t021/gateway.pid")" 2>/dev/null; rm -rf "$T"; }
trap cleanup EXIT
n=0
eq() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "ASSERT FAIL [$1]: 期望 '$3'，实际 '$2'" >&2; exit 1; }; }
ok_() { n=$((n + 1)); "$@" || { echo "ASSERT FAIL: $*" >&2; exit 1; }; }
no_() { n=$((n + 1)); if "$@"; then echo "ASSERT FAIL (不应成立): $*" >&2; exit 1; fi; }
has() { case "$1" in *"$2"*) return 0 ;; esac; return 1; }

export HOME="$T/home" HEYBE_T021_HOME="$T/t021" HEYBE_POC_ENV="$T/poc.env"
export HEYBE_T021_PORT
HEYBE_T021_PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
mkdir -p "$HOME/.local/opt/fastclaw/bin" "$T/bin"
printf 'DEEPSEEK_API_KEY=sk-mock-smoke-0000aaaa\n' >"$HEYBE_POC_ENV"; chmod 600 "$HEYBE_POC_ENV"

# 假 fastclaw：version / gateway（python 回 200）/ agents list|init / apikey create
cat >"$HOME/.local/opt/fastclaw/bin/fastclaw" <<'SH'
#!/usr/bin/env bash
st="${FASTCLAW_HOME}/fake-agents"
case "$1 ${2:-}" in
  "version "*) echo "fastclaw v1.4.0"; exit 0 ;;
  "gateway --port") exec python3 -c 'import sys,http.server
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self): self.send_response(200); self.send_header("Content-Length","2"); self.end_headers(); self.wfile.write(b"ok")
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()' "$3" ;;
  "agents list") printf 'ID              NAME        MODEL\n'; [ -f "$st" ] && cat "$st"; exit 0 ;;
  "agents init")
    echo "Admin password: not-kept"
    if ! grep -q -- "--id" <<<"$*"; then echo "agt_fake0001  $3  deepseek" >>"$st"; echo "Agent ID: agt_fake0001"; fi
    exit 0 ;;
  "apikey create") echo "token: tok-mock-smoke"; exit 0 ;;
esac
exit 2
SH
# 假 pnpm：install 直接成功；dlx（对话）按 $T/mode 返回成功或上游 401，并记一次“被调用”
cat >"$T/bin/pnpm" <<SH
#!/usr/bin/env bash
[ "\$1" = install ] && exit 0
echo called >>"$T/chat-called"
if [ "\$(cat "$T/mode")" = 401 ]; then
  echo "API error 401: Authentication Fails" >>"\${HEYBE_T021_HOME}/gateway.log"
  echo '{"stream_ok":false,"error_code":"agent_error","error_kind":"stream_error"}'; exit 1
fi
echo '{"stream_ok":true,"first_token_ms":5,"total_ms":9,"error_code":null}'
SH
chmod +x "$HOME/.local/opt/fastclaw/bin/fastclaw" "$T/bin/pnpm"
export PATH="$T/bin:$PATH"
T021="$REPO_ROOT/scripts/poc/t021-mac.sh"
FP="$(heybe_key_fp_file "$HEYBE_T021_HOME")"
REPORT="$HEYBE_T021_HOME/t021-report.txt"
run() { rc=0; : >"$T/chat-called"; out=$("$@" 2>&1) || rc=$?; }
port_closed() { ! curl -s -o /dev/null -m 1 "http://127.0.0.1:${HEYBE_T021_PORT}/healthz"; }

# ---- 1. 默认：照常做冒烟测试，成功 ----
echo ok >"$T/mode"
run "$BASH" "$T021"
eq "默认成功 rc" "$rc" 0
eq "默认做了冒烟" "$(wc -l <"$T/chat-called" | tr -d ' ')" 1
eq "默认结果" "$(heybe_t021_result_code "$REPORT")" none
ok_ test -s "$FP"
ok_ port_closed

# ---- 2. HEYBE_SKIP_CHAT_SMOKE=1 + 上游 401：跳过，不调用对话，打中文提示 ----
echo 401 >"$T/mode"
run env HEYBE_SKIP_CHAT_SMOKE=1 "$BASH" "$T021"
eq "跳过 rc" "$rc" 0
eq "跳过时没调用对话" "$(wc -l <"$T/chat-called" | tr -d ' ')" 0
ok_ has "$out" "已跳过聊天冒烟测试"
ok_ has "$out" "测试用法"
eq "跳过结果" "$(heybe_t021_result_code "$REPORT")" smoke_skipped
ok_ grep -q '^chat_smoke=skipped$' "$REPORT"
ok_ port_closed

# ---- 3. 默认 + 上游 401：E_KEY_INVALID 退出，删掉指纹 ----
run "$BASH" "$T021"
eq "401 rc" "$rc" 1
eq "401 做了冒烟" "$(wc -l <"$T/chat-called" | tr -d ' ')" 1
ok_ has "$out" "E_KEY_INVALID"
ok_ has "$out" "模型密钥无效"
eq "401 结果" "$(heybe_t021_result_code "$REPORT")" E_KEY_INVALID
no_ test -e "$FP"
ok_ port_closed

# ---- 4. 单独跑 t021：HEYBE_SKIP_KEY_TEST=1 不跳过冒烟 ----
run env HEYBE_SKIP_KEY_TEST=1 "$BASH" "$T021"
eq "单独 t021 + SKIP_KEY_TEST rc" "$rc" 1
eq "单独 t021 仍做冒烟" "$(wc -l <"$T/chat-called" | tr -d ' ')" 1

# ---- 5. heybe-desktop-dev.sh 给 t021 的开关 ----
eq "都不设" "$(heybe_t021_smoke_flag)" 0
eq "SKIP_KEY_TEST=1" "$(HEYBE_SKIP_KEY_TEST=1 heybe_t021_smoke_flag)" 1
eq "SKIP_CHAT_SMOKE=1" "$(HEYBE_SKIP_CHAT_SMOKE=1 heybe_t021_smoke_flag)" 1
eq "SKIP_KEY_TEST=0" "$(HEYBE_SKIP_KEY_TEST=0 heybe_t021_smoke_flag)" 0
ok_ grep -qF 'HEYBE_SKIP_CHAT_SMOKE="$SMOKE_SKIP" "$REPO_ROOT/scripts/poc/t021-mac.sh"' "$REPO_ROOT/scripts/dev/heybe-desktop-dev.sh"
ok_ grep -qF 'SMOKE_SKIP="$(heybe_t021_smoke_flag)"' "$REPO_ROOT/scripts/dev/heybe-desktop-dev.sh"

# ---- 6. 按 heybe-desktop-dev.sh 的方式调用（heybe_key_sync + env -u DEEPSEEK_API_KEY …） ----
heybe_load_poc_key "$HEYBE_POC_ENV"
# 6a. HEYBE_SKIP_KEY_TEST=1 + 错 key（上游 401）：跳过冒烟，成功
rc=0; : >"$T/chat-called"
out=$(HEYBE_SKIP_KEY_TEST=1; SMOKE_SKIP="$(heybe_t021_smoke_flag)"
  heybe_key_sync "$HEYBE_T021_HOME" env -u DEEPSEEK_API_KEY HEYBE_SKIP_CHAT_SMOKE="$SMOKE_SKIP" "$BASH" "$T021" 2>&1) || rc=$?
eq "desktop + SKIP_KEY_TEST rc" "$rc" 0
eq "desktop + SKIP_KEY_TEST 没调用对话" "$(wc -l <"$T/chat-called" | tr -d ' ')" 0
ok_ has "$out" "已跳过聊天冒烟测试"
# 6b. 不设开关 + 错 key：t021 报 E_KEY_INVALID（desktop-dev 据此报 E_KEY_INVALID 而不是 E_T021）
rm -f "$FP"
rc=0; : >"$T/chat-called"
out=$(SMOKE_SKIP="$(heybe_t021_smoke_flag)"
  heybe_key_sync "$HEYBE_T021_HOME" env -u DEEPSEEK_API_KEY HEYBE_SKIP_CHAT_SMOKE="$SMOKE_SKIP" "$BASH" "$T021" 2>&1) || rc=$?
eq "desktop 默认 rc" "$rc" 1
eq "desktop 默认做了冒烟" "$(wc -l <"$T/chat-called" | tr -d ' ')" 1
eq "desktop 默认结果码" "$(heybe_t021_result_code "$REPORT")" E_KEY_INVALID
DEEPSEEK_API_KEY=""

echo "t021-smoke-mock-test: ${n} 条断言全部通过"
