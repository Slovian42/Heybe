# shellcheck shell=bash
# Heybe：启动 FastClaw gateway / CLI 时只传必需环境变量（白名单优先），并把数据目录按“含明文密钥”保护。
# 兼容 macOS bash 3.2（无关联数组）。与 services/task-manager/src/child-env.ts 同一套规则。
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
# 用 env -i 只带白名单里已设置的变量；像密钥的名字只有写在第一个参数里才传。
# FASTCLAW_ALLOW_HOST_EXEC 永远不传。
fc_env_exec() {
  local extra="$1" n allowed
  shift
  local -a kv=()
  for n in ${HEYBE_FC_ENV_ALLOW} ${extra}; do
    [ "$n" = FASTCLAW_ALLOW_HOST_EXEC ] && continue
    eval "allowed=\${${n}+set}"
    [ "${allowed}" = set ] || continue
    if fc_is_secret_name "$n"; then
      case " ${extra} " in *" ${n} "*) ;; *) continue ;; esac
    fi
    kv+=("${n}=${!n}")
  done
  env -i "${kv[@]}" "$@"
}

# fc_lock_home <dir>：目录 700、文件 600（数据库里有明文模型 key）
fc_lock_home() {
  [ -d "$1" ] || return 0
  chmod 700 "$1"
  find "$1" -type d -exec chmod 700 {} + 2>/dev/null || true
  find "$1" -type f -exec chmod 600 {} + 2>/dev/null || true
}
