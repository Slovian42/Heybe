#!/usr/bin/env bash
# report-table-test.sh — boxlite-poc.sh「回填表」解析的 mock 测试（不需要 BoxLite/Lima/FastClaw）
#   1) 用 2026-11-02 Mac 实测的 results.tsv（testdata/，路径已脱敏）生成表，核对体积列：
#      旧解析把 "install_size_boxlite= 96M" 这类带前导空格的值丢掉
#   2) parse_metrics 边界：空值后紧跟下一个 key、值里带 '='、[backend] 前缀
#   3) dsz：模拟 macOS du 在体积前补空格
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAILN=0
ok()  { PASS=$((PASS + 1)); echo "  ✓ $*"; }
bad() { FAILN=$((FAILN + 1)); echo "  ✗ $*"; }
has() { # has <输出> <期望子串> <说明>
  case $1 in *"$2"*) ok "$3" ;; *) bad "$3（期望包含：$2）" ;; esac
}

echo "== 1. 真实 results.tsv"
OUT=$(python3 "$HERE/poc-report-table.py" "$HERE/testdata/results-2026-11-02-mac.tsv")
has "$OUT" "| 安装/数据体积 | 96M / 5.7G | 79M / 6.5G |" "安装/数据体积：96M / 5.7G，79M / 6.5G"
has "$OUT" "lima_install=79M |" "组件版本列 lima_install=79M"
has "$OUT" "| macOS / 芯片 / 内存 | 26.5.2 / arm64 / 24GB |" "macOS 行不受影响"
has "$OUT" "| 首轮对话 ms | 5866 | 2583 |" "[backend] 前缀的 first_turn_ms"
case $OUT in *"|  /"*|*"= |"*) bad "表里仍有空值（|  / 或 = |）" ;; *) ok "没有被丢掉的空值" ;; esac

echo "== 2. parse_metrics 边界"
# bash 3.2：heredoc 不放进 $( )，包成函数
parse_cases() {
  python3 - "$HERE" <<'PY'
import sys
import importlib.util
spec = importlib.util.spec_from_file_location("t", sys.argv[1] + "/poc-report-table.py")
t = importlib.util.module_from_spec(spec); spec.loader.exec_module(t)
cases = [
    ("install_size_boxlite= 96M install_size_fastclaw= 65M", {"install_size_boxlite": "96M", "install_size_fastclaw": "65M"}),
    ("a= b=1", {"a": "", "b": "1"}),
    ("url=http://x/?q=1 n=2", {"url": "http://x/?q=1", "n": "2"}),
    ("[docker] first_turn_ms= 2583", {"[docker]first_turn_ms": "2583"}),
    ("boxlite_data_size=   81M  ", {"boxlite_data_size": "81M"}),
]
for payload, want in cases:
    got = t.parse_metrics(payload)
    print(("OK " if got == want else "BAD ") + repr(payload) + " -> " + repr(got))
PY
}
P=$(parse_cases)
while IFS= read -r l; do case $l in OK*) ok "${l#OK }" ;; *) bad "${l#BAD }" ;; esac; done <<EOF2
$P
EOF2

echo "== 3. dsz 去掉 du 的前导空格"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin"
printf '#!/bin/sh\nprintf " 96M\\t%%s\\n" "$3"\n' >"$T/bin/du"; chmod +x "$T/bin/du"
eval "$(grep '^dsz()' "$HERE/boxlite-poc.sh")"
v=$(PATH="$T/bin:$PATH" dsz /x)
[ "$v" = 96M ] && ok "dsz → 96M" || bad "dsz → [$v]"
printf '#!/bin/sh\nexit 1\n' >"$T/bin/du"
if v=$(PATH="$T/bin:$PATH" dsz /x); then bad "du 失败时 dsz 应返回 1（得到 [$v]）"; else ok "du 失败时 dsz 返回 1（走 || echo 待核实路径）"; fi

echo "== 结果：${PASS} 通过 / ${FAILN} 失败"
[ "$FAILN" -eq 0 ]
