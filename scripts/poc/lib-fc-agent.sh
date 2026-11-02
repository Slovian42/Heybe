# shellcheck shell=bash
# Heybe：/v1 调用需要 Agent 的 id（agt_…），不认 `fastclaw agents init <名字>` 里的名字（传名字 → 404 agent_not_found）。
# 这里按名字查出 id。兼容 macOS 自带 bash 3.2；需要 python3 与 curl。
#
# fc_resolve_agent_id <port> <名字或 agt_id> [fastclaw 命令] [缓存文件]
#   成功：stdout 打印 agt_…，返回 0；失败：stderr 打印中文原因，返回 1。查找顺序：
#   1) 参数本身就是 agt_… → 原样使用（HEYBE_POC_AGENT=<agt_id> 手动覆盖走这里）
#   2) GET /v1/agents（Bearer $FASTCLAW_API_KEY，按 display_name 精确匹配，翻页）
#   3) `fastclaw agents list`（CLI，按名字整词匹配所在行里的 agt_…；需当前环境的 FASTCLAW_HOME）
#   4) 缓存文件（setup 时从 agents init 输出里记下的 id）
# 不打印 apikey：只经环境变量交给 python。

# _fc_agent_api <port> <名字>：GET /v1/agents 翻页，按 display_name 精确匹配，打印第一个（列表按创建时间倒序，即最新）
# （heredoc 不放进 $( ) 里：macOS bash 3.2 解析 $( ) 内 heredoc 有已知问题）
_fc_agent_api() {
  python3 - "$1" "$2" <<'PY'
import sys, os, json, urllib.request, urllib.parse
port, name = sys.argv[1:]
cursor, hits = "", []
for _ in range(20):
    q = {"limit": "100"}
    if cursor: q["cursor"] = cursor
    url = f"http://127.0.0.1:{port}/v1/agents?" + urllib.parse.urlencode(q)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + os.environ["FASTCLAW_API_KEY"]})
    with urllib.request.urlopen(req, timeout=15) as r:
        d = json.load(r)
    for a in d.get("agents") or []:
        if isinstance(a, dict) and str(a.get("id", "")).startswith("agt_") and (a.get("display_name") or "").strip() == name:
            hits.append(a["id"])
    cursor = d.get("next_cursor") or ""
    if not d.get("has_more") or not cursor: break
if hits: print(hits[0])   # 列表按创建时间倒序：同名取最新
PY
}

# _fc_agents_list <fastclaw 命令>：有 lib-fc-env.sh 的 fc_env_exec 就只带白名单环境变量
_fc_agents_list() {
  if type fc_env_exec >/dev/null 2>&1; then fc_env_exec "" "$1" agents list 2>/dev/null; else "$1" agents list 2>/dev/null; fi
}

fc_resolve_agent_id() {
  local port=$1 name=$2 fc_bin=${3:-fastclaw} cache=${4:-} id=""
  case "$name" in agt_*) printf '%s\n' "$name"; return 0 ;; esac
  if [ -n "${FASTCLAW_API_KEY:-}" ]; then
    id=$(_fc_agent_api "$port" "$name" 2>/dev/null || true)
    if [ -n "$id" ]; then printf '%s\n' "$id"; return 0; fi
  fi
  if command -v "$fc_bin" >/dev/null 2>&1; then
    id=$(_fc_agents_list "$fc_bin" | awk -v n="$name" '
      { for (i = 1; i <= NF; i++) if ($i == n) { if (match($0, /agt_[A-Za-z0-9_-]+/)) { print substr($0, RSTART, RLENGTH); exit } } }' || true)
    if [ -n "$id" ]; then printf '%s\n' "$id"; return 0; fi
  fi
  if [ -n "$cache" ] && [ -s "$cache" ]; then
    id=$(grep -o 'agt_[A-Za-z0-9_-]*' "$cache" | head -1 || true)
    if [ -n "$id" ]; then printf '%s\n' "$id"; return 0; fi
  fi
  printf '找不到名为 %s 的 Agent 的 id（GET /v1/agents、fastclaw agents list 都没查到）。先跑 setup；或用 HEYBE_POC_AGENT=agt_… 手动指定\n' "$name" >&2
  return 1
}

# fc_agent_id_from_init <agents init 输出>：取 "Agent ID: agt_…" 或 "already exists (id agt_…)"，没有则空
fc_agent_id_from_init() {
  printf '%s\n' "$1" | sed -n -e 's/^Agent ID:[[:space:]]*\(agt_[A-Za-z0-9_-]*\).*/\1/p' -e 's/.*already exists (id \(agt_[A-Za-z0-9_-]*\)).*/\1/p' | head -1
}
