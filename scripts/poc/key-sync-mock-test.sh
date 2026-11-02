#!/usr/bin/env bash
# lib-fc-key.sh 的干跑测试（#19 Mac 复验问题 1）：假 fastclaw + 假 DeepSeek /models，不需要真 FastClaw、真密钥。
# 覆盖：key 没变 → 不重跑；key 变了 → 带 --id 更新、指纹更新；指纹文件 600 且没有明文；key 不进 argv；
#       原地更新失败（退出码 3）→ 旧目录改名备份（不删）后重建；连接测试 200/401/连不上。
# 用法: scripts/poc/key-sync-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-fc-env.sh
. "$SCRIPT_DIR/lib-fc-env.sh"
# shellcheck source=lib-fc-agent.sh
. "$SCRIPT_DIR/lib-fc-agent.sh"
# shellcheck source=lib-fc-key.sh
. "$SCRIPT_DIR/lib-fc-key.sh"
T=$(mktemp -d); trap 'kill "${MPID:-}" 2>/dev/null || true; rm -rf "$T"' EXIT
n=0
eq() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "ASSERT FAIL [$1]: 期望 '$3'，实际 '$2'" >&2; exit 1; }; }
ok_() { n=$((n + 1)); "$@" || { echo "ASSERT FAIL: $*" >&2; exit 1; }; }
no_() { n=$((n + 1)); if "$@"; then echo "ASSERT FAIL (不应成立): $*" >&2; exit 1; fi; }
mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }

# 假 fastclaw：agents list 打印 $FAKE_STATE 里的 Agent；agents init 记 argv（每行一个参数）、
# 记子进程环境里 DEEPSEEK_API_KEY 的 sha256（不记明文）；FAKE_INIT_FAIL=1 时失败。
mkdir -p "$T/bin"
cat >"$T/bin/fastclaw" <<'SH'
#!/usr/bin/env bash
st="${FASTCLAW_HOME}/fake-agents"
case "$1 $2" in
  "agents list") printf 'ID                    NAME        MODEL\n'; [ -f "$st" ] && cat "$st"; exit 0 ;;
  "agents init")
    { printf '%s\n' "$@"; echo "--"; } >>"${FASTCLAW_HOME}/fake-argv"
    printf '%s' "${DEEPSEEK_API_KEY-}" | (shasum -a 256 2>/dev/null || sha256sum) | cut -d' ' -f1 >>"${FASTCLAW_HOME}/fake-envkey"
    [ -f "${FASTCLAW_HOME}/fail-init" ] && { echo "Error: database is locked"; exit 1; }
    echo "Admin password: hunter2-should-not-leak"
    if ! grep -q -- "--id" <<<"$*"; then echo "agt_fake0001  $3  $7" >>"$st"; echo "Agent ID: agt_fake0001"; fi
    exit 0 ;;
esac
exit 2
SH
chmod +x "$T/bin/fastclaw"
FC="$T/bin/fastclaw"
H="$T/heybe-t021"; export FASTCLAW_HOME="$H/fastclaw-home"; mkdir -p "$FASTCLAW_HOME"
sha() { printf '%s' "$1" | heybe_sha256; }
KEY1="sk-test-OLD-1111aaaa"; KEY2="sk-test-NEW-2222bbbb"

# ---- 指纹 ----
DEEPSEEK_API_KEY=$KEY1
eq "没有指纹文件 → new" "$(heybe_key_state "$H" DEEPSEEK_API_KEY)" new
heybe_key_save_fp "$H" DEEPSEEK_API_KEY
FP="$H/deepseek-key.sha256"
eq "指纹文件权限 600" "$(mode "$FP")" 600
eq "指纹内容是 sha256:<hex>" "$(cat "$FP")" "sha256:$(sha "$KEY1")"
no_ grep -q -F "$KEY1" "$FP"
no_ grep -q -F "1111aaaa" "$FP"
eq "同一个 key → same" "$(heybe_key_state "$H" DEEPSEEK_API_KEY)" same
DEEPSEEK_API_KEY=$KEY2
eq "换了 key → changed" "$(heybe_key_state "$H" DEEPSEEK_API_KEY)" changed
DEEPSEEK_API_KEY=""
no_ heybe_key_fingerprint DEEPSEEK_API_KEY

