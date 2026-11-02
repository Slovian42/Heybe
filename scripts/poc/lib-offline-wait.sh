# shellcheck shell=bash
# 等用户断网（t022-mac.sh 用；macOS bash 3.2 兼容）。
#   heybe_wait_offline：每 HEYBE_OFFLINE_POLL_SECS（默认 10）秒检查一次 is_online（调用方定义），一断网立刻返回 0；
#   最多等 HEYBE_OFFLINE_WAIT_SECS 秒（默认 600），到时还在线返回 1。
#   有交互终端时，等待期间按回车会立刻再检查一次（read -t），不按也照样每 10 秒自动检查。
#   等待时长按轮询间隔累加计算（不读系统时钟），提示里显示剩余秒数。
# 测试可覆盖：is_online、heybe_offline_has_tty、heybe_offline_pause（默认：有终端 read -t，没有 sleep）。

heybe_offline_has_tty() { [ -r /dev/tty ] && { : </dev/tty; } 2>/dev/null; }
heybe_offline_pause() { # secs
  if heybe_offline_has_tty; then read -r -t "$1" _ </dev/tty || true; else sleep "$1"; fi
}
heybe_offline_num() { # name value default → 打印合法的正整数，不合法时提示并用默认值
  case "$2" in
    ''|*[!0-9]*|0) [ -z "$2" ] || printf '>>> %s=%s 不是正整数，改用默认 %s\n' "$1" "$2" "$3" >&2; printf '%s' "$3" ;;
    *) printf '%s' "$2" ;;
  esac
}
heybe_wait_offline() {
  local total poll waited=0 left
  total=$(heybe_offline_num HEYBE_OFFLINE_WAIT_SECS "${HEYBE_OFFLINE_WAIT_SECS:-}" 600)
  poll=$(heybe_offline_num HEYBE_OFFLINE_POLL_SECS "${HEYBE_OFFLINE_POLL_SECS:-}" 10)
  is_online || return 0
  printf '\n\033[1m>>> 现在请断网：点屏幕右上角 Wi-Fi 图标把 Wi-Fi 关掉（插网线的把网线拔掉，手机热点、VPN 也断开）。\033[0m\n'
  if heybe_offline_has_tty; then
    printf '>>> 每 %s 秒自动检查一次，断网后会自动继续（也可以断好后按回车立刻检查）；最多等 %s 秒。\n' "$poll" "$total"
  else
    printf '>>> 没有交互终端：每 %s 秒自动检查一次，断网后自动继续；最多等 %s 秒（HEYBE_OFFLINE_WAIT_SECS 可改）。\n' "$poll" "$total"
  fi
  while [ "$waited" -lt "$total" ]; do
    left=$((total - waited))
    [ "$poll" -le "$left" ] || poll=$left
    heybe_offline_pause "$poll"
    waited=$((waited + poll))
    if ! is_online; then printf '>>> 已检测到断网（等了约 %s 秒）\n' "$waited"; return 0; fi
    [ "$waited" -ge "$total" ] || printf '>>> 仍能访问外网，继续等待（已等 %s 秒，还剩 %s 秒）…\n' "$waited" "$((total - waited))"
  done
  printf '>>> 等了 %s 秒仍能访问外网\n' "$waited"
  return 1
}
