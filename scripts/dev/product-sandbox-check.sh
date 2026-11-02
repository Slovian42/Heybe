#!/usr/bin/env bash
# 产品沙箱自检（#90 Mac 复验）：桌面版用 scripts/dev/heybe-desktop-dev.sh --sandbox boxlite 起来以后，另开一个终端跑。
# 只打印计数和 PASS/FAIL，不打印任何密钥（密钥只在子进程环境变量里，不进 argv）。全部 PASS 才返回 0。
#   1 serve、代理不带 key 都返回 401
#   2 本地服务进程树只监听 127.0.0.1
#   3 代理强制 outbound=disabled（sandbox.log：启动行 1 条，建箱 POST 全部 outbound=disabled）
#   4 gateway 部署模式 hosted（进程环境 FASTCLAW_DEPLOY=hosted；service-state.json deploy=hosted）
#   5 gateway 环境里没有 FASTCLAW_ALLOW_HOST_EXEC
#   6 camoufox-cli 读回 false（fastclaw agents config <agent> get skills.entries.camoufox-cli.enabled）
#   7 一次 /v1 对话让 exec 在沙箱里跑出网探测：外网、宿主机端口（serve 端口和 11434）、DNS 全部 NET_BLOCKED，且工具事件里有 exec
#   8 所有进程 argv 里的密钥命中数为 0
# 环境变量：HEYBE_T021_HOME（默认 ~/.local/opt/heybe-t021）、HEYBE_SERVICE_STATE_DIR（默认 $HEYBE_T021_HOME/service-state）、
#   HEYBE_FASTCLAW_BIN、HEYBE_CHECK_AGENT（默认 heybe-t021，也可写 agt_…）、HEYBE_CHECK_SKIP_CHAT=1 跳过第 7 项（记 FAIL）。
# 兼容 macOS 自带 bash 3.2。
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../poc/lib-fc-env.sh
. "$REPO_ROOT/scripts/poc/lib-fc-env.sh"
# shellcheck source=../poc/lib-fc-agent.sh
. "$REPO_ROOT/scripts/poc/lib-fc-agent.sh"
# shellcheck source=../poc/lib-net-verify.sh
. "$REPO_ROOT/scripts/poc/lib-net-verify.sh"
PROBE="$REPO_ROOT/scripts/dev/product-sandbox-probe.py"
T021_HOME="${HEYBE_T021_HOME:-$HOME/.local/opt/heybe-t021}"
STATE_DIR="${HEYBE_SERVICE_STATE_DIR:-$T021_HOME/service-state}"
FC_HOME="${T021_HOME}/fastclaw-home"
FC_BIN="${HEYBE_FASTCLAW_BIN:-$HOME/.local/opt/fastclaw/bin/fastclaw}"
KEY_FILE="${T021_HOME}/fastclaw-apikey"
AGENT_REQ="${HEYBE_CHECK_AGENT:-heybe-t021}"
LOG_DIR="${HEYBE_CHECK_LOG_DIR:-$STATE_DIR}"

NPASS=0 NFAIL=0 TOTAL=8
pass() { NPASS=$((NPASS + 1)); printf 'PASS %s/%s %s\n' "$1" "$TOTAL" "$2"; }
fail() { NFAIL=$((NFAIL + 1)); printf 'FAIL %s/%s %s\n' "$1" "$TOTAL" "$2"; }
finish() { echo "汇总：PASS ${NPASS} / FAIL ${NFAIL}（共 ${TOTAL} 项）"; [ "$NFAIL" = 0 ] && [ "$NPASS" = "$TOTAL" ]; exit $?; }
json_get() { python3 -c 'import json,sys;v=json.load(open(sys.argv[1])).get(sys.argv[2]);print("" if v is None else v)' "$STATE_DIR/service-state.json" "$1" 2>/dev/null; }
http_code() { curl -s -o /dev/null -m 5 -w '%{http_code}' "$1" 2>/dev/null || true; }

