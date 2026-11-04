#!/usr/bin/env bash
# lib-offline-wait.sh 的干跑测试（#90 Mac 复验问题 2）：不真断网、不真睡。
# 覆盖：一开始就断网 → 不等；前 N 次检查都在线 → 等 N×10 秒就继续；无终端默认最多 600 秒（60 次检查）后返回 1；
#       HEYBE_OFFLINE_WAIT_SECS / HEYBE_OFFLINE_POLL_SECS 生效、最后一次按剩余秒数补齐；非法值用默认并提示；提示是中文。
# 用法: scripts/poc/offline-wait-mock-test.sh
set -euo pipefail
. "$(cd "$(dirname "$0")" && pwd)/lib-offline-wait.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
n=0
eq() { n=$((n + 1)); [ "$2" = "$3" ] || { echo "ASSERT FAIL [$1]: 期望 '$3'，实际 '$2'" >&2; exit 1; }; }
has() { n=$((n + 1)); grep -q -- "$2" <<<"$3" || { echo "ASSERT FAIL [$1]: 输出里没有 '$2'" >&2; printf '%s\n' "$3" >&2; exit 1; }; }
# 假 is_online：前 ONLINE_FOR 次返回在线；假 pause：只记秒数
is_online() { local c; c=$(cat "$T/checks" 2>/dev/null || echo 0); echo $((c + 1)) >"$T/checks"; [ "$c" -lt "$ONLINE_FOR" ]; }
heybe_offline_pause() { echo "$1" >>"$T/pauses"; }
heybe_offline_has_tty() { [ "${FAKE_TTY:-0}" = 1 ]; }
run() { rm -f "$T/checks" "$T/pauses"; : >"$T/pauses"; rc=0; out=$(heybe_wait_offline 2>&1) || rc=$?; }
sum() { awk '{ s += $1 } END { print s + 0 }' "$T/pauses"; }

unset HEYBE_OFFLINE_WAIT_SECS HEYBE_OFFLINE_POLL_SECS
ONLINE_FOR=0 run; eq "已断网 → rc" "$rc" 0; eq "已断网 → 不等" "$(sum)" 0; eq "已断网 → 不提示" "$out" ""
ONLINE_FOR=4 run; eq "第 5 次检查断网 → rc" "$rc" 0; eq "等了 40 秒" "$(sum)" 40
has "无终端提示" "没有交互终端：每 10 秒自动检查一次" "$out"; has "断网提示" "现在请断网" "$out"
has "剩余秒数" "已等 10 秒，还剩 590 秒" "$out"; has "检测到" "已检测到断网（等了约 40 秒）" "$out"
ONLINE_FOR=100000 run; eq "一直在线 → rc" "$rc" 1; eq "默认最多 600 秒" "$(sum)" 600
eq "每 10 秒一次（60 次）" "$(wc -l <"$T/pauses" | tr -d ' ')" 60; has "超时提示" "等了 600 秒仍能访问外网" "$out"
HEYBE_OFFLINE_WAIT_SECS=25 ONLINE_FOR=100000 run; eq "自定义 25 秒 → rc" "$rc" 1
eq "10+10+5" "$(tr '\n' ' ' <"$T/pauses")" "10 10 5 "
HEYBE_OFFLINE_WAIT_SECS=abc HEYBE_OFFLINE_POLL_SECS=0 ONLINE_FOR=2 run; eq "非法值 → 默认" "$(sum)" 20
has "非法值提示" "HEYBE_OFFLINE_WAIT_SECS=abc 不是正整数，改用默认 600" "$out"
FAKE_TTY=1 ONLINE_FOR=2 run; has "有终端提示" "也可以断好后按回车立刻检查" "$out"; eq "有终端也自动轮询" "$rc" 0
echo "offline wait mock test: PASS（${n} 项断言）"
