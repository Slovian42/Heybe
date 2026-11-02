#!/usr/bin/env bash
# lib-node-check.sh 的干跑测试：假 node / pnpm，模拟“better-sqlite3 用 Node 22 编译、当前是 Node 26”。
# 用法: scripts/dev/node-check-mock-test.sh   （任一断言失败退出码非 0）
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=lib-node-check.sh
. "$HERE/lib-node-check.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/repo/services/task-manager" "$T/bin"
echo 22 >"$T/repo/.nvmrc"
cat >"$T/bin/node" <<'SH'
#!/bin/sh
case "$1" in
  -v) echo v26.1.0 ;;
  -p) echo 26 ;;
  -e) case "${MOCK_NODE_MODE:-abi}" in
        ok) exit 0 ;;
        other) echo "Error: SQLITE_CANTOPEN: unable to open database file" >&2; exit 1 ;;
      esac
      [ -f "$MOCK_MARK" ] && exit 0
      printf '%s\n' "Error: The module '/x/better_sqlite3.node'" "was compiled against a different Node.js version using" \
        "NODE_MODULE_VERSION 127. This version of Node.js requires" "NODE_MODULE_VERSION 141. Please try re-compiling" >&2
      exit 1 ;;
esac
SH
cat >"$T/bin/pnpm" <<'SH'
#!/bin/sh
echo "$*" >>"$MOCK_PNPM_LOG"
case "$*" in *"rebuild better-sqlite3"*) : >"$MOCK_MARK" ;; esac
SH
chmod +x "$T/bin/node" "$T/bin/pnpm"
export PATH="$T/bin:$PATH" MOCK_MARK="$T/rebuilt" MOCK_PNPM_LOG="$T/pnpm.log"
fail() { echo "ASSERT FAIL: $*" >&2; exit 1; }
run() { rc=0; out=$(heybe_node_check "$T/repo" "$1" 2>&1 </dev/null) || rc=$?; }

run 0
[ "$rc" = 1 ] || fail "ABI 不匹配 + 非交互 + 无 --yes 应返回 1（实际 ${rc}）"
case "$out" in *"编译时是 NODE_MODULE_VERSION 127，当前 node 需要 NODE_MODULE_VERSION 141"*) ;; *) fail "缺 ABI 说明：$out" ;; esac
case "$out" in *"仓库固定 Node 22"*) ;; *) fail "缺 Node 版本提示：$out" ;; esac
case "$out" in *"--yes"*) ;; *) fail "缺 --yes 提示：$out" ;; esac
[ ! -e "$MOCK_PNPM_LOG" ] || fail "没加 --yes 不应自动重建"

run 1
[ "$rc" = 0 ] || fail "--yes 应重建后返回 0（实际 ${rc}）：$out"
grep -q -- "-r rebuild better-sqlite3" "$MOCK_PNPM_LOG" || fail "没执行 pnpm -r rebuild better-sqlite3"
case "$out" in *"已按 node v26.1.0 重新编译"*) ;; *) fail "缺重建成功提示：$out" ;; esac

rm -f "$MOCK_MARK" "$MOCK_PNPM_LOG"
MOCK_NODE_MODE=other run 1
[ "$rc" = 1 ] || fail "非版本问题应返回 1"
[ ! -e "$MOCK_PNPM_LOG" ] || fail "非版本问题不应重建"

MOCK_NODE_MODE=ok run 0
[ "$rc" = 0 ] || fail "能加载时应返回 0"
echo "node-check mock test: PASS"
