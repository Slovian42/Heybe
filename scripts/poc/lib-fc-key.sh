# shellcheck shell=bash
# Heybe：DeepSeek key 指纹 + 换 key 后更新 FastClaw Agent（#19 Mac 复验问题 1）。兼容 macOS 自带 bash 3.2。
# 依赖 lib-fc-env.sh（fc_env_exec）与 lib-fc-agent.sh（fc_resolve_agent_id）。
#
# 为什么要它：heybe-desktop-dev.sh 以前只在第一次跑 t021 建 Agent。FastClaw v1.4.0 在 agents init 时
# 把 key 写进数据库（system 级 provider 行，按提供方名字 deepseek 存一份），之后不再读 ~/.heybe-poc.env，
# 所以换了 key 也一直用旧 key → 401。
#
# 指纹文件 ${T021_HOME}/deepseek-key.sha256：一行 "sha256:<64 位十六进制>"，权限 600，不含明文。
# key 只以“变量名”在函数之间传递（不进 argv），只经 fc_env_exec 的子进程环境交给 fastclaw。
#
# 更新办法（查 v1.4.0 源码确认）：没有单独的 /v1 改 key 接口（/v1 只有 chat、agents、sessions）；
# `fastclaw agents init <名字> --id <agt_…> --api-key-env DEEPSEEK_API_KEY` 就是“更新已有 Agent”：
# 不换 owner、不生成新密码，重新从环境变量读 key 覆盖 provider 行（internal/agentcli/agentcli.go Init /
# providerConfigFromOptions）；gateway 在跑时 CLI 会发 SIGHUP 让它重新加载（cmd/fastclaw/cmd_agents.go）。

HEYBE_KEY_FP_NAME="deepseek-key.sha256"

# heybe_sha256：stdin → 64 位十六进制（macOS 用 shasum，Linux 用 sha256sum，最后退到 openssl）
heybe_sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1
  else openssl dgst -sha256 -r | cut -d' ' -f1; fi
}

# heybe_key_fingerprint <变量名>：打印 "sha256:<hex>"；变量为空返回 1。printf 是内建命令，key 不进任何 argv。
heybe_key_fingerprint() {
  local v=${!1-}
  [ -n "$v" ] || return 1
  printf 'sha256:%s\n' "$(printf '%s' "$v" | heybe_sha256)"
}

heybe_key_fp_file() { printf '%s/%s\n' "$1" "${HEYBE_KEY_FP_NAME}"; }

# heybe_key_state <数据目录> <变量名>：打印 same / changed / new（没有指纹文件，例如 10-29 建的旧目录）
heybe_key_state() {
  local f want have
  f=$(heybe_key_fp_file "$1")
  want=$(heybe_key_fingerprint "$2") || { echo changed; return 0; }
  if [ ! -s "$f" ]; then echo new; return 0; fi
  have=$(head -1 "$f" | tr -d '\r\n')
  if [ "$have" = "$want" ]; then echo same; else echo changed; fi
}

# heybe_key_save_fp <数据目录> <变量名>：原子写入指纹，权限 600
heybe_key_save_fp() {
  local f fp
  f=$(heybe_key_fp_file "$1")
  fp=$(heybe_key_fingerprint "$2") || return 1
  mkdir -p "$1"
  ( umask 077; printf '%s\n' "$fp" >"${f}.tmp" ) && chmod 600 "${f}.tmp" && mv -f "${f}.tmp" "$f"
}

