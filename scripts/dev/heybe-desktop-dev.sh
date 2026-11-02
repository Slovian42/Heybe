#!/usr/bin/env bash
# Heybe 桌面版一键开发启动（#19-b，Apple Silicon Mac）。
# 用法：
#   scripts/dev/heybe-desktop-dev.sh          预检 → （首次）跑 t021 准备 FastClaw+DeepSeek → pnpm install → tauri dev
#   scripts/dev/heybe-desktop-dev.sh check    退出 Heybe 后检查：没有残留的 fastclaw / 本地服务进程
#   --yes    better-sqlite3 与当前 node 不匹配时直接 pnpm rebuild，不先问
# Node：仓库固定 Node 22（.nvmrc）。启动前会实际加载一次 better-sqlite3，不匹配（NODE_MODULE_VERSION）时
#   提示切换 Node 或重建（scripts/dev/lib-node-check.sh）。
# 密钥：只从 600 文件读进环境变量，不打印、不落别的盘。窗口里的服务地址和令牌由 Tauri 每次随机生成。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib-node-check.sh
. "$REPO_ROOT/scripts/dev/lib-node-check.sh"
CMD="" YES=0
for a in "$@"; do
  case "$a" in
    check) CMD=check ;;
    --yes|-y) YES=1 ;;
    -h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0"; exit 0 ;;
    *) echo "未知参数：$a（--help 查看用法）" >&2; exit 2 ;;
  esac
done
T021_HOME="${HEYBE_T021_HOME:-$HOME/.local/opt/heybe-t021}"
FC_HOME="${T021_HOME}/fastclaw-home"
FC_BIN="${HEYBE_FASTCLAW_BIN:-$HOME/.local/opt/fastclaw/bin/fastclaw}"
PORT="${HEYBE_T021_PORT:-18963}"
KEY_FILE="${T021_HOME}/fastclaw-apikey"

ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '  \033[31m✗ [%s]\033[0m %s\n' "$1" "$2" >&2; exit 1; }

leftovers() { pgrep -fl "fastclaw|services/task-manager/src/main.ts" | grep -v -E "pgrep|heybe-desktop-dev" || true; }

if [ "$CMD" = "check" ]; then
  left="$(leftovers)"
  if [ -n "$left" ]; then printf '%s\n' "$left"; die E_LEFTOVER "还有残留进程（见上）"; fi
  curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz" && die E_LEFTOVER "端口 ${PORT} 上 FastClaw 还在响应"
  ok "没有残留进程，端口 ${PORT} 已释放"
  exit 0
fi

echo "== 预检"
[ "$(uname -s)/$(uname -m)" = "Darwin/arm64" ] || die E_PLATFORM "只支持 Apple Silicon Mac（当前 $(uname -s)/$(uname -m)）"
xcode-select -p >/dev/null 2>&1 || die E_XCODE "缺 Xcode 命令行工具：xcode-select --install"
command -v node >/dev/null || die E_NODE "缺 node（推荐 Node $(cat "$REPO_ROOT/.nvmrc")：nvm install / fnm install）"
command -v pnpm >/dev/null || die E_PNPM "缺 pnpm：corepack enable"
command -v cargo >/dev/null || die E_RUST "缺 Rust：https://rustup.rs"
if command -v rustup >/dev/null && ! rustup target list --installed | grep -q aarch64-apple-darwin; then
  rustup target add aarch64-apple-darwin
fi
ok "node $(node -v)、pnpm $(pnpm -v)、$(cargo -V | cut -d' ' -f1-2)"

if [ -n "$(leftovers)" ]; then die E_RUNNING "已有 fastclaw/本地服务在跑（可能是上次的 t021 或 Heybe）。先退出，或跑：scripts/poc/t021-mac.sh cleanup"; fi

if [ ! -s "$KEY_FILE" ] || [ ! -x "$FC_BIN" ]; then
  echo "== 首次准备：FastClaw + DeepSeek Agent（scripts/poc/t021-mac.sh）"
  "$REPO_ROOT/scripts/poc/t021-mac.sh"
fi
[ -s "$KEY_FILE" ] || die E_APIKEY "没有 $KEY_FILE，请先跑通 scripts/poc/t021-mac.sh"
[ "$(stat -f %Lp "$KEY_FILE")" = "600" ] || die E_PERM "$KEY_FILE 权限必须是 600"
ok "FastClaw 数据目录 ${FC_HOME}，端口 ${PORT}"

echo "== 依赖"
(cd "$REPO_ROOT" && pnpm install --frozen-lockfile >/dev/null)
ok "pnpm install 完成"
heybe_node_check "$REPO_ROOT" "$YES" || die E_NODE_ABI "better-sqlite3 和当前 node $(node -v) 不匹配，本地服务起不来（见上面的说明）"
ok "better-sqlite3 能在 node $(node -v) 下加载"

# 本地服务（由 Tauri 拉起）负责启动/停止 gateway；这里只给它路径和端口。
export HEYBE_FASTCLAW_GATEWAY_BIN="$FC_BIN"
export FASTCLAW_HOME="$FC_HOME" FASTCLAW_PORT="$PORT"
export HEYBE_FASTCLAW_BASE_URL="http://127.0.0.1:${PORT}"
HEYBE_FASTCLAW_CHAT_TOKEN="$(cat "$KEY_FILE")"; export HEYBE_FASTCLAW_CHAT_TOKEN

echo "== 启动 Heybe（首次编译 Rust 要几分钟；关窗=隐藏，Cmd+Q=退出）"
cd "$REPO_ROOT/apps/desktop"
exec pnpm tauri dev
