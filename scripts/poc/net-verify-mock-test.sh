#!/usr/bin/env bash
# lib-net-verify.sh 的干跑测试：验证 3 的判定只在每项都明确 NET_BLOCKED 时通过；
# 再用真实 sh 跑一遍 NET_PROBE_CMD（curl/getent/nslookup 换成假的），确认命令本身能产出这些标记。
# 用法: scripts/poc/net-verify-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-net-verify.sh
. "$SCRIPT_DIR/lib-net-verify.sh"
n=0
pass_case() { n=$((n+1)); net_verdict "$1" >/dev/null || { echo "ASSERT FAIL（应通过）：$2" >&2; exit 1; }; }
fail_case() { n=$((n+1)); local r; if r=$(net_verdict "$1"); then echo "ASSERT FAIL（应失败）：$2" >&2; exit 1; fi
  [ -z "${3:-}" ] || grep -q "$3" <<<"$r" || { echo "ASSERT FAIL：$2 的说明里没有「$3」：$r" >&2; exit 1; }; }
ALL='CURL=yes
EXT=NET_BLOCKED
HOST8100=NET_BLOCKED
HOST11434=NET_BLOCKED
DNS=NET_BLOCKED'
pass_case "$ALL" "四项都拦截"
pass_case "Here is the raw output: CURL=yes EXT=NET_BLOCKED HOST8100=NET_BLOCKED HOST11434=NET_BLOCKED DNS=NET_BLOCKED" "单行回复"
fail_case "${ALL/EXT=NET_BLOCKED/EXT=OPEN}" "外网通" "EXT=OPEN"
fail_case "${ALL/HOST8100=NET_BLOCKED/HOST8100=OPEN}" "宿主 8100 通" "HOST8100=OPEN"
fail_case "${ALL/HOST11434=NET_BLOCKED/HOST11434=OPEN}" "宿主 11434 通" "HOST11434=OPEN"
fail_case "${ALL/DNS=NET_BLOCKED/DNS=RESOLVED}" "DNS 能解析" "DNS=RESOLVED"
fail_case "${ALL/CURL=yes/CURL=no}" "没有 curl" "没有 curl"
fail_case "${ALL/DNS=NET_BLOCKED/}" "缺 DNS 标记" "缺标记 DNS"
fail_case "NET_BLOCKED" "旧版只回 NET_BLOCKED（没有逐项标记）" "无法判定"
fail_case "HTTP_200" "旧版外网通的输出" "无法判定"
fail_case "" "空回复" "无法判定"

# 用真实 sh 跑 NET_PROBE_CMD：假 curl 按 URL 决定通不通，假 getent/nslookup 决定 DNS
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mk() { printf '#!/bin/sh\n%s\n' "$2" >"$T/bin/$1"; chmod +x "$T/bin/$1"; }
run_probe() { # OPEN_URLS DNS_OK → 打印 NET_PROBE_CMD 的输出
  rm -rf "${T:?}/bin"; mkdir -p "$T/bin"
  mk curl "for a in \"\$@\"; do case \" $1 \" in *\" \$a \"*) exit 0 ;; esac; done; exit 7"
  mk getent "[ \"$2\" = 1 ]"; mk nslookup "[ \"$2\" = 1 ]"
  PATH="$T/bin:/usr/bin:/bin" sh -c "$NET_PROBE_CMD"
}
o=$(run_probe "" 0);                       n=$((n+1)); net_verdict "$o" >/dev/null || { echo "ASSERT FAIL：全拦截时真实命令输出没通过：$o" >&2; exit 1; }
o=$(run_probe "https://example.com" 0);    fail_case "$o" "真实命令：外网通" "EXT=OPEN"
o=$(run_probe "http://host.boxlite.internal:8100/v1/config" 0); fail_case "$o" "真实命令：宿主 8100 通" "HOST8100=OPEN"
o=$(run_probe "http://192.168.127.254:11434/" 0); fail_case "$o" "真实命令：宿主 11434 通" "HOST11434=OPEN"
o=$(run_probe "" 1);                       fail_case "$o" "真实命令：DNS 能解析" "DNS=RESOLVED"
rm -rf "${T:?}/bin"; mkdir -p "$T/bin"; ln -s "$(command -v sed)" "$T/bin/sed"
o=$(PATH="$T/bin" /bin/sh -c "$NET_PROBE_CMD" 2>/dev/null || true); fail_case "$o" "真实命令：镜像里没有 curl" "没有 curl"
echo "net-verify mock test: ${n} 条断言全部通过"
