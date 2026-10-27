#!/usr/bin/env bash
# FastClaw v1.4.0 运行时核验（Linux / macOS 均可），一条命令跑完并自动清理。
# 用法: scripts/poc/fastclaw-lab.sh [runtime]
#   runtime（默认）  #8 T0.4.1：指定 Agent、两会话隔离、流式、工具事件、文件取回、model 字段是否覆盖 Agent 配置、
#                    会话文件 / MEMORY.md 跨会话风险复现
# 每次运行：mktemp 独立 FASTCLAW_HOME → agents init(DeepSeek) → 临时 apikey（只写 600 文件）
#          → 跑用例 → 停 gateway、删 apikey、删整个临时目录（KEEP=1 时保留目录供排查，但仍删 apikey）。
# 密钥：DEEPSEEK_API_KEY 只从 ${HEYBE_LAB_ENV_FILE}（必须 600）读取，传给 FastClaw 进程；
#       脚本不打印、不写报告。FastClaw apikey 只在临时目录的 600 文件里，用 curl -H @file 发送。
# 报告：stdout 的 "LAB <id> PASS|FAIL|INFO|RISK ..." 行（RISK = 复现已知风险，不计失败），最后一行 "LAB RESULT: PASS|FAIL"。可直接贴进文档。
# 结果依赖模型行为（让它调工具 / 复述暗号），单次 FAIL 先看详情再判断是否重跑。
set -euo pipefail
umask 077

FASTCLAW_VERSION="1.4.0"
HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${HEYBE_LAB_ENV_FILE:?请设置 HEYBE_LAB_ENV_FILE 指向含 DEEPSEEK_API_KEY= 的 600 文件}"
PORT="${HEYBE_LAB_PORT:-18983}"
MODEL="${HEYBE_LAB_MODEL:-deepseek/deepseek-v4-flash}"
SUITE="${1:-runtime}"
BASE="http://127.0.0.1:${PORT}"

LAB="$(mktemp -d "${TMPDIR:-/tmp}/heybe-fastclaw-lab.XXXXXX")"
chmod 700 "${LAB}"
export FASTCLAW_HOME="${LAB}/home" FASTCLAW_PORT="${PORT}" FASTCLAW_BIND=loopback
mkdir -p "${FASTCLAW_HOME}"
GW_LOG="${LAB}/gateway.log"
FAILS=0
KEY_IDS=()
AGENT_ID=""

say() { printf 'LAB %s\n' "$*"; }
pass() { say "$1 PASS $2"; }
fail() { say "$1 FAIL $2"; FAILS=$((FAILS + 1)); }
info() { say "$1 INFO $2"; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }
rand() { node -e 'console.log(require("crypto").randomBytes(4).toString("hex").toUpperCase())'; }
summ() { node "${HERE}/fastclaw-lab-sse.mjs" "$1"; }
jget() { node -e 'const o=JSON.parse(process.argv[1]);const v=process.argv[2].split(".").reduce((a,k)=>a==null?a:a[k],o);console.log(typeof v==="object"?JSON.stringify(v):String(v).replace(/\s+/g," "))' "$1" "$2"; }

gw_pid() { cat "${LAB}/gw.pid" 2>/dev/null || true; }
start_gateway() {
  (
    set -a
    # shellcheck disable=SC1090
    . "${ENV_FILE}"
    set +a
    nohup fastclaw gateway --port "${PORT}" >>"${GW_LOG}" 2>&1 &
    echo $! >"${LAB}/gw.pid"
  )
  local i
  for i in $(seq 1 60); do
    kill -0 "$(gw_pid)" 2>/dev/null || { echo "gateway 进程启动后退出（端口被占？）" >&2; return 1; }
    curl -s -o /dev/null -m 1 "${BASE}/healthz" && return 0
    sleep 0.5
  done
  echo "gateway 30 秒内没起来" >&2
  return 1
}
stop_gateway() { # [signal]
  local pid; pid="$(gw_pid)"
  [ -n "$pid" ] || return 0
  kill "-${1:-TERM}" "$pid" 2>/dev/null || true
  local i; for i in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  kill -9 "$pid" 2>/dev/null || true
  rm -f "${LAB}/gw.pid"
}

