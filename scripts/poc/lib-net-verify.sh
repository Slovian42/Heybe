# shellcheck shell=bash
# boxlite-poc.sh 验证 3（沙箱出网）用的命令和判定，单独放这里方便干跑测试（net-verify-mock-test.sh）。
# 兼容 macOS 自带 bash 3.2。只被 source，不单独执行。
#
# NET_PROBE_CMD 交给沙箱里的 sh 原样执行（模型经 exec 工具跑），每项输出一行 标记=结果：
#   CURL       镜像里有没有 curl（没有就无法判定，不能当成“被拦截”）
#   EXT        外网 https://example.com
#   HOST8100   宿主机 BoxLite serve：host.boxlite.internal:8100（BoxLite 给沙箱的宿主机名）
#   HOST11434  宿主机回环服务：192.168.127.254:11434（BoxLite 网关地址；11434 是 Ollama 默认端口，代表宿主上的本地服务）
#   DNS        解析 example.com（禁出网时 DNS 也应失败，否则可经 DNS 外带数据）
# curl 不带 -f：只要建立了连接（任何 HTTP 状态）就退出 0 → OPEN；连不上/超时/解析失败才 NET_BLOCKED。
# shellcheck disable=SC2016,SC2034  # 要原样交给沙箱里的 shell 展开；由 boxlite-poc.sh 使用
NET_PROBE_CMD='echo CURL=$(command -v curl >/dev/null 2>&1 && echo yes || echo no); curl -sS -m 8 -o /dev/null https://example.com >/dev/null 2>&1 && echo EXT=OPEN || echo EXT=NET_BLOCKED; curl -sS -m 5 -o /dev/null http://host.boxlite.internal:8100/v1/config >/dev/null 2>&1 && echo HOST8100=OPEN || echo HOST8100=NET_BLOCKED; curl -sS -m 5 -o /dev/null http://192.168.127.254:11434/ >/dev/null 2>&1 && echo HOST11434=OPEN || echo HOST11434=NET_BLOCKED; (getent hosts example.com || nslookup example.com) >/dev/null 2>&1 && echo DNS=RESOLVED || echo DNS=NET_BLOCKED'
NET_PROBE_ITEMS="EXT HOST8100 HOST11434 DNS"

# net_marker <文本> <标记> → 打印该标记第一次出现的值（没有则空）
net_marker() { printf '%s\n' "$1" | sed -n "s/.*$2=\([A-Z_a-z]*\).*/\1/p" | head -1; }

# net_verdict <模型回复原文> → 打印一行结论；全部 NET_BLOCKED 才返回 0
#   每一项都必须明确是 NET_BLOCKED：缺标记（模型没跑/没原样回）或 OPEN/RESOLVED 都算失败。
net_verdict() {
  local out=$1 c v bad="" miss=""
  c=$(net_marker "$out" CURL)
  if [ "$c" != yes ]; then echo "无法判定：沙箱里没有 curl 或回复里缺 CURL=yes（CURL=${c:-缺失}）"; return 1; fi
  for v in $NET_PROBE_ITEMS; do
    case "$(net_marker "$out" "$v")" in
      NET_BLOCKED) ;;
      "") miss="${miss:+$miss,}$v" ;;
      *) bad="${bad:+$bad,}$v=$(net_marker "$out" "$v")" ;;
    esac
  done
  if [ -n "$bad" ]; then echo "出网未被拦截：${bad}${miss:+；缺标记：$miss}"; return 1; fi
  if [ -n "$miss" ]; then echo "回复里缺标记 ${miss}（模型没执行或没原样回复，不能当成已拦截）"; return 1; fi
  echo "EXT/HOST8100/HOST11434/DNS 全部 NET_BLOCKED"
}
