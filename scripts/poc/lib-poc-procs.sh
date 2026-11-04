#!/usr/bin/env bash
# PoC（boxlite-poc.sh）自己起的后台进程：pid 文件 + 标记文件，清理时只认自己的进程（bash 3.2 可用）。
#   $POC_HOME/boxlite.pid        boxlite serve          （标记 boxlite.pid.marker）
#   $POC_HOME/boxlite-proxy.pid  tsx boxlite-proxy.ts   （标记 boxlite-proxy.pid.marker）
#   $POC_HOME/fastclaw.pid       fastclaw gateway       （标记 fastclaw.pid.marker）
# 标记文件内容：第一行 heybe-poc，第二行该进程命令行里必须出现的片段。
# 杀进程前同时核对：pid 还活着、命令行包含标记片段。pid 被系统复用成别的进程时不会被杀。
# 本脚本之前版本起的进程没有标记文件，按 pid 文件名用同样的默认片段核对。

POC_PROC_NAMES="fastclaw boxlite-proxy boxlite"

poc_default_pattern() { # name → 命令行片段
  case "$1" in
    boxlite) echo "boxlite serve" ;;
    boxlite-proxy) echo "boxlite-proxy" ;;
    fastclaw) echo "fastclaw gateway" ;;
    *) echo "" ;;
  esac
}

poc_mark() { # poc_home name：给刚写好的 pid 文件配标记
  local f="$1/$2.pid.marker"
  printf 'heybe-poc\n%s\n' "$(poc_default_pattern "$2")" >"$f"
  chmod 600 "$f" 2>/dev/null || true
}

poc_cmdline() { ps -p "$1" -o command= 2>/dev/null || true; }

poc_verified_pid() { # poc_home name → 打印核对通过的 pid（否则不打印）
  local home="$1" name="$2" pid pat
  [ -f "$home/$name.pid" ] || return 0
  pid=$(tr -cd '0-9' <"$home/$name.pid")
  [ -n "$pid" ] || return 0
  pat=$(poc_default_pattern "$name")
  if [ -f "$home/$name.pid.marker" ]; then
    [ "$(sed -n 1p "$home/$name.pid.marker")" = heybe-poc ] || return 0
    pat=$(sed -n 2p "$home/$name.pid.marker")
  fi
  [ -n "$pat" ] || return 0
  case "$(poc_cmdline "$pid")" in *"$pat"*) echo "$pid" ;; esac
}

poc_list() { # poc_home → 每行 "pid name"（只列核对通过、还在跑的）
  local n p
  for n in $POC_PROC_NAMES; do
    p=$(poc_verified_pid "$1" "$n")
    [ -n "$p" ] && echo "$p $n"
  done
  return 0
}

poc_stop() { # poc_home → 只结束核对通过的 PoC 进程（连同它们的直接子进程），删掉对应 pid/标记文件
  local home="$1" n p kids
  for n in $POC_PROC_NAMES; do
    p=$(poc_verified_pid "$home" "$n")
    if [ -n "$p" ]; then
      kids=$(pgrep -P "$p" 2>/dev/null || true)
      # shellcheck disable=SC2086
      kill "$p" $kids 2>/dev/null || true
      for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
      # 还活着且仍是同一个 PoC 进程才强杀
      [ -n "$(poc_verified_pid "$home" "$n")" ] && kill -9 "$p" 2>/dev/null || true
      echo "已结束 PoC 进程 ${n}（pid ${p}）"
    elif [ -f "$home/$n.pid" ]; then
      echo "跳过 ${n}：pid 文件里的进程已不在或不是 PoC 进程，不动它"
    fi
    rm -f "$home/$n.pid" "$home/$n.pid.marker"
  done
}