# `fastclaw agents init` 在 gateway 没运行时会自动拉起 `fastclaw daemon __run`（崩溃自动重启的守护进程）。
# 实验要自己控制 gateway 进程，所以 init 之后立刻停掉它；清理时再按 FASTCLAW_HOME 兜底杀一遍（Linux /proc）。
stop_daemon() {
  fastclaw daemon stop >/dev/null 2>&1 || true
  [ -d /proc ] || return 0
  local p
  for p in $(pgrep -f 'fastclaw (daemon __run|gateway)' 2>/dev/null || true); do
    tr '\0' '\n' <"/proc/$p/environ" 2>/dev/null | grep -qx "FASTCLAW_HOME=${FASTCLAW_HOME}" && kill -9 "$p" 2>/dev/null
  done
  return 0
}

cleanup() {
  set +e
  stop_gateway
  local id
  for id in "${KEY_IDS[@]:-}"; do [ -n "$id" ] && fastclaw apikey delete --id "$id" >/dev/null 2>&1; done
  stop_daemon
  if [ "${KEEP:-0}" = 1 ]; then rm -f "${LAB}"/key-* "${LAB}"/hdr-*; echo "保留目录 ${LAB}（apikey 已删）" >&2
  else rm -rf "${LAB}"; fi
}
trap cleanup EXIT

new_key() { # name → writes ${LAB}/hdr-<name>, records id
  local out id
  out="$(fastclaw apikey create --name "heybe-lab-$1" --type user 2>&1)"
  id="$(printf '%s' "$out" | sed -n 's/.*apikey id=\([^ ]*\).*/\1/p' | head -1)"
  [ -n "$id" ] && KEY_IDS+=("$id")
  printf 'Authorization: Bearer %s\n' "$(printf '%s' "$out" | sed -n 's/^token:[[:space:]]*//p' | head -1 | tr -d '\r\n')" >"${LAB}/hdr-$1"
  out=""
  chmod 600 "${LAB}/hdr-$1"
  grep -q 'Bearer fc_' "${LAB}/hdr-$1" || { echo "没能取到 apikey" >&2; return 1; }
}

chat() { # key session enduser|- prompt [model] → ${LAB}/<session>.sse
  local key=$1 session=$2 eu=$3 prompt=$4 model=${5:-} body args=()
  body="$(node -e 'const [a,p,m,eu]=process.argv.slice(1);const b={agent_id:a,stream:true,messages:[{role:"user",content:p}]};if(m)b.model=m;if(eu!=="-")b.user=eu;console.log(JSON.stringify(b))' "${AGENT_ID}" "$prompt" "$model" "$eu")"
  [ "$eu" != "-" ] && args+=(-H "X-Fastclaw-End-User: $eu")
  curl -sN -m "${HEYBE_LAB_CHAT_TIMEOUT:-240}" "${BASE}/v1/chat/completions" -H @"${LAB}/hdr-${key}" \
    -H 'Content-Type: application/json' -H "X-Fastclaw-Session-Key: ${session}" "${args[@]}" -d "$body" \
    >"${LAB}/${session//[:\/]/_}.sse" || true
  summ "${LAB}/${session//[:\/]/_}.sse"
}

