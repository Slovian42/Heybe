# shellcheck shell=bash
# lib-mirror.sh — 可选国内镜像（默认关闭，只作用于本次运行）。由 heybe-desktop-dev.sh、boxlite-poc.sh source。
#
# 开启：--mirror cn 或 HEYBE_MIRROR=cn（两者都没有 = 不用镜像）
#   HEYBE_CARGO_MIRROR   crates.io 的替代索引，cn 默认 sparse+https://rsproxy.cn/index/
#   HEYBE_DOCKER_MIRROR  Docker Hub 拉取前缀，cn 默认 docker.m.daocloud.io
#   两个变量也可以单独设置（不写 --mirror），或在 cn 下覆盖默认值；HEYBE_MIRROR=off 关掉 cn 默认值。
# 不改任何全局配置：
#   Cargo   只给这次的 cargo 传 --config（source 替换），并在本进程里 export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse；
#           不碰 ~/.cargo/config(.toml)
#   Docker  先拉 <镜像前缀>/<仓库>:<tag>，再 docker tag 成原名；失败就回退直接拉。不改 daemon 配置，
#           需要长期生效时只打印 registry-mirrors 的设置方法（heybe_docker_mirror_hint）
# 兼容 macOS bash 3.2：没有关联数组；空数组展开用 ${A[@]+"${A[@]}"}。

HEYBE_MIRROR_CN_CARGO_DEFAULT="sparse+https://rsproxy.cn/index/"
HEYBE_MIRROR_CN_DOCKER_DEFAULT="docker.m.daocloud.io"
# shellcheck disable=SC2034  # 给 source 本文件的脚本用
HEYBE_CARGO_ARGS=()

_hm_say() { printf '  %s\n' "$*" >&2; }

# heybe_mirror_setup [模式]：模式取参数，否则取 HEYBE_MIRROR；cn | off | 空。非法值返回 2。
# 结果：HEYBE_CARGO_MIRROR / HEYBE_DOCKER_MIRROR（可能为空）、HEYBE_CARGO_ARGS 数组。
heybe_mirror_setup() {
  local mode="${1:-${HEYBE_MIRROR:-}}"
  case "$mode" in
    cn)
      HEYBE_CARGO_MIRROR="${HEYBE_CARGO_MIRROR:-$HEYBE_MIRROR_CN_CARGO_DEFAULT}"
      HEYBE_DOCKER_MIRROR="${HEYBE_DOCKER_MIRROR:-$HEYBE_MIRROR_CN_DOCKER_DEFAULT}" ;;
    ""|off|none|0)
      if [ "$mode" != "" ]; then HEYBE_CARGO_MIRROR=""; HEYBE_DOCKER_MIRROR=""; fi ;;
    *) _hm_say "✗ --mirror / HEYBE_MIRROR 只支持 cn 或 off（收到：${mode}）"; return 2 ;;
  esac
  HEYBE_CARGO_MIRROR="${HEYBE_CARGO_MIRROR:-}"
  HEYBE_DOCKER_MIRROR="${HEYBE_DOCKER_MIRROR:-}"
  HEYBE_DOCKER_MIRROR="${HEYBE_DOCKER_MIRROR#https://}"; HEYBE_DOCKER_MIRROR="${HEYBE_DOCKER_MIRROR#http://}"
  HEYBE_DOCKER_MIRROR="${HEYBE_DOCKER_MIRROR%/}"
  HEYBE_CARGO_ARGS=()
  if [ -n "$HEYBE_CARGO_MIRROR" ]; then
    case "$HEYBE_CARGO_MIRROR" in
      *[[:space:]\"\'\\]*) _hm_say "✗ HEYBE_CARGO_MIRROR 不能含空格、引号或反斜杠"; return 2 ;;
      sparse+http*|http*|git*) ;;
      *) _hm_say "✗ HEYBE_CARGO_MIRROR 要以 sparse+https:// 或 https:// 开头（收到：${HEYBE_CARGO_MIRROR}）"; return 2 ;;
    esac
    # shellcheck disable=SC2034
    HEYBE_CARGO_ARGS=(--config 'source.crates-io.replace-with="heybe-mirror"'
                      --config "source.heybe-mirror.registry=\"${HEYBE_CARGO_MIRROR}\"")
    export CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse
  fi
  case "$HEYBE_DOCKER_MIRROR" in
    *[[:space:]\"\'\\]*) _hm_say "✗ HEYBE_DOCKER_MIRROR 不能含空格、引号或反斜杠"; return 2 ;;
  esac
  return 0
}

# heybe_mirror_summary：一行说明当前用了哪些镜像（不含任何密钥）
heybe_mirror_summary() {
  if [ -z "$HEYBE_CARGO_MIRROR" ] && [ -z "$HEYBE_DOCKER_MIRROR" ]; then echo "镜像：未启用（官方源）"; return; fi
  echo "镜像（仅本次运行）：cargo=${HEYBE_CARGO_MIRROR:-官方} docker=${HEYBE_DOCKER_MIRROR:-官方}"
}

# heybe_docker_mirror_ref <镜像>：Docker Hub 镜像 → 镜像前缀下的名字；不是 Docker Hub 的（带域名）原样输出并返回 1
heybe_docker_mirror_ref() {
  local img="$1" first
  [ -n "$HEYBE_DOCKER_MIRROR" ] || { echo "$img"; return 1; }
  first="${img%%/*}"
  if [ "$first" != "$img" ]; then
    case "$first" in
      docker.io|index.docker.io|registry-1.docker.io) img="${img#*/}" ;;
      *.*|*:*|localhost) echo "$img"; return 1 ;;
    esac
  fi
  case "$img" in */*) ;; *) img="library/${img}" ;; esac
  echo "${HEYBE_DOCKER_MIRROR}/${img}"
}

# heybe_docker_pull <镜像>：已有就跳过；配了镜像先从镜像拉再 tag 回原名，失败回退直接拉
heybe_docker_pull() {
  local img="$1" via
  docker image inspect "$img" >/dev/null 2>&1 && return 0
  if via=$(heybe_docker_mirror_ref "$img"); then
    _hm_say "• 经镜像拉取：${via}（之后 docker tag 成 ${img}）"
    if docker pull "$via" && docker tag "$via" "$img"; then
      docker rmi "$via" >/dev/null 2>&1 || true   # 只去掉镜像前缀那个别名，镜像本身保留在原名下
      return 0
    fi
    _hm_say "• 镜像拉取失败，改为直接拉 ${img}"
  fi
  docker pull "$img"
}

# heybe_docker_mirror_hint：想让所有 docker pull 都走镜像时的做法（只打印，不改配置）
heybe_docker_mirror_hint() {
  local m="${HEYBE_DOCKER_MIRROR:-$HEYBE_MIRROR_CN_DOCKER_DEFAULT}"
  cat >&2 <<HINT
  想让所有 docker pull 都走镜像，需要你自己改 daemon 配置（脚本不会自动改）：
    Docker Desktop：Settings → Docker Engine，加 "registry-mirrors": ["https://${m}"]，Apply & Restart
    Lima 虚拟机：limactl shell <实例> sudo vi /etc/docker/daemon.json 写同样一行，再 sudo systemctl restart docker
HINT
}
