# shellcheck shell=bash
# Heybe：启动任务服务前检查 Node 版本与 better-sqlite3 原生模块（兼容 macOS bash 3.2）。
# 背景（2026-11-02 Mac）：better-sqlite3 是在 Node 22 下编译的，Mac 默认 node 换成 v26 后
#   require 报 NODE_MODULE_VERSION 不一致，任务服务起不来。
#
# heybe_node_check <仓库根目录> <自动重建 0|1>
#   1) node 主版本与 .nvmrc 对比：不一致只提示（给出 nvm / fnm 切换方法），不拦
#   2) 在 services/task-manager 里真正加载一次 better-sqlite3（打开内存库）
#      失败且是 ABI 不匹配 / 没编译 → 中文说明 + 重建命令：
#        自动重建=1（--yes）直接执行；交互终端先问 [y/N]；否则返回 1
#   返回 0 = 可以启动。
# HEYBE_NODE_CHECK_SKIP=1 跳过（不建议）。

_hn_say()  { printf '  %s\n' "$*" >&2; }
_hn_rebuild_cmd() { printf 'pnpm -C "%s" -r rebuild better-sqlite3' "$1"; }

_hn_probe() { # <root>：stdout/stderr 合并输出错误信息，返回码表示能否加载
  (cd "$1/services/task-manager" && node -e "const D=require('better-sqlite3');new D(':memory:').close()" 2>&1)
}

heybe_node_check() {
  local root=$1 auto=${2:-0} want major out ans
  [ "${HEYBE_NODE_CHECK_SKIP:-0}" = 1 ] && return 0
  command -v node >/dev/null 2>&1 || { _hn_say "✗ 缺 node（推荐 $(cat "$root/.nvmrc" 2>/dev/null || echo 22)）"; return 1; }
  want=$(tr -d ' \r\nv' <"$root/.nvmrc" 2>/dev/null || true)
  major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo "?")
  if [ -n "$want" ] && [ "$major" != "${want%%.*}" ]; then
    _hn_say "• 当前 node $(node -v)，仓库固定 Node ${want}（.nvmrc）。建议切换：nvm use 或 fnm use（Homebrew：brew install node@${want%%.*} 并把它放到 PATH 前面）"
  fi
  if out=$(_hn_probe "$root"); then return 0; fi
  case "$out" in
    *NODE_MODULE_VERSION*|*"compiled against a different Node.js version"*)
      _hn_say "✗ better-sqlite3 原生模块和当前 node $(node -v) 不匹配（是用别的 Node 版本编译的）："
      _hn_say "  $(printf '%s\n' "$out" | tr '\n' ' ' | sed -n 's/.*\(NODE_MODULE_VERSION [0-9]*\)\. *This version of Node\.js requires *\(NODE_MODULE_VERSION [0-9]*\).*/编译时是 \1，当前 node 需要 \2/p')" ;;
    *"Could not locate the bindings file"*|*"Cannot find module"*better_sqlite3*)
      _hn_say "✗ better-sqlite3 原生模块没有编译（找不到 .node 文件）" ;;
    *)
      _hn_say "✗ 加载 better-sqlite3 失败（不是版本问题，未自动处理）："
      printf '%s\n' "$out" | tail -n 5 | sed 's/^/    /' >&2
      return 1 ;;
  esac
  _hn_say "  解决：换成 Node ${want:-22}（推荐），或者按当前 node 重新编译：$(_hn_rebuild_cmd "$root")"
  if [ "$auto" != 1 ]; then
    if [ -t 0 ]; then
      printf '  现在按当前 node 重新编译 better-sqlite3？[y/N] ' >&2
      read -r ans || ans=""
      case "$ans" in y|Y|yes|YES) auto=1 ;; esac
    fi
  fi
  if [ "$auto" != 1 ]; then _hn_say "  （加 --yes 可自动重建）"; return 1; fi
  _hn_say "• 正在执行：$(_hn_rebuild_cmd "$root")"
  pnpm -C "$root" -r rebuild better-sqlite3 >&2 || { _hn_say "✗ 重建失败（需要 Xcode 命令行工具和 python3）"; return 1; }
  if out=$(_hn_probe "$root"); then _hn_say "✓ better-sqlite3 已按 node $(node -v) 重新编译"; return 0; fi
  _hn_say "✗ 重建后仍加载失败："; printf '%s\n' "$out" | tail -n 3 | sed 's/^/    /' >&2
  return 1
}