# ---- 读 ~/.heybe-poc.env ----
ENVF="$T/poc.env"
printf '# x\nexport DEEPSEEK_API_KEY="%s"\n' "$KEY1" >"$ENVF"; chmod 644 "$ENVF"
rc=0; heybe_load_poc_key "$ENVF" || rc=$?; eq "env 文件不是 600 → 3" "$rc" 3
chmod 600 "$ENVF"; unset DEEPSEEK_API_KEY
heybe_load_poc_key "$ENVF"; eq "读出 key（去引号）" "$DEEPSEEK_API_KEY" "$KEY1"
exported() { env | grep -q '^DEEPSEEK_API_KEY='; }
no_ exported   # 没有 export
rc=0; heybe_load_poc_key "$T/none" || rc=$?; eq "env 文件不存在 → 2" "$rc" 2

# ---- upsert：第一次新建，之后带 --id 更新；key 只在子进程环境里 ----
DEEPSEEK_API_KEY=$KEY1
eq "第一次 → created" "$(heybe_fc_agent_upsert "$FC" heybe-t021 deepseek/deepseek-v4-flash 0)" created
no_ grep -q -- "--id" "$FASTCLAW_HOME/fake-argv"
DEEPSEEK_API_KEY=$KEY2
out=$(heybe_fc_agent_upsert "$FC" heybe-t021 deepseek/deepseek-v4-flash 0)
eq "已有 Agent → updated" "$out" updated
eq "更新带 --id agt_fake0001" "$(sed -n '/^--id$/{n;p;}' "$FASTCLAW_HOME/fake-argv" | tail -1)" agt_fake0001
eq "子进程拿到的是新 key" "$(tail -1 "$FASTCLAW_HOME/fake-envkey")" "$(sha "$KEY2")"
no_ grep -q -F -e "$KEY1" -e "$KEY2" "$FASTCLAW_HOME/fake-argv"
no_ grep -q hunter2 <<<"$out"
eq "--api-key-env 传的是变量名" "$(grep -c '^DEEPSEEK_API_KEY$' "$FASTCLAW_HOME/fake-argv")" 2
touch "$FASTCLAW_HOME/fail-init"
rc=0; err=$(heybe_fc_agent_upsert "$FC" heybe-t021 m 0 2>&1 >/dev/null) || rc=$?
eq "init 失败 → 非 0" "$rc" 1
eq "失败只给 Error 行" "$err" "Error: database is locked"
rm -f "$FASTCLAW_HOME/fail-init"

