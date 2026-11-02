# shellcheck shell=bash
# Heybe：启动 FastClaw gateway / CLI 时只传必需环境变量（白名单优先），并把数据目录按“含明文密钥”保护。
# 兼容 macOS bash 3.2（无关联数组）。与 services/task-manager/src/child-env.ts 同一套规则，
# 唯一差别：这里白名单多 FASTCLAW_SANDBOX_* 和 DOCKER_HOST（只给 scripts/poc 的 BoxLite/Lima+docker 对照用；
# 产品侧不继承这些名字，沙箱设置只由 src/sandbox.ts 的 sandboxGatewayEnv 显式给出）。
#
# 原因：FastClaw v1.4.0 把自己的全部环境变量交给 stdio MCP / 插件子进程（internal/mcp/stdio.go），
# 模型 key 已在 agents init 时写进数据库（internal/agentcli/agentcli.go:550–558），gateway 运行时不需要它。

HEYBE_FC_ENV_ALLOW="PATH HOME USER LOGNAME SHELL LANG LC_ALL LC_CTYPE TMPDIR TZ TERM \
FASTCLAW_HOME FASTCLAW_PORT FASTCLAW_BIND FASTCLAW_SANDBOX_ENABLED FASTCLAW_SANDBOX_ENFORCE \
FASTCLAW_SANDBOX_BACKEND FASTCLAW_SANDBOX_BOXLITE_URL FASTCLAW_SANDBOX_BOXLITE_PREFIX DOCKER_HOST"

fc_is_secret_name() { # name → 0 表示像密钥
  case "$1" in
    *KEY*|*TOKEN*|*SECRET*|*PASSWORD*|*PASSWD*|*CREDENTIAL*|*_DSN|DATABASE_URL|*SALT*|*COOKIE*|*SESSION*) return 0 ;;
  esac
  return 1
}

# fc_env_exec "<额外变量名，空格分隔>" cmd args...
# 子进程只拿到白名单里已设置的变量；像密钥的名字只有写在第一个参数里才传。FASTCLAW_ALLOW_HOST_EXEC 永远不传。
# 变量**只经环境继承**交给 cmd，不进任何进程的 argv（Yang 11-02 定的规则：密钥只放子进程环境变量、不进命令参数）：
# 在子 shell 里用内建命令 export / export -n 调整“要导出哪些变量”，然后直接 exec cmd。
# 以前的写法 `env -i K=V cmd` 会让值（包括 DEEPSEEK_API_KEY）出现在 env 进程的命令行里，ps 能看到。
fc_env_exec() {
  local extra="$1"
  shift
  if [ "${FC_ENV_EXEC:-}" = 1 ]; then
    _fc_env_only "${extra}"
    exec "$@"
  fi
  ( _fc_env_only "${extra}"; exec "$@" )
}

# _fc_env_only "<额外变量名>"：只在当前 shell 生效（调用方要在子 shell 里用），全部是 bash 内建，不起新进程。
# shellcheck disable=SC2163 # 按变量名 export / export -n 是故意的
_fc_env_only() {
  local extra="$1" n keep=" " fl
  for n in ${HEYBE_FC_ENV_ALLOW} ${extra}; do
    [ "$n" = FASTCLAW_ALLOW_HOST_EXEC ] && continue
    if fc_is_secret_name "$n"; then
      case " ${extra} " in *" ${n} "*) ;; *) continue ;; esac
    fi
    keep="${keep}${n} "
  done
  _fc_unexport_all "${keep}"
  # 名单里已设置的变量（包括只是 shell 变量、没 export 的 key）：export 是内建，不进 argv
  for n in ${keep}; do
    eval "fl=\${${n}+set}"
    [ "${fl}" = set ] && export "${n}"
  done
  return 0
}

# _fc_unexport_all "<保留的变量名，前后带空格>"：取消导出其他所有变量和导出的函数（值留在当前 shell，exec 后的进程拿不到）。
# shellcheck disable=SC2163 # 按变量名 export / export -n 是故意的
_fc_unexport_all() {
  local keep="${1:- }" n names fl fn
  names=$(compgen -e 2>/dev/null) || names=$(export -p | sed -n 's/^declare -x \([A-Za-z_][A-Za-z0-9_]*\).*/\1/p')
  for n in ${names}; do
    case "${keep}" in *" ${n} "*) ;; *) export -n "$n" 2>/dev/null || unset "$n" 2>/dev/null || true ;; esac
  done
  while read -r _ fl fn; do
    case "${fl}" in *x*) export -nf "${fn}" 2>/dev/null || true ;; esac
  done <<EOF
$(declare -F)
EOF
  return 0
}

# fc_env_only_kv K=V ...：清空导出，只导出给定的 K=V（替代 `env -i K=V cmd`，值不进任何 argv）。
# 只在子 shell 里用，之后 exec 目标命令：( fc_env_only_kv ${A[@]+"${A[@]}"} && exec cmd args... )
# shellcheck disable=SC2163 # 按变量名 export / export -n 是故意的
fc_env_only_kv() {
  local kv
  _fc_unexport_all " "
  for kv in "$@"; do
    export "${kv}"
  done
  return 0
}

# fc_env_bg <pidfile> "<额外变量名>" cmd args...：后台启动，pidfile 里是真正的进程 pid（子 shell 直接 exec 成 cmd），
# 且进程不是调用脚本的子进程，脚本里不带参数的 wait 不会被它挂住。
fc_env_bg() {
  local pidfile="$1"
  shift
  ( FC_ENV_EXEC=1 fc_env_exec "$@" & echo $! >"${pidfile}" )
}

# curl_k <key> curl参数…：Authorization: Bearer 头经 stdin 配置（curl -K -）交给 curl，key 不进任何 argv。
# key 为空时不带头（BoxLite serve 的公开路由 /v1/config、或者有意测 401）。
curl_k() {
  local k="$1"
  shift
  if [ -z "${k}" ]; then curl "$@"; return; fi
  curl -K - "$@" <<EOF
header = "Authorization: Bearer ${k}"
EOF
}

# fc_lock_home <dir>：目录 700、文件 600（数据库里有明文模型 key）
fc_lock_home() {
  [ -d "$1" ] || return 0
  chmod 700 "$1"
  find "$1" -type d -exec chmod 700 {} + 2>/dev/null || true
  find "$1" -type f -exec chmod 600 {} + 2>/dev/null || true
}