# ---- 0 状态文件（只有 pid/端口/模式）
PID="$(tr -dc '0-9' <"$STATE_DIR/task-manager.pid" 2>/dev/null)"
if [ -z "$PID" ] || [ ! -s "$STATE_DIR/service-state.json" ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "FAIL 0/${TOTAL} 找不到在跑的本地服务（${STATE_DIR} 里没有 task-manager.pid / service-state.json，或进程已退出）。先用 scripts/dev/heybe-desktop-dev.sh --sandbox boxlite 启动桌面版"
  NFAIL=$TOTAL; finish
fi
SANDBOX="$(json_get sandbox)" DEPLOY="$(json_get deploy)"
GW="$(json_get gateway_port)" SERVE="$(json_get serve_port)" PROXY="$(json_get proxy_port)" SVC="$(json_get service_port)"
echo "本地服务 pid ${PID}：沙箱=${SANDBOX:-?} 部署模式=${DEPLOY:-?} 端口 服务=${SVC:-?} gateway=${GW:-?} 代理=${PROXY:-?} serve=${SERVE:-?}"
if [ "$SANDBOX" != boxlite ] || [ -z "$GW" ] || [ -z "$SERVE" ] || [ -z "$PROXY" ]; then
  echo "FAIL 0/${TOTAL} 本地服务没有用 BoxLite 沙箱（sandbox=${SANDBOX:-?}）。退出 Heybe 后用 scripts/dev/heybe-desktop-dev.sh --sandbox boxlite 重新启动"
  NFAIL=$TOTAL; finish
fi

# ---- 1 不带 key → 401
c1="$(http_code "http://127.0.0.1:${SERVE}/v1/config")" c2="$(http_code "http://127.0.0.1:${PROXY}/v1/config")"
if [ "$c1" = 401 ] && [ "$c2" = 401 ]; then pass 1 "serve、代理不带 key 都返回 401（serve ${c1}，代理 ${c2}）"
else fail 1 "不带 key 应返回 401：serve ${c1:-无响应}，代理 ${c2:-无响应}"; fi

# ---- 2 只监听 127.0.0.1
LISTEN="$(python3 "$PROBE" listen "$PID")"
n_all=$(printf '%s\n' "$LISTEN" | awk 'NF==3' | wc -l | tr -d ' ')
n_bad=$(printf '%s\n' "$LISTEN" | awk 'NF==3 && $2 != "127.0.0.1"' | wc -l | tr -d ' ')
n_want=0
for p in $SVC $GW $PROXY $SERVE; do
  printf '%s\n' "$LISTEN" | awk -v p="$p" 'NF==3 && $3 == p { f=1 } END { exit !f }' && n_want=$((n_want + 1))
done
if [ "$n_all" -gt 0 ] && [ "$n_bad" = 0 ] && [ "$n_want" = 4 ]; then pass 2 "进程树 ${n_all} 个监听端口全部在 127.0.0.1（服务/gateway/代理/serve 4/4 在列）"
else fail 2 "监听端口 ${n_all} 个，其中不在 127.0.0.1 的 ${n_bad} 个；服务/gateway/代理/serve 找到 ${n_want}/4（需要 lsof 或 ss）"; fi

# ---- 4/5 gateway 进程环境（值不打印）
GW_PID=$(printf '%s\n' "$LISTEN" | awk -v p="$GW" 'NF==3 && $3 == p { print $1; exit }')
ENVC=""; [ -n "$GW_PID" ] && ENVC="$(python3 "$PROBE" envcheck "$GW_PID")"

# ---- 6 camoufox 读回（先做：不依赖对话）
AGENT=""
if [ -s "$KEY_FILE" ]; then
  AGENT=$(FASTCLAW_API_KEY="$(cat "$KEY_FILE")" FASTCLAW_HOME="$FC_HOME" fc_resolve_agent_id "$GW" "$AGENT_REQ" "$FC_BIN" 2>/dev/null) || AGENT=""
fi
CAMO=""; [ -n "$AGENT" ] && CAMO="$(FASTCLAW_HOME="$FC_HOME" fc_camoufox_get "$FC_BIN" "$AGENT" | head -1)"

# ---- 7 /v1 对话：exec 在沙箱里跑出网探测（宿主机端口换成本次 serve 端口）
probe="${NET_PROBE_CMD//:8100\//:${SERVE}\/}"
CHAT_OUT="$LOG_DIR/product-check-chat.txt" CHAT_TOOLS="$LOG_DIR/product-check-tools.txt"
chat_rc=1
if [ "${HEYBE_CHECK_SKIP_CHAT:-0}" != 1 ] && [ -n "$AGENT" ]; then
  : >"$CHAT_OUT"; : >"$CHAT_TOOLS"
  FASTCLAW_API_KEY="$(cat "$KEY_FILE")" python3 - "$GW" "$AGENT" "Use the exec tool to run exactly this shell command: ${probe} . Reply with the raw tool output only." "$CHAT_OUT" "$CHAT_TOOLS" <<'PY'
import sys,os,json,urllib.request
port,agent,prompt,out_f,tools_f=sys.argv[1:]
body=json.dumps({"model":agent,"agent_id":agent,"stream":True,"messages":[{"role":"user","content":prompt}]}).encode()
req=urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions",data=body,
    headers={"Content-Type":"application/json","Authorization":"Bearer "+os.environ["FASTCLAW_API_KEY"],"x-fastclaw-agent-id":agent})
