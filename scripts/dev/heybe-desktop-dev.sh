#!/usr/bin/env bash
# Heybe 桌面版一键开发启动（#19-b，Apple Silicon Mac）。
# 用法：
#   scripts/dev/heybe-desktop-dev.sh          预检 → DeepSeek key 连接测试 → （首次或 key 变了）跑 t021 建/更新 Agent
#                                             → pnpm install → tauri dev
#   scripts/dev/heybe-desktop-dev.sh check    退出 Heybe 后检查：没有残留的 fastclaw / 本地服务进程
#   --yes          better-sqlite3 与当前 node 不匹配时直接 pnpm rebuild，不先问
#   --mirror cn    本次编译 Rust 时 crates.io 走国内镜像（默认 rsproxy.cn，HEYBE_CARGO_MIRROR 可改）；
#                  也可写 HEYBE_MIRROR=cn。只给这次的 cargo 传 --config，不改 ~/.cargo/config（scripts/lib-mirror.sh）
# Node：仓库固定 Node 22（.nvmrc）。启动前会实际加载一次 better-sqlite3，不匹配（NODE_MODULE_VERSION）时
#   提示切换 Node 或重建（scripts/dev/lib-node-check.sh）。
# 密钥：只从 600 文件读进 shell 变量，不打印、不落别的盘。窗口里的服务地址和令牌由 Tauri 每次随机生成。
# 换 key：每次启动都比对 ~/.heybe-poc.env 里 DEEPSEEK_API_KEY 的 sha256 和数据目录里的指纹
#   （${T021_HOME}/deepseek-key.sha256，600，只有哈希）。不一样（或没有指纹，比如 10-29 建的旧目录）就重跑 t021：
#   带 --id 原地更新 Agent 的 key 并做一次真实对话。原地更新失败时把旧目录改名为 heybe-t021.bak-时间（不删）再重建。
#   HEYBE_SKIP_KEY_TEST=1 跳过启动时的 DeepSeek 连接测试。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib-node-check.sh
. "$REPO_ROOT/scripts/dev/lib-node-check.sh"
# shellcheck source=../lib-mirror.sh
. "$REPO_ROOT/scripts/lib-mirror.sh"
# shellcheck source=../poc/lib-fc-env.sh
. "$REPO_ROOT/scripts/poc/lib-fc-env.sh"
# shellcheck source=../poc/lib-fc-agent.sh
. "$REPO_ROOT/scripts/poc/lib-fc-agent.sh"
# shellcheck source=../poc/lib-fc-key.sh
. "$REPO_ROOT/scripts/poc/lib-fc-key.sh"
CMD="" YES=0 MIRROR="${HEYBE_MIRROR:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    check) CMD=check ;;
    --yes|-y) YES=1 ;;
    --mirror) [ $# -ge 2 ] || { echo "--mirror 后面要写 cn 或 off" >&2; exit 2; }; MIRROR="$2"; shift ;;
    --mirror=*) MIRROR="${1#--mirror=}" ;;
    -h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0"; exit 0 ;;
    *) echo "未知参数：${1}（--help 查看用法）" >&2; exit 2 ;;
  esac
  shift