setup() {
  command -v fastclaw >/dev/null || { echo "缺少 fastclaw" >&2; exit 2; }
  fastclaw version 2>/dev/null | grep -q "${FASTCLAW_VERSION}" || { echo "FastClaw 不是 v${FASTCLAW_VERSION}" >&2; exit 2; }
  [ -f "${ENV_FILE}" ] && [ "$(file_mode "${ENV_FILE}")" = 600 ] || { echo "${ENV_FILE} 不存在或权限不是 600" >&2; exit 2; }
  grep -q '^[[:space:]]*\(export[[:space:]]\+\)\?DEEPSEEK_API_KEY=.' "${ENV_FILE}" || { echo "${ENV_FILE} 里没有 DEEPSEEK_API_KEY" >&2; exit 2; }
  if curl -s -o /dev/null -m 1 "${BASE}/healthz"; then echo "端口 ${PORT} 已被占用（设 HEYBE_LAB_PORT）" >&2; exit 2; fi
  (
    set -a
    # shellcheck disable=SC1090
    . "${ENV_FILE}"
    set +a
    fastclaw agents init heybe-lab --provider deepseek --model "${MODEL}" --api-key-env DEEPSEEK_API_KEY >"${LAB}/init.log" 2>&1
  )
  AGENT_ID="$(sed -n 's/^Agent ID:[[:space:]]*//p' "${LAB}/init.log" | head -1)"
  rm -f "${LAB}/init.log" # 含自动生成的控制台密码
  [ -n "${AGENT_ID}" ] || { echo "agents init 失败" >&2; exit 2; }
  stop_daemon
  local i; for i in $(seq 1 40); do curl -s -o /dev/null -m 1 "${BASE}/healthz" || break; sleep 0.25; done
  start_gateway
  new_key chat
  info setup "fastclaw=$(fastclaw version | head -1 | tr ' ' '_') agent=heybe-lab model=${MODEL} home=mktemp port=${PORT}"
}

upstream_models_since() { # line-number → distinct upstream model= values after it
  tail -n "+$(($1 + 1))" "${GW_LOG}" | grep 'msg="openai request"' | sed -n 's/.* model=\([^ ]*\).*/\1/p' | sort -u | tr '\n' ' '
}