out=[];tools=[]
with urllib.request.urlopen(req,timeout=600) as r:
    for line in r:
        line=line.decode(errors="replace").strip()
        if not line.startswith("data:"): continue
        d=line[5:].strip()
        if d=="[DONE]": break
        try: j=json.loads(d)
        except Exception: continue
        t=j.get("tool")
        if isinstance(t,dict): tools.append(f"{t.get('name','')} {t.get('status','')}")
        for c in j.get("choices") or []:
            out.append((c.get("delta") or {}).get("content") or "")
open(out_f,"w").write("".join(out)); open(tools_f,"w").write("\n".join(tools)+("\n" if tools else ""))
PY
  chat_rc=$?
fi

# ---- 3 代理日志（对话之后看，建箱 POST 应该都有 outbound=disabled）
SLOG="$STATE_DIR/sandbox.log"
n_listen=$(grep -c 'outbound network forced to disabled' "$SLOG" 2>/dev/null); n_listen=${n_listen:-0}
# 「refused …」是代理拒掉的请求（没转发），单独计数，不算建箱
n_ref=$(grep -c 'refused ' "$SLOG" 2>/dev/null); n_ref=${n_ref:-0}
n_post=$(grep 'POST ' "$SLOG" 2>/dev/null | grep -vc 'refused '); n_post=${n_post:-0}
n_dis=$(grep 'POST ' "$SLOG" 2>/dev/null | grep -v 'refused ' | grep -c 'outbound=disabled'); n_dis=${n_dis:-0}
if [ "$n_listen" -ge 1 ] && [ "$n_post" -ge 1 ] && [ "$n_post" = "$n_dis" ]; then pass 3 "代理强制禁出网：启动行 ${n_listen} 条，建箱 POST ${n_post} 条全部 outbound=disabled，拒绝 ${n_ref} 条"
else fail 3 "代理日志：启动行 ${n_listen} 条，建箱 POST ${n_post} 条，其中 outbound=disabled ${n_dis} 条（${SLOG}）"; fi

case "$ENVC" in
  *deploy=hosted*) if [ "$DEPLOY" = hosted ]; then pass 4 "部署模式 hosted（gateway pid ${GW_PID} 环境 + service-state.json）"
                   else fail 4 "gateway 环境是 hosted，但 service-state.json deploy=${DEPLOY}"; fi ;;
  "") fail 4 "找不到监听 gateway 端口 ${GW} 的进程，读不到部署模式" ;;
  *) fail 4 "gateway 部署模式不是 hosted（$(printf '%s' "$ENVC" | cut -d' ' -f1)）" ;;
