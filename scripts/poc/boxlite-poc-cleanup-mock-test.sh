#!/usr/bin/env bash
# PoC 进程清理的 mock 测试（不需要 boxlite / fastclaw）：用 exec -a 起假的 "boxlite serve" / "boxlite-proxy" /
# "fastclaw gateway" 进程，检查
#   1. boxlite-poc.sh cleanup-procs 只结束 pid 文件 + 命令行核对得上的 PoC 进程：同名的外来进程、pid 文件里
#      被复用成别的命令的 pid 都不动；没有标记文件的旧 pid 文件按默认片段核对；
#   2. heybe-desktop-dev.sh 遇到 PoC 进程报 E_RUNNING 并给出 PoC 清理命令，不杀任何进程；
#      --stop-poc 只结束 PoC 进程；混有外来进程时仍 E_RUNNING，外来进程还活着。
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
T=$(mktemp -d)
PIDS=""
cleanup() { for p in $PIDS; do kill "$p" 2>/dev/null; done; rm -rf "$T"; }
trap cleanup EXIT
FAILS=0
ok() { printf '  ok   %s\n' "$*"; }
bad() { printf '  FAIL %s\n' "$*"; FAILS=$((FAILS + 1)); }
alive() { kill -0 "$1" 2>/dev/null; }
spawn() { # argv0 → 打印 pid
  bash -c "exec -a '$1' sleep 300" >/dev/null 2>&1 &
  PIDS="$PIDS $!"; echo $!
}
POC="$T/poc"; mkdir -p "$POC"
# shellcheck source=lib-poc-procs.sh
. "$HERE/lib-poc-procs.sh"
setup_poc() { # 起三个 PoC 进程并写 pid 文件 + 标记
  S=$(spawn "boxlite serve --host 127.0.0.1 --port 8100"); echo "$S" >"$POC/boxlite.pid"; poc_mark "$POC" boxlite
  P=$(spawn "node $REPO/services/task-manager/src/boxlite-proxy.ts"); echo "$P" >"$POC/boxlite-proxy.pid"; poc_mark "$POC" boxlite-proxy
  G=$(spawn "fastclaw gateway --port 18953"); echo "$G" >"$POC/fastclaw.pid"; poc_mark "$POC" fastclaw
  sleep 0.3
}

echo "== 1 boxlite-poc.sh cleanup-procs 只结束自己的进程"
setup_poc
F=$(spawn "fastclaw gateway --port 18963")      # 外来：同名但不在 pid 文件里
R=$(spawn "unrelated-daemon --serve")           # pid 被复用：pid 文件指向别的命令
rm -f "$POC/fastclaw.pid.marker"                # 旧版 pid 文件：没有标记，按默认片段核对
sleep 0.3
[ "$(poc_list "$POC" | wc -l | tr -d ' ')" = 3 ] && ok "poc_list 认出 3 个 PoC 进程" || bad "poc_list: $(poc_list "$POC")"
[ "$(stat -c %a "$POC/boxlite.pid.marker" 2>/dev/null || stat -f %Lp "$POC/boxlite.pid.marker")" = 600 ] && ok "标记文件 600" || bad "标记文件权限"
out=$(HEYBE_POC_HOME="$POC" bash "$HERE/boxlite-poc.sh" cleanup-procs 2>&1); rc=$?
[ "$rc" = 0 ] && ok "cleanup-procs 退出码 0" || { bad "cleanup-procs rc=$rc"; printf '%s\n' "$out" | sed 's/^/       | /'; }
sleep 0.3
for x in "$S:serve" "$P:代理" "$G:gateway（无标记的旧 pid 文件）"; do
  alive "${x%%:*}" && bad "PoC ${x#*:} 还活着" || ok "PoC ${x#*:} 已结束"
done
alive "$F" && ok "同名外来 fastclaw gateway 没被动" || bad "外来进程被杀了"
echo "$R" >"$POC/boxlite.pid"; poc_mark "$POC" boxlite
out=$(HEYBE_POC_HOME="$POC" bash "$HERE/boxlite-poc.sh" cleanup-procs 2>&1)
alive "$R" && ok "pid 被复用成别的命令时不杀" || bad "复用 pid 被杀了"
printf '%s\n' "$out" | grep -q "跳过 boxlite" && ok "提示跳过" || bad "没提示跳过: $out"
[ ! -e "$POC/boxlite.pid" ] && ok "过期 pid 文件已删" || bad "pid 文件还在"
kill "$F" "$R" 2>/dev/null; sleep 0.3

DEV="$REPO/scripts/dev/heybe-desktop-dev.sh"
run_dev() { HEYBE_POC_HOME="$POC" HEYBE_T021_HOME="$T/t021" bash "$DEV" "$@" >"$T/out" 2>&1; echo $? >"$T/rc"; }

echo "== 2 heybe-desktop-dev.sh：只有 PoC 进程 → E_RUNNING + 清理命令，不杀"
setup_poc
run_dev
[ "$(cat "$T/rc")" = 1 ] && ok "退出码 1" || bad "rc=$(cat "$T/rc")"
grep -q "E_RUNNING" "$T/out" && ok "E_RUNNING" || bad "没有 E_RUNNING"
grep -q "scripts/poc/boxlite-poc.sh cleanup" "$T/out" && ok "给出 PoC 清理命令" || { bad "没给清理命令"; sed 's/^/       | /' "$T/out"; }
grep -q "fastclaw(pid $G)" "$T/out" && ok "列出 PoC gateway pid" || bad "没列 PoC pid"
grep -q "不是 PoC 起的" "$T/out" && bad "不该提示外来进程" || ok "没有外来进程提示"
alive "$S" && alive "$G" && ok "没加 --stop-poc 时不杀任何进程" || bad "进程被杀了"
run_dev check
grep -q "E_LEFTOVER" "$T/out" && grep -q "boxlite-poc.sh cleanup" "$T/out" && ok "check 也给出 PoC 清理命令" || bad "check 输出不对"

echo "== 3 --stop-poc：PoC + 外来进程"
F=$(spawn "fastclaw gateway --port 18963"); sleep 0.3
run_dev --stop-poc
sleep 0.3
alive "$S" || alive "$G" || alive "$P" && bad "PoC 进程还活着" || ok "PoC 进程已结束"
alive "$F" && ok "外来进程还活着" || bad "外来进程被杀了"
grep -q "E_RUNNING" "$T/out" && grep -q "不是 PoC 起的" "$T/out" && ok "仍 E_RUNNING 并说明不会动外来进程" || { bad "输出不对"; sed 's/^/       | /' "$T/out"; }
kill "$F"; sleep 0.3

echo "== 4 --stop-poc：只有 PoC 进程 → 结束后继续往下走"
setup_poc
run_dev --stop-poc
alive "$S" || alive "$G" || alive "$P" && bad "PoC 进程还活着" || ok "PoC 进程已结束"
grep -q "PoC 进程已结束" "$T/out" && ok "提示已结束" || bad "没提示"
grep -q "E_RUNNING" "$T/out" && bad "不该再 E_RUNNING" || ok "越过了 E_RUNNING（$(grep -o 'E_[A-Z_]*' "$T/out" | head -1 || echo 继续)）"

if [ "$FAILS" = 0 ]; then echo "全部通过"; else echo "失败 ${FAILS} 项"; exit 1; fi