# heybe_load_poc_key <env 文件>：把 DEEPSEEK_API_KEY 读进当前 shell 变量（不 export）。
# 返回 2=文件不存在 3=权限不是 600 4=没有 DEEPSEEK_API_KEY=
heybe_load_poc_key() {
  local f=$1 mode v
  [ -f "$f" ] || return 2
  mode=$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")
  [ "$mode" = 600 ] || return 3
  v=$(sed -n 's/^[[:space:]]*\(export[[:space:]]\{1,\}\)\{0,1\}DEEPSEEK_API_KEY=//p' "$f" | tail -1 | tr -d '\r')
  v=${v%\"}; v=${v#\"}; v=${v%\'}; v=${v#\'}
  [ -n "$v" ] || return 4
  # shellcheck disable=SC2034 # 给调用方用（不 export）
  DEEPSEEK_API_KEY=$v
}

# heybe_fc_agent_upsert <fastclaw> <Agent 名> <模型> [端口]：已有同名 Agent → 带 --id 更新 key；没有 → 新建。
# 需要当前 shell 里有 DEEPSEEK_API_KEY（不必 export）。成功打印 created/updated。
# init 的输出可能含自动生成的管理员密码：整段丢弃，只在失败时给出 "Error:" 那一行。
heybe_fc_agent_upsert() {
  local fc=$1 name=$2 model=$3 port=${4:-0} id="" out rc=0 verb=created
  local -a args
  id=$(FASTCLAW_API_KEY="" fc_resolve_agent_id "$port" "$name" "$fc" 2>/dev/null || true)
  args=(agents init "$name" --provider deepseek --model "$model" --api-key-env DEEPSEEK_API_KEY)
  if [ -n "$id" ]; then args+=(--id "$id"); verb=updated; fi
  out=$(fc_env_exec DEEPSEEK_API_KEY "$fc" "${args[@]}" 2>&1) || rc=$?
  if [ "$rc" != 0 ]; then
    printf '%s\n' "$out" | grep -i -m1 '^error' | grep -v -i 'password' >&2 || true
    out=""
    return "$rc"
  fi
  # shellcheck disable=SC2034 # 故意清空：密码不留在变量里
  out=""
  echo "$verb"
}

# heybe_deepseek_probe <变量名>：用 key 调一次 DeepSeek GET /models（不花钱），打印 HTTP 状态码（000=连不上）。
# Authorization 头经 stdin 交给 curl（-K -），不进 argv。HEYBE_DEEPSEEK_API_BASE 可改地址（测试用）。
heybe_deepseek_probe() {
  local v=${!1-} base=${HEYBE_DEEPSEEK_API_BASE:-https://api.deepseek.com} code
  v=${v//\\/\\\\}; v=${v//\"/\\\"}
  code=$(printf 'header = "Authorization: Bearer %s"\n' "$v" \
    | curl -s -o /dev/null -m "${HEYBE_KEY_PROBE_TIMEOUT:-10}" -w '%{http_code}' -K - "${base%/}/models" 2>/dev/null) || true
  v=""
  printf '%s\n' "${code:-000}"
}

# heybe_key_sync <数据目录> <命令...>：key 指纹没变就什么都不做（返回 0）；变了（或没有指纹）就跑一次命令
# （t021-mac.sh：更新 Agent、做一次真实对话、成功后写指纹）。
# 命令退出码 3 = 原地更新失败：把旧数据目录改名备份成 <目录>.bak-时间（不删），再完整重建一次。
# HEYBE_KEY_SYNC_FORCE=1 时无论指纹如何都跑。结果写在 HEYBE_KEY_SYNC_STATE / HEYBE_KEY_SYNC_BACKUP。
heybe_key_sync() {
  local home=$1 rc=0
  shift
  HEYBE_KEY_SYNC_BACKUP=""
  HEYBE_KEY_SYNC_STATE=$(heybe_key_state "$home" DEEPSEEK_API_KEY)
  if [ "${HEYBE_KEY_SYNC_STATE}" = same ] && [ "${HEYBE_KEY_SYNC_FORCE:-0}" != 1 ]; then return 0; fi
  "$@" || rc=$?
  if [ "$rc" = 3 ] && [ -d "$home" ]; then
    HEYBE_KEY_SYNC_BACKUP="${home}.bak-$(date +%Y%m%d-%H%M%S)"
    mv "$home" "${HEYBE_KEY_SYNC_BACKUP}" || return 1
    rc=0
    "$@" || rc=$?
  fi
  return "$rc"
}
