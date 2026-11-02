#!/usr/bin/env bash
# mirror-mock-test.sh — scripts/lib-mirror.sh 的 mock 测试（假 docker，不联网）
#   默认关闭 / --mirror cn 默认值 / 环境变量覆盖 / off / 非法值；cargo --config 参数；
#   docker 经镜像拉取 + tag、镜像失败回退、已有镜像跳过；不写 ~/.cargo、不碰 daemon 配置
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAILN=0
ok()  { PASS=$((PASS + 1)); echo "  ✓ $*"; }
bad() { FAILN=$((FAILN + 1)); echo "  ✗ $*"; }
eq()  { if [ "$1" = "$2" ]; then ok "$3"; else bad "$3（期望 [$2]，得到 [$1]）"; fi; }

T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export HOME="$T/home"; mkdir -p "$HOME" "$T/bin"
unset HEYBE_MIRROR HEYBE_CARGO_MIRROR HEYBE_DOCKER_MIRROR CARGO_REGISTRIES_CRATES_IO_PROTOCOL || true

# 每个场景在子 shell 里跑，互不影响；输出 "cargo|docker|参数个数|protocol"
probe() {
  ( set -euo pipefail
    # shellcheck source=lib-mirror.sh
    . "$HERE/lib-mirror.sh"
    heybe_mirror_setup "${1:-}" || exit $?
    echo "${HEYBE_CARGO_MIRROR}|${HEYBE_DOCKER_MIRROR}|${#HEYBE_CARGO_ARGS[@]}|${CARGO_REGISTRIES_CRATES_IO_PROTOCOL:-}" )
}

echo "== 1. 开关与默认值"
eq "$(probe)" "||0|" "默认关闭：不传 cargo 参数、不设 protocol"
eq "$(probe cn)" "sparse+https://rsproxy.cn/index/|docker.m.daocloud.io|4|sparse" "--mirror cn：rsproxy + daocloud，sparse"
eq "$(HEYBE_MIRROR=cn probe)" "sparse+https://rsproxy.cn/index/|docker.m.daocloud.io|4|sparse" "HEYBE_MIRROR=cn 等同 --mirror cn"
eq "$(HEYBE_CARGO_MIRROR=sparse+https://mirrors.example.com/crates.io-index/ HEYBE_DOCKER_MIRROR=https://hub.example.com/ probe cn)" \
   "sparse+https://mirrors.example.com/crates.io-index/|hub.example.com|4|sparse" "cn 下环境变量覆盖默认值（去掉 https:// 和末尾 /）"
eq "$(HEYBE_DOCKER_MIRROR=hub.example.com probe)" "|hub.example.com|0|" "只设 HEYBE_DOCKER_MIRROR：只开 docker"
eq "$(HEYBE_MIRROR=cn probe off)" "||0|" "--mirror off 覆盖 HEYBE_MIRROR=cn"
if probe xx >/dev/null 2>&1; then bad "非法模式应返回 2"; else eq "$?" 2 "非法模式返回 2"; fi
set +e; HEYBE_CARGO_MIRROR='https://x/ " y' probe >/dev/null 2>&1; rc=$?; set -e
eq "$rc" 2 "cargo 镜像地址带引号/空格被拒（防止拼坏 --config）"

echo "== 2. cargo 参数"
ARGS=$( . "$HERE/lib-mirror.sh"; heybe_mirror_setup cn; printf '%s\n' "${HEYBE_CARGO_ARGS[@]}" )
eq "$ARGS" '--config
source.crates-io.replace-with="heybe-mirror"
--config
source.heybe-mirror.registry="sparse+https://rsproxy.cn/index/"' "--config 替换 crates-io 源"
[ ! -e "$HOME/.cargo" ] && ok "没有创建/修改 ~/.cargo" || bad "$HOME/.cargo 被动过"

echo "== 3. docker 镜像名"
ref() { ( . "$HERE/lib-mirror.sh"; HEYBE_DOCKER_MIRROR=m.example; heybe_mirror_setup; heybe_docker_mirror_ref "$1" ) || true; }
eq "$(ref thinkany/fastclaw-sandbox:latest)" "m.example/thinkany/fastclaw-sandbox:latest" "Docker Hub 用户镜像加前缀"
eq "$(ref alpine:3)" "m.example/library/alpine:3" "官方镜像补 library/"
eq "$(ref docker.io/thinkany/x:1)" "m.example/thinkany/x:1" "去掉 docker.io/"
eq "$(ref ghcr.io/a/b:1)" "ghcr.io/a/b:1" "非 Docker Hub 镜像原样"

echo "== 4. docker pull（假 docker）"
cat >"$T/bin/docker" <<'D'
#!/bin/sh
echo "$*" >>"$DOCKER_LOG"
case "$1" in
  image) exit "${HAVE_IMAGE:-1}" ;;
  pull) case "$2" in m.example/*) exit "${MIRROR_FAIL:-0}" ;; *) exit 0 ;; esac ;;
  *) exit 0 ;;
esac
D
chmod +x "$T/bin/docker"
pull() { : >"$T/log"; ( export PATH="$T/bin:$PATH" DOCKER_LOG="$T/log"; . "$HERE/lib-mirror.sh"
  heybe_mirror_setup; heybe_docker_pull thinkany/fastclaw-sandbox:latest ) 2>/dev/null; tr '\n' ';' <"$T/log"; }
eq "$(HEYBE_DOCKER_MIRROR=m.example pull)" "image inspect thinkany/fastclaw-sandbox:latest;pull m.example/thinkany/fastclaw-sandbox:latest;tag m.example/thinkany/fastclaw-sandbox:latest thinkany/fastclaw-sandbox:latest;rmi m.example/thinkany/fastclaw-sandbox:latest;" "经镜像拉取后 tag 回原名"
eq "$(HEYBE_DOCKER_MIRROR=m.example MIRROR_FAIL=1 pull)" "image inspect thinkany/fastclaw-sandbox:latest;pull m.example/thinkany/fastclaw-sandbox:latest;pull thinkany/fastclaw-sandbox:latest;" "镜像失败回退直接拉"
eq "$(pull)" "image inspect thinkany/fastclaw-sandbox:latest;pull thinkany/fastclaw-sandbox:latest;" "未配镜像直接拉"
eq "$(HEYBE_DOCKER_MIRROR=m.example HAVE_IMAGE=0 pull)" "image inspect thinkany/fastclaw-sandbox:latest;" "已有镜像不拉"
H=$( . "$HERE/lib-mirror.sh"; heybe_mirror_setup cn; heybe_docker_mirror_hint 2>&1 )
case $H in *'"registry-mirrors": ["https://docker.m.daocloud.io"]'*) ok "daemon 设置只打印说明" ;; *) bad "提示里缺 registry-mirrors" ;; esac
if grep -n 'daemon.json' "$HERE/lib-mirror.sh" | grep -v -E '^\s*[0-9]+:\s*#|sudo vi' >/dev/null; then bad "lib 里有写 daemon.json 的代码"; else ok "lib 不写 daemon.json"; fi

echo "== 结果：${PASS} 通过 / ${FAILN} 失败"
[ "$FAILN" -eq 0 ]