# ---- heybe_key_sync：模拟 heybe-desktop-dev.sh 调 t021 ----
# 假 t021：在数据目录里更新 Agent、写指纹；数据目录里有 fail-update 时（模拟库坏了）以 3 退出
cat >"$T/fake-t021.sh" <<SH
#!/usr/bin/env bash
set -euo pipefail
. "$SCRIPT_DIR/lib-fc-env.sh"; . "$SCRIPT_DIR/lib-fc-agent.sh"; . "$SCRIPT_DIR/lib-fc-key.sh"
H="$H"; export FASTCLAW_HOME="\$H/fastclaw-home"; mkdir -p "\$FASTCLAW_HOME"
echo run >>"$T/t021-runs"
[ -f "\$H/fail-update" ] && exit 3
heybe_load_poc_key "$ENVF"
heybe_fc_agent_upsert "$FC" heybe-t021 deepseek/deepseek-v4-flash 0 >/dev/null
heybe_key_save_fp "\$H" DEEPSEEK_API_KEY
SH
chmod +x "$T/fake-t021.sh"
runs() { if [ -f "$T/t021-runs" ]; then wc -l <"$T/t021-runs" | tr -d ' '; else echo 0; fi; }
printf 'DEEPSEEK_API_KEY=%s\n' "$KEY2" >"$ENVF"; heybe_load_poc_key "$ENVF"
heybe_key_save_fp "$H" DEEPSEEK_API_KEY
heybe_key_sync "$H" "$T/fake-t021.sh"
eq "key 没变 → 不跑 t021" "$(runs)" 0
eq "key 没变 → 状态 same" "${HEYBE_KEY_SYNC_STATE}" same
HEYBE_KEY_SYNC_FORCE=1 heybe_key_sync "$H" "$T/fake-t021.sh"
eq "FORCE=1 → 跑一次" "$(runs)" 1
KEY3="sk-test-NEWER-3333cccc"
printf 'DEEPSEEK_API_KEY=%s\n' "$KEY3" >"$ENVF"; heybe_load_poc_key "$ENVF"
before=$(grep -c . "$FASTCLAW_HOME/fake-envkey")
heybe_key_sync "$H" "$T/fake-t021.sh"
eq "key 变了 → 跑 t021" "$(runs)" 2
eq "key 变了 → 状态 changed" "${HEYBE_KEY_SYNC_STATE}" changed
eq "key 变了 → 又调了一次 agents init" "$(grep -c . "$FASTCLAW_HOME/fake-envkey")" "$((before + 1))"
eq "Agent 拿到新 key" "$(tail -1 "$FASTCLAW_HOME/fake-envkey")" "$(sha "$KEY3")"
eq "用 --id 更新，没重复建" "$(grep -c agt_fake0001 "$FASTCLAW_HOME/fake-agents")" 1
eq "指纹已换成新 key" "$(cat "$H/deepseek-key.sha256")" "sha256:$(sha "$KEY3")"
eq "之后再启动 → same" "$(heybe_key_state "$H" DEEPSEEK_API_KEY)" same
no_ grep -r -q -F -e "$KEY1" -e "$KEY2" -e "$KEY3" "$H"

# 原地更新失败 → 改名备份（不删）后重建
KEY4="sk-test-FOURTH-4444dddd"
printf 'DEEPSEEK_API_KEY=%s\n' "$KEY4" >"$ENVF"; heybe_load_poc_key "$ENVF"
touch "$H/fail-update"
heybe_key_sync "$H" "$T/fake-t021.sh"
eq "失败后重跑一次（共 4 次）" "$(runs)" 4
ok_ test -n "${HEYBE_KEY_SYNC_BACKUP}"
ok_ test -f "${HEYBE_KEY_SYNC_BACKUP}/fail-update"
ok_ test -f "${HEYBE_KEY_SYNC_BACKUP}/fastclaw-home/fake-agents"
eq "新目录里的指纹是新 key" "$(cat "$H/deepseek-key.sha256")" "sha256:$(sha "$KEY4")"
eq "新目录里是新建的 Agent（不带 --id）" "$(grep -c -- '^--id$' "$H/fastclaw-home/fake-argv" || true)" 0
unset DEEPSEEK_API_KEY

# ---- 连接测试：假 DeepSeek GET /models ----
PORT=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])')
python3 - "$PORT" "$(sha "Bearer $KEY4")" <<'PY' &
import sys,http.server,hashlib
good=sys.argv[2]
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def do_GET(self):
        a=self.headers.get("Authorization","")
        code=200 if self.path=="/models" and hashlib.sha256(a.encode()).hexdigest()==good else 401
        self.send_response(code); self.send_header("Content-Length","2"); self.end_headers(); self.wfile.write(b"{}")
http.server.HTTPServer(("127.0.0.1",int(sys.argv[1])),H).serve_forever()
PY
MPID=$!
for _ in $(seq 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT" && break; sleep 0.1; done
export HEYBE_DEEPSEEK_API_BASE="http://127.0.0.1:$PORT"
# shellcheck disable=SC2034 # 按变量名传给 heybe_deepseek_probe
GOOD=$KEY4
# shellcheck disable=SC2034
BAD='sk-bad"with\quote'
eq "好 key → 200" "$(heybe_deepseek_probe GOOD)" 200
eq "坏 key（带引号反斜杠）→ 401" "$(heybe_deepseek_probe BAD)" 401
kill "$MPID"; wait "$MPID" 2>/dev/null || true
eq "连不上 → 000" "$(HEYBE_KEY_PROBE_TIMEOUT=2 heybe_deepseek_probe GOOD)" 000

echo "key-sync-mock-test: ${n} 条断言全部通过"