suite_runtime() {
  local code fcode s r tA tB tC url st body
  # R1 指定 Agent + 流式
  r="$(chat chat "lab:r1" eu-a "只回复 OK 两个字母，不要调用任何工具。")"
  if [ "$(jget "$r" done)" = true ] && [ "$(jget "$r" finish)" = stop ]; then pass R1 "指定 agent_id 流式完成：[DONE] finish_reason=stop chunks=$(jget "$r" chunks)"
  else fail R1 "流式未正常结束：$(jget "$r" done)/$(jget "$r" finish) error=$(jget "$r" error)"; fi

  # R2 两会话隔离（同一 end-user，不同 session key；以及同 session key、不同 end-user）
  code="HB$(rand)"
  chat chat "lab:iso-a" eu-a "测试暗号是 ${code}。请只在本对话里记住它，不要写入任何文件或长期记忆，不要调用工具。只回复 OK。" >/dev/null
  tA="$(jget "$(chat chat "lab:iso-a" eu-a "刚才的测试暗号是什么？只回复暗号本身，不知道就回复 不知道。不要调用工具。")" text)"
  tB="$(jget "$(chat chat "lab:iso-b" eu-a "刚才的测试暗号是什么？只回复暗号本身，不知道就回复 不知道。不要调用工具、不要读文件或记忆。")" text)"
  tC="$(jget "$(chat chat "lab:iso-a" eu-b "刚才的测试暗号是什么？只回复暗号本身，不知道就回复 不知道。不要调用工具、不要读文件或记忆。")" text)"
  if printf '%s' "$tA" | grep -q "$code"; then pass R2a "同会话能复述暗号"; else fail R2a "同会话没复述出暗号：${tA:0:80}"; fi
  if printf '%s' "$tB" | grep -q "$code"; then fail R2b "另一 session key 看到了暗号"; else pass R2b "另一 session key 看不到（回复：${tB:0:40}）"; fi
  if printf '%s' "$tC" | grep -q "$code"; then fail R2c "同 session key、不同 end-user 看到了暗号"; else pass R2c "同 session key、不同 end-user 看不到（回复：${tC:0:40}）"; fi

  # R2d 两个并发任务：同时跑两个会话，各写同名文件、各记各的暗号，再并发追问
  local cA cB fa fb
  cA="HA$(rand)"; cB="HB$(rand)"
  chat chat "lab:par-a" eu-a "测试暗号是 ${cA}。请调用 write_file 在当前会话工作区写 heybe-lab/par.txt，内容只有一行：${cA}。写完只回复 DONE。" >"${LAB}/par-a1.json" &
  chat chat "lab:par-b" eu-a "测试暗号是 ${cB}。请调用 write_file 在当前会话工作区写 heybe-lab/par.txt，内容只有一行：${cB}。写完只回复 DONE。" >"${LAB}/par-b1.json" &
  wait
  chat chat "lab:par-a" eu-a "本对话里的测试暗号是什么？只回复暗号本身，不要调用工具。" >"${LAB}/par-a2.json" &
  chat chat "lab:par-b" eu-a "本对话里的测试暗号是什么？只回复暗号本身，不要调用工具。" >"${LAB}/par-b2.json" &
  wait
  tA="$(jget "$(cat "${LAB}/par-a2.json")" text)"; tB="$(jget "$(cat "${LAB}/par-b2.json")" text)"
  if printf '%s' "$tA" | grep -q "$cA" && ! printf '%s' "$tA" | grep -q "$cB" && printf '%s' "$tB" | grep -q "$cB" && ! printf '%s' "$tB" | grep -q "$cA"; then
    pass R2d "两个并发会话各自只复述自己的暗号"
  else fail R2d "并发会话复述异常：A=${tA:0:40} B=${tB:0:40}"; fi
  fa="$(curl -s -m 20 -H @"${LAB}/hdr-chat" -H 'X-Fastclaw-End-User: eu-a' "${BASE}/v1/agents/${AGENT_ID}/sessions/lab:par-a/files/heybe-lab/par.txt")"
  fb="$(curl -s -m 20 -H @"${LAB}/hdr-chat" -H 'X-Fastclaw-End-User: eu-a' "${BASE}/v1/agents/${AGENT_ID}/sessions/lab:par-b/files/heybe-lab/par.txt")"
  if printf '%s' "$fa" | grep -q "$cA" && printf '%s' "$fb" | grep -q "$cB"; then
    pass R2e "并发写同名文件 heybe-lab/par.txt，两个会话经 /v1 各自取回自己的内容"
  else fail R2e "并发同名文件取回不一致：A=${fa:0:30} B=${fb:0:30}"; fi

  # R3 工具事件 + 文件取回
  code="HF$(rand)"
  fcode="$code"
  r="$(chat chat "lab:file" eu-f "请调用 write_file 在当前会话工作区写文件 heybe-lab/probe.txt，内容只有一行：${code}。写完只回复 DONE。")"
  if jget "$r" tools | grep -q '"name":"write_file","status":"running"' && jget "$r" tools | grep -q '"name":"write_file","status":"done"'; then
    pass R3a "流里有工具事件 write_file running→done；字段=$(jget "$r" tools | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log([...new Set(JSON.parse(s).map(t=>t.keys))].join("|")))')"
  else fail R3a "流里没看到 write_file 工具事件：$(jget "$r" tools)"; fi
  url="$(jget "$r" files | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const f=JSON.parse(s).find(x=>/probe\.txt$/.test(x.path||x.name||""));console.log(f?f.url:"")})')"
  if [ -n "$url" ]; then
    pass R3b "最后一块带 files，url 为 /v1 会话文件路径：$(printf '%s' "$url" | sed "s#${BASE}##; s#${AGENT_ID}#<agent>#")"
    body="$(curl -s -m 20 -H @"${LAB}/hdr-chat" -H 'X-Fastclaw-End-User: eu-f' "$url")"
    if printf '%s' "$body" | grep -q "$code"; then pass R3c "同 end-user GET 文件 200 且内容一致"; else fail R3c "同 end-user 取回内容不对"; fi
    st="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H @"${LAB}/hdr-chat" -H 'X-Fastclaw-End-User: eu-other' "$url")"
    [ "$st" = 404 ] && pass R3d "其他 end-user GET 同一文件 → 404" || fail R3d "其他 end-user GET 同一文件 → ${st}"
    st="$(curl -s -o /dev/null -w '%{http_code}' -m 20 -H @"${LAB}/hdr-chat" "$url")"
    [ "$st" = 404 ] && pass R3e "不带 end-user GET → 404" || info R3e "不带 end-user GET → ${st}"
  else fail R3b "最后一块没有 probe.txt 的 files 条目：$(jget "$r" files)"; fi

  # R4 已知风险复现（记 RISK，不计失败）：会话工作区按 session key 落盘；MEMORY.md 落在 Agent 共享目录
  r="$(chat chat "lab:file" eu-other "请调用 read_file 读取 heybe-lab/probe.txt 并原样回复内容，读不到就回复 NOFILE。")"
  if printf '%s' "$(jget "$r" text)" | grep -q "$fcode"; then
    say "R4a RISK 同 session key、不同 end-user 的对话内 read_file 能读到上一位的会话文件（HTTP 下载有 end-user 校验，工具层没有）"
  else info R4a "同 session key、不同 end-user 的 read_file 未读到（回复：$(jget "$r" text | cut -c1-40)）"; fi
  code="HM$(rand)"
  chat chat "lab:mem-1" eu-m1 "请调用 write_file 把 MEMORY.md 写成一行：lab-codeword ${code}。写完只回复 DONE。" >/dev/null
  local where
  where="$(grep -rl --exclude='*.db*' "$code" "${FASTCLAW_HOME}" 2>/dev/null | sed "s#${FASTCLAW_HOME}/##; s#${AGENT_ID}#<agent>#g" | tr '\n' ' ')"
  info R4b "会话 lab:mem-1 写的 MEMORY.md 落盘位置：${where:-<未找到>}"
  r="$(chat chat "lab:mem-2" eu-m2 "请调用 read_file 读取 MEMORY.md 并原样回复全文，读不到就回复 NOFILE。")"
  s="$(jget "$r" text)"
  if printf '%s' "$s" | grep -q "$code"; then
    say "R4c RISK 另一会话、另一 end-user 用 read_file 读到了 MEMORY.md 里的暗号（文件工具的 MEMORY.md 映射到 Agent 共享目录）"
  else info R4c "另一会话/end-user 的回复里没有暗号（模型可能拒绝复述；以 R4b 落盘位置为准）：${s:0:40}"; fi

  # R5 请求 model 字段是否覆盖 Agent 配置：看网关发往上游的 model
  local probe="openai/heybe-nonexistent-model" before ups
  before="$(wc -l <"${GW_LOG}")"
  r="$(chat chat "lab:model" eu-a "只回复 OK。不要调用工具。" "$probe")"
  sleep 1
  ups="$(upstream_models_since "$before")"
  if [ "$(jget "$r" model)" = "$probe" ]; then pass R5a "响应 model 回显请求值"; else info R5a "响应 model=$(jget "$r" model)"; fi
  if [ -n "$ups" ] && ! printf '%s' "$ups" | grep -q 'heybe-nonexistent'; then
    pass R5b "上游请求 model=${ups}（Agent 配置），未被请求字段覆盖；对话 $( [ "$(jget "$r" done)" = true ] && echo 正常完成 || echo 未完成)"
  else fail R5b "上游 model=${ups:-<日志里没找到>}"; fi
}

setup
case "${SUITE}" in
  runtime) suite_runtime ;;
  *) echo "未知用例集：${SUITE}" >&2; exit 2 ;;
esac
if [ "${FAILS}" = 0 ]; then say "RESULT: PASS"; else say "RESULT: FAIL (${FAILS})"; exit 1; fi
