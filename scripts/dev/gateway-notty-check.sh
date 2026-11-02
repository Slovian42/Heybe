#!/usr/bin/env bash
# 无 TTY 复现/验证：模拟从 Dock/Finder 启动（没有控制终端），用真的 fastclaw 跑一遍本地服务。
# 本地服务（services/task-manager main.ts）会拉起 FastClaw gateway；这里检查：
#   1) 能打出 READY，gateway 的 /healthz 正常；2) 没有走 daemon（没有 `daemon __run` 进程）；
#   3) SIGTERM 后 gateway 一起退出，端口释放，不留进程。
# 用法：FASTCLAW_BIN=/path/to/fastclaw scripts/dev/gateway-notty-check.sh
#   用临时数据目录和临时端口，不碰 ~/.local/opt/heybe-t021。兼容 macOS 自带 bash 3.2。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=../poc/lib-fc-env.sh
. "$REPO_ROOT/scripts/poc/lib-fc-env.sh"
FC="${FASTCLAW_BIN:-$(command -v fastclaw || true)}"
[ -n "$FC" ] && [ -x "$FC" ] || { echo "✗ 找不到 fastclaw（设 FASTCLAW_BIN）" >&2; exit 2; }
TSX="$REPO_ROOT/services/task-manager/node_modules/.bin/tsx"
[ -x "$TSX" ] || { echo "✗ 先在仓库根目录跑 pnpm install" >&2; exit 2; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/heybe-notty.XXXXXX")"
PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')"
SVC_PID=""
cleanup() {
  [ -n "$SVC_PID" ] && kill "$SVC_PID" 2>/dev/null || true
  pkill -f "$FC gateway --port ${PORT}" 2>/dev/null || true
  pkill -f "$FC daemon __run --port ${PORT}" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT
fail() { echo "✗ $*" >&2; sed -n '1,40p' "$WORK/err.log" >&2 || true; exit 1; }

# 新会话 = 没有控制终端，打开 /dev/tty 会失败（Linux 用 setsid，macOS 用 perl 的 POSIX::setsid）
if command -v setsid >/dev/null 2>&1; then NOTTY=(setsid); else NOTTY=(perl -MPOSIX -e 'POSIX::setsid() or die "setsid: $!"; exec @ARGV or die "exec: $!"'); fi

# 先像 t021 一样初始化数据目录（有管理员和 agent），这样旧代码会一路走到 TUI，复现 Mac 上的报错。
# agents init 的输出里有生成的管理员密码：直接丢掉，不落盘；它顺手拉起的 daemon 立刻停掉。
FCENV=(env -i PATH="$PATH" HOME="$WORK" FASTCLAW_HOME="$WORK/fastclaw" FASTCLAW_PORT="$PORT" FASTCLAW_BIND=loopback)
"${FCENV[@]}" "$FC" agents init notty-check --provider ollama --model ollama/qwen3 --api-base http://127.0.0.1:9 >/dev/null 2>&1 \
  || { echo "✗ fastclaw agents init 失败" >&2; exit 1; }
"${FCENV[@]}" "$FC" daemon stop >/dev/null 2>&1 || true
i=0
while curl -s -m 1 -o /dev/null "http://127.0.0.1:${PORT}/healthz" || pgrep -f "$FC daemon __run --port ${PORT}" >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -le 20 ] || { echo "✗ agents init 拉起的 daemon 停不掉" >&2; exit 1; }
  # daemon 的看门狗会把 gateway 拉回来：先停看门狗，再停 gateway
  pkill -f "$FC daemon __run --port ${PORT}" 2>/dev/null || true
  pkill -f "$FC gateway --port ${PORT}" 2>/dev/null || true
  sleep 0.5
done

TOKEN="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')"
# HEYBE_SERVICE_TOKEN 只经环境继承交给服务（fc_env_only_kv 用内建 export），不进 env 的 argv。
( fc_env_only_kv PATH="$PATH" HOME="$WORK" FASTCLAW_HOME="$WORK/fastclaw" FASTCLAW_PORT="$PORT" FASTCLAW_BIND=loopback \
    HEYBE_FASTCLAW_GATEWAY_BIN="$FC" HEYBE_SERVICE_TOKEN="$TOKEN" HEYBE_SERVICE_PORT=0 \
  && exec "${NOTTY[@]}" "$TSX" "$REPO_ROOT/services/task-manager/src/main.ts" ) </dev/null >"$WORK/out.log" 2>"$WORK/err.log" &
SVC_PID=$!

i=0
while ! grep -q '^HEYBE_SERVICE_READY ' "$WORK/out.log" 2>/dev/null; do
  kill -0 "$SVC_PID" 2>/dev/null || fail "本地服务没打出 READY 就退出了"
  i=$((i + 1)); [ "$i" -le 120 ] || fail "60 秒内没有 READY"
  sleep 0.5
done
echo "✓ 无 TTY 下本地服务 READY"
curl -fsS -m 2 -o /dev/null "http://127.0.0.1:${PORT}/healthz" || fail "gateway /healthz 不通"
echo "✓ FastClaw gateway 在 127.0.0.1:${PORT} 正常"
if pgrep -f "$FC daemon __run" >/dev/null 2>&1; then fail "有 fastclaw daemon 进程（走了 chat/daemon 路径）"; fi
if grep -q 'could not open a new TTY' "$WORK/err.log"; then fail "仍然出现 could not open a new TTY"; fi
echo "✓ 没有 daemon 进程，没有 TTY 报错"

kill -TERM "$SVC_PID"
i=0
while kill -0 "$SVC_PID" 2>/dev/null; do i=$((i + 1)); [ "$i" -le 20 ] || fail "SIGTERM 后 10 秒没退出"; sleep 0.5; done
SVC_PID=""
sleep 1
if pgrep -f "$FC gateway --port ${PORT}" >/dev/null 2>&1; then fail "本地服务退出后 gateway 还在"; fi
if curl -s -m 1 -o /dev/null "http://127.0.0.1:${PORT}/healthz"; then fail "端口 ${PORT} 还有人在听"; fi
echo "✓ SIGTERM 后 gateway 一起退出，端口 ${PORT} 已释放"