esac
case "$ENVC" in
  *allow_host_exec=0*) pass 5 "gateway 环境里没有 FASTCLAW_ALLOW_HOST_EXEC" ;;
  "") fail 5 "读不到 gateway 环境" ;;
  *) fail 5 "gateway 环境里有 FASTCLAW_ALLOW_HOST_EXEC" ;;
esac

if [ -z "$AGENT" ]; then fail 6 "查不到 Agent ${AGENT_REQ} 的 id（${KEY_FILE} 不在或 /v1/agents 没查到）"
elif [ "$CAMO" = false ]; then pass 6 "camoufox-cli 读回 false（Agent ${AGENT}）"
else fail 6 "camoufox-cli 读回「${CAMO:-空}」，应为 false（Agent ${AGENT}）"; fi

if [ "${HEYBE_CHECK_SKIP_CHAT:-0}" = 1 ]; then fail 7 "跳过了 /v1 对话（HEYBE_CHECK_SKIP_CHAT=1）"
elif [ -z "$AGENT" ]; then fail 7 "没有 Agent id，没法对话"
elif [ "$chat_rc" != 0 ]; then fail 7 "/v1 对话失败（rc ${chat_rc}）"
else
  n_exec=$(grep -c '^exec ' "$CHAT_TOOLS" 2>/dev/null); n_exec=${n_exec:-0}
  why="$(net_verdict "$(cat "$CHAT_OUT")")"; v=$?
  if [ "$v" = 0 ] && [ "$n_exec" -ge 1 ]; then pass 7 "exec 在沙箱里跑了（工具事件 ${n_exec} 条）：外网、宿主机 ${SERVE}/11434、DNS 全部 NET_BLOCKED"
  elif [ "$n_exec" -lt 1 ]; then fail 7 "工具事件里没有 exec（模型没执行），不能判定；回复 ${CHAT_OUT}"
  else fail 7 "${why}（回复 ${CHAT_OUT}）"; fi
fi

# ---- 8 argv 密钥
DEEPSEEK_API_KEY=""
if [ -r "${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}" ]; then
  DEEPSEEK_API_KEY="$(sed -n 's/^DEEPSEEK_API_KEY=//p' "${HEYBE_POC_ENV:-$HOME/.heybe-poc.env}" | head -1 | tr -d '\r\n"'"'")"
fi
FC_APIKEY=""; [ -s "$KEY_FILE" ] && FC_APIKEY="$(cat "$KEY_FILE")"
SCAN="$(DEEPSEEK_API_KEY="$DEEPSEEK_API_KEY" FC_APIKEY="$FC_APIKEY" HEYBE_CHECK_SECRET_VARS="DEEPSEEK_API_KEY FC_APIKEY" python3 "$PROBE" argvscan "$PID")"
DEEPSEEK_API_KEY="" FC_APIKEY=""
k=$(printf '%s' "$SCAN" | sed -n 's/.*known=\([0-9]*\).*/\1/p') pt=$(printf '%s' "$SCAN" | sed -n 's/.*pattern=\([0-9]*\).*/\1/p')
np=$(printf '%s' "$SCAN" | sed -n 's/.*procs=\([0-9]*\).*/\1/p') ns=$(printf '%s' "$SCAN" | sed -n 's/.*secrets=\([0-9]*\).*/\1/p')
if [ "${k:-x}" = 0 ] && [ "${pt:-x}" = 0 ] && [ "${ns:-0}" -ge 1 ]; then pass 8 "ps argv 密钥命中 0（${np} 个进程比对 ${ns} 个已知密钥值；本服务进程树按模式 0）"
else fail 8 "ps argv 密钥命中：已知值 ${k:-?}，本服务进程树按模式 ${pt:-?}（${np:-?} 个进程，${ns:-0} 个已知密钥值）"; fi

finish