done
heybe_mirror_setup "$MIRROR" || exit 2
T021_HOME="${HEYBE_T021_HOME:-$HOME/.local/opt/heybe-t021}"
FC_HOME="${T021_HOME}/fastclaw-home"
FC_BIN="${HEYBE_FASTCLAW_BIN:-$HOME/.local/opt/fastclaw/bin/fastclaw}"
PORT="${HEYBE_T021_PORT:-18963}"
KEY_FILE="${T021_HOME}/fastclaw-apikey"
POC_ENV="${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}"

ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
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
# 端口被占（例如上次留下、报 "FastClaw dev" 的 daemon，或别的程序）：直接报错，不去连别人的 gateway
port_busy() { (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; }
if port_busy; then
  if curl -s -o /dev/null -m 2 "http://127.0.0.1:${PORT}/healthz"; then
    die E_FC_FOREIGN_GATEWAY "端口 ${PORT} 上已经有一个 FastClaw gateway 在跑（不是这次启动的）。先 fastclaw daemon stop 或 scripts/poc/t021-mac.sh cleanup；也可以 HEYBE_T021_PORT=别的端口"
  fi
  die E_FC_PORT_BUSY "端口 ${PORT} 被别的程序占用（lsof -nP -iTCP:${PORT} -sTCP:LISTEN 查是谁），或者 HEYBE_T021_PORT=别的端口"
fi

echo "== DeepSeek key"
rc=0; heybe_load_poc_key "$POC_ENV" || rc=$?
case "$rc" in
  0) ;;
  2) die E_ENV_MISSING "找不到 ${POC_ENV}：写一行 DEEPSEEK_API_KEY=…，再 chmod 600" ;;
  3) die E_ENV_PERM "${POC_ENV} 权限必须是 600：chmod 600 ${POC_ENV}" ;;
  *) die E_ENV_EMPTY "${POC_ENV} 里没有 DEEPSEEK_API_KEY=" ;;
esac
if [ "${HEYBE_SKIP_KEY_TEST:-0}" != 1 ]; then
  code="$(heybe_deepseek_probe DEEPSEEK_API_KEY)"
  case "$code" in
    200) ok "连接测试通过：DeepSeek 认这个 key" ;;
    401|403) die E_KEY_INVALID "DeepSeek 不认这个 key（HTTP ${code}）：模型密钥无效，请到 ${POC_ENV} 换成有效的 DEEPSEEK_API_KEY（保持 600），再重新运行本脚本" ;;
    000) warn "连不上 DeepSeek（网络或超时），跳过连接测试；对话时如果失败，界面会显示具体原因" ;;
    *) warn "DeepSeek 连接测试返回 HTTP ${code}，先继续；对话时如果失败，界面会显示具体原因" ;;
  esac
fi
HEYBE_KEY_SYNC_FORCE=0
if [ ! -s "$KEY_FILE" ] || [ ! -x "$FC_BIN" ]; then HEYBE_KEY_SYNC_FORCE=1; fi
case "$(heybe_key_state "$T021_HOME" DEEPSEEK_API_KEY)/${HEYBE_KEY_SYNC_FORCE}" in
  same/0) ok "key 没变（指纹一致），复用 ${T021_HOME}" ;;
  */1) echo "== 首次准备：FastClaw + DeepSeek Agent（scripts/poc/t021-mac.sh）" ;;
  new/*) echo "== 数据目录里还没有 key 指纹（旧版本建的），按换过 key 处理：更新 Agent 的 key（scripts/poc/t021-mac.sh）" ;;
  *) echo "== ${POC_ENV} 里的 DEEPSEEK_API_KEY 变了：更新 Agent 的 key（scripts/poc/t021-mac.sh）" ;;
esac
rc=0
# t021 自己再从 600 文件读一次 key；这里的 key 不传给它（env -u），只用来比对指纹
heybe_key_sync "$T021_HOME" env -u DEEPSEEK_API_KEY "$REPO_ROOT/scripts/poc/t021-mac.sh" || rc=$?
unset DEEPSEEK_API_KEY
[ -n "$HEYBE_KEY_SYNC_BACKUP" ] && warn "原地更新失败，旧数据目录已改名备份为 ${HEYBE_KEY_SYNC_BACKUP}（没删），已重建"
[ "$rc" = 0 ] || die E_T021 "t021 没跑通（见上面的报错；报告在 ${T021_HOME}/t021-report.txt）"
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
ok "$(heybe_mirror_summary)"
cd "$REPO_ROOT/apps/desktop"
# tauri dev -- <参数> 原样传给 cargo run；没配镜像时不传任何参数
if [ -n "$HEYBE_CARGO_MIRROR" ]; then exec pnpm tauri dev -- "${HEYBE_CARGO_ARGS[@]}"; fi
exec pnpm tauri dev
