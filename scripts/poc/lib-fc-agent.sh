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

# fc_agent_init_upsert <fastclaw 命令> <名字> <key 变量名> [agents init 的其余参数...]
#   建 Agent；同名已存在就带 --id <agt_…> 原地更新（和 lib-fc-key.sh 的 heybe_fc_agent_upsert 同一做法，#88）。
#   先用 `fastclaw agents list` 查同名 Agent；没查到但 init 报 "already exists (id agt_…)"（例如 list 输出格式不同、
#   数据目录是旧的）就用报错里的 id 再跑一次带 --id 的 init。不读缓存文件（PURGE 过的目录缓存可能是旧 id）。
#   成功：stdout 打印 "created agt_…" 或 "updated agt_…"，返回 0；失败：stderr 只打印 init 输出里的 Error 行
#   （去掉含 password 的行），返回 init 的退出码。key 只以变量名交给 fc_env_exec（子进程环境），不进 argv；
#   init 输出可能含自动生成的管理员密码：只留在函数局部变量里，用完清空。
fc_agent_init_upsert() {
  local fc=$1 name=$2 keyvar=$3 id="" out rc=0 verb=created got
  shift 3
  id=$(FASTCLAW_API_KEY="" fc_resolve_agent_id 0 "$name" "$fc" 2>/dev/null || true)
  if [ -n "$id" ]; then
    verb=updated
    out=$(fc_env_exec "$keyvar" "$fc" agents init "$name" --id "$id" "$@" 2>&1) || rc=$?
  else
    out=$(fc_env_exec "$keyvar" "$fc" agents init "$name" "$@" 2>&1) || rc=$?
    got=$(fc_agent_id_from_init "$out")
    if [ "$rc" != 0 ] && [ -n "$got" ]; then
      id=$got; verb=updated; rc=0
      out=$(fc_env_exec "$keyvar" "$fc" agents init "$name" --id "$id" "$@" 2>&1) || rc=$?
    fi
  fi
  if [ "$rc" != 0 ]; then
    printf '%s\n' "$out" | grep -i -m1 'error' | grep -v -i 'password' >&2 || true
    out=""
    return "$rc"
  fi
  got=$(fc_agent_id_from_init "$out")
  # shellcheck disable=SC2034 # 故意清空：密码不留在变量里
  out=""
  id=${got:-$id}
  [ -n "$id" ] || id=$(FASTCLAW_API_KEY="" fc_resolve_agent_id 0 "$name" "$fc" 2>/dev/null || true)
  printf '%s %s\n' "$verb" "${id:-unknown}"
}

# camoufox-cli 浏览器技能开关（系统作用域，任一已有 Agent 都可作 <agent> 参数）。
FC_CAMOUFOX_KEY=skills.entries.camoufox-cli.enabled

# fc_camoufox_get <fastclaw 命令> <Agent 名或 agt_ id>：打印读回的值（true/false/空）
fc_camoufox_get() {
  local v
  if type fc_env_exec >/dev/null 2>&1; then v=$(fc_env_exec "" "$1" agents config "$2" get "$FC_CAMOUFOX_KEY" 2>/dev/null) || v=""
  else v=$("$1" agents config "$2" get "$FC_CAMOUFOX_KEY" 2>/dev/null) || v=""; fi
  printf '%s\n' "$v" | tr -d '[:space:]'
  echo
}

# fc_camoufox_off <fastclaw 命令> <Agent>：设成 false 再读回。读回是 false 返回 0；
#   返回 1 = set 失败；返回 2 = 读回不是 false（stdout 打印读回值，空则打印“空”）。
fc_camoufox_off() {
  local v
  if type fc_env_exec >/dev/null 2>&1; then fc_env_exec "" "$1" agents config "$2" set "$FC_CAMOUFOX_KEY" false >/dev/null 2>&1 || return 1
  else "$1" agents config "$2" set "$FC_CAMOUFOX_KEY" false >/dev/null 2>&1 || return 1; fi
  v=$(fc_camoufox_get "$1" "$2")
  printf '%s\n' "${v:-空}"
  [ "$v" = false ] || return 2
}
