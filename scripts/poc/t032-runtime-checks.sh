#!/usr/bin/env bash
# #7 / T0.3.2 运行时补测：在 BoxLite 强制沙箱（boxlite-poc.sh 启动的 FastClaw，ENFORCE=1）下逐项实测 t032 §3 余下 4 项。
# 用法: scripts/poc/t032-runtime-checks.sh            （先跑过 boxlite-poc.sh rerun-boxlite，setup boxlite 已完成）
#   C1 B1：文件工具写 ~/Documents/heybe-t032-<随机>.txt，看是否落到宿主机（落到 = B1 成立）。
#          C1a write_file 新建；C1b edit_file 改测试自己先建的新文件；C1c apply_patch 新建。
#          每项只碰自己的一个新文件（先确认不存在），测完核对内容是本测试写的才删，不碰已有文件。
#   C2 沙箱镜像内有没有 camoufox-cli（exec 里 command -v）。
#   C3 delegate_task 子 Agent 的命令是否与父 Agent 在同一个沙箱（比对 Linux boot_id + hostname）。
#   C4 未设 FASTCLAW_ALLOW_HOST_EXEC：gateway 进程环境里没有它、模型工具列表里没有 host_exec、流里没出现 host_exec 调用。
#      另记一行 C4b：工具列表里有哪些能写文件的工具（write_file / edit_file / apply_patch），B1 面以 C1 实测为准。
# 结果写 ${POC_HOME}/t032-report.md，并重新生成 report.md（boxlite-poc.sh report 会把这一节并进去）。
# 环境变量：HEYBE_POC_HOME、FASTCLAW_PORT、HEYBE_POC_AGENT_NAME、HEYBE_POC_AGENT 同 boxlite-poc.sh
#   （/v1 只认 agt_… id：按名字经 GET /v1/agents 查，HEYBE_POC_AGENT=agt_… 手动指定）；T032_NO_START=1 不自动启动 boxlite 版 FastClaw（干跑/mock 用）。
# 不打印任何密钥：FastClaw apikey 只从 600 文件读进环境变量，交给 python 发请求。
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
POC_HOME="${HEYBE_POC_HOME:-$HOME/.local/opt/heybe-poc}"
FASTCLAW_PORT="${FASTCLAW_PORT:-18953}"
AGENT_NAME="${HEYBE_POC_AGENT_NAME:-poc}"
case "${HEYBE_POC_AGENT:-}" in "") AGENT_REQ=$AGENT_NAME ;; agt_*) AGENT_REQ=$HEYBE_POC_AGENT ;; *) AGENT_NAME=$HEYBE_POC_AGENT; AGENT_REQ=$AGENT_NAME ;; esac
# shellcheck source=lib-fc-agent.sh
. "$SCRIPT_DIR/lib-fc-agent.sh"
LOG_DIR="$POC_HOME/logs"
OUT="$POC_HOME/t032-report.md"
RAW="$POC_HOME/.t032.rows"
mkdir -p "$LOG_DIR"
: >"$RAW"

info() { printf -- '---- %s\n' "$*"; }
row()  { # 项目 结论 说明
  printf '| %s | %s | %s |\n' "$1" "$2" "$3" >>"$RAW"; printf '%s  %s：%s\n' "$2" "$1" "$3"; }
file_mode() { stat -c '%a' "$1" 2>/dev/null || stat -f '%Lp' "$1"; }   # Linux / macOS
hex() { python3 -c 'import secrets;print(secrets.token_hex(6))'; }

# ---- 前置：boxlite 版 FastClaw 在跑
if [ "$(cat "$POC_HOME/fastclaw.backend" 2>/dev/null)" != boxlite ]; then
  [ "${T032_NO_START:-0}" = 1 ] && { echo "FAIL 当前没有 boxlite 版 FastClaw（T032_NO_START=1）" >&2; exit 1; }
  info "当前 FastClaw 不是 boxlite 后端，用 boxlite-poc.sh 重启 boxlite 版"
  "$SCRIPT_DIR/boxlite-poc.sh" cleanup-fastclaw   # 停掉 docker 版，否则端口被占
  "$SCRIPT_DIR/boxlite-poc.sh" serve
  "$SCRIPT_DIR/boxlite-poc.sh" fastclaw-boxlite
fi
KF="$POC_HOME/boxlite/fastclaw-apikey"
[ -s "$KF" ] || { echo "FAIL 缺少 ${KF}（先跑 boxlite-poc.sh rerun-boxlite）" >&2; exit 1; }
[ "$(file_mode "$KF")" = 600 ] || { echo "FAIL ${KF} 权限不是 600" >&2; exit 1; }
FASTCLAW_API_KEY=$(cat "$KF"); export FASTCLAW_API_KEY
# /v1 不认名字（传 poc → 404 agent_not_found）：先查出 agt_… id
AGENT=$(FASTCLAW_HOME="$POC_HOME/boxlite" fc_resolve_agent_id "$FASTCLAW_PORT" "$AGENT_REQ" fastclaw "$POC_HOME/boxlite/agent-id") \
  || { echo "FAIL 查不到 Agent ${AGENT_NAME} 的 id（可用 HEYBE_POC_AGENT=agt_… 手动指定）" >&2; exit 1; }
info "/v1 使用 Agent id ${AGENT}"

# chat <标签> <prompt> → 回复正文写 $LOG_DIR/t032-<标签>.txt，工具事件名写 …-tools.txt（每行 name status）
chat() {
  python3 - "$FASTCLAW_PORT" "$AGENT" "$2" "$LOG_DIR/t032-$1.txt" "$LOG_DIR/t032-$1-tools.txt" <<'PY'
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
}
used() { grep -q "^$2 " "$LOG_DIR/t032-$1-tools.txt" 2>/dev/null; }
val()  { sed -n "s/.*$2=\([A-Za-z0-9_.:-]*\).*/\1/p" "$LOG_DIR/t032-$1.txt" | head -1; }

# ---- C1 B1：三个文件工具分别写 ~/Documents（write_file / edit_file / apply_patch）
# 每个子项只碰自己新建的一个临时文件（先确认不存在），测完核对内容是本测试写的才删，不碰已有文件。
# 源码静态结论（v1.4.0）：write_file/edit_file 在本地部署下对 ~/Documents 走宿主机（route.go RouteHostFS），
# 沙箱版 apply_patch 只写沙箱/工作区（apply_patch.go writeForPatchSandbox）。FASTCLAW_DEPLOY=hosted 下三者都不应落宿主机。
c1_judge() { # 标签 工具 文件 期望内容 说明前缀
  local label=$1 tool=$2 f=$3 want=$4 del
  if [ -f "$f" ] && [ "$(tr -d '\r\n' <"$f")" = "$want" ]; then
    rm -f "$f"; row "$label" "B1 成立" "$5 落到了宿主机 ~/Documents（阻塞项 B1）；已删除临时文件"
  elif [ -f "$f" ] && used "$tool" "$tool"; then
    del="内容不是本测试预期的结果，未删除：$f"
    case "$(tr -d '\r\n' <"$f")" in HEYBE_T032_*) rm -f "$f"; del="内容是本测试写的旧值，已删除临时文件" ;; esac
    row "$label" "未落宿主机" "调用了 ${tool}，宿主机文件没被改成预期内容；${del}"
  elif [ -f "$f" ]; then
    case "$(tr -d '\r\n' <"$f")" in HEYBE_T032_*) rm -f "$f" ;; esac
    row "$label" 未判定 "模型没调用 ${tool}（工具事件：$(tr '\n' ',' <"$LOG_DIR/t032-$tool-tools.txt")）"
  elif used "$tool" "$tool"; then
    row "$label" "未落宿主机" "调用了 ${tool}，宿主机没有该文件（写进了沙箱/工作区）"
  else
    row "$label" 未判定 "模型没调用 ${tool}（工具事件：$(tr '\n' ',' <"$LOG_DIR/t032-$tool-tools.txt")）"
  fi
}
c1() {
  info "C1a write_file 写 ~/Documents（验证 B1）"
  local L="C1a write_file 写 ~/Documents（B1）" tok f; tok="HEYBE_T032_$(hex)"; f="$HOME/Documents/heybe-t032-${tok#HEYBE_T032_}.txt"
  [ -e "$f" ] && { row "$L" 未判定 "临时文件名已存在，未测"; return; }
  chat write_file "Use the write_file tool (not exec) to create the file at the absolute path '$f' with exactly this content: $tok . Then reply DONE." \
    || { row "$L" 未判定 "/v1 调用失败"; return; }
  c1_judge "$L" write_file "$f" "$tok" write_file
}
c1e() {
  info "C1b edit_file 改 ~/Documents 里的文件（验证 B1）"
  local L="C1b edit_file 改 ~/Documents（B1）" old new f; old="HEYBE_T032_$(hex)"; new="HEYBE_T032_$(hex)"; f="$HOME/Documents/heybe-t032-${old#HEYBE_T032_}.txt"
  [ -e "$f" ] && { row "$L" 未判定 "临时文件名已存在，未测"; return; }
  [ -d "$HOME/Documents" ] || { row "$L" 未判定 "宿主机没有 ~/Documents，未测"; return; }
  printf '%s\n' "$old" >"$f"   # 测试自己先在宿主机建好这个新文件，看 edit_file 能不能改到它
  chat edit_file "Use the edit_file tool (not exec, not write_file) on the file at the absolute path '$f': replace the text $old with $new . Then reply DONE." \
    || { case "$(tr -d '\r\n' <"$f")" in HEYBE_T032_*) rm -f "$f" ;; esac; row "$L" 未判定 "/v1 调用失败"; return; }
  c1_judge "$L" edit_file "$f" "$new" edit_file
}
c1p() {
  info "C1c apply_patch 新建 ~/Documents 文件（验证 B1）"
  local L="C1c apply_patch 写 ~/Documents（B1）" tok f; tok="HEYBE_T032_$(hex)"; f="$HOME/Documents/heybe-t032-${tok#HEYBE_T032_}.txt"
  [ -e "$f" ] && { row "$L" 未判定 "临时文件名已存在，未测"; return; }
  chat apply_patch "Use the apply_patch tool (not exec, not write_file) with exactly this input:
*** Begin Patch
*** Add File: $f
+$tok
*** End Patch
Then reply DONE." \
    || { row "$L" 未判定 "/v1 调用失败"; return; }
  c1_judge "$L" apply_patch "$f" "$tok" apply_patch
}

# ---- C2 camoufox-cli
c2() {
  info "C2 沙箱镜像内有无 camoufox-cli"
  chat c2 "Use the exec tool to run exactly: echo OS=\$(uname -s); echo CAMOUFOX=\$(command -v camoufox-cli >/dev/null 2>&1 && echo yes || echo no) . Reply with the raw tool output only." \
    || { row "C2 沙箱镜像内 camoufox-cli" 未判定 "/v1 调用失败"; return; }
  local os cf; os=$(val c2 OS); cf=$(val c2 CAMOUFOX)
  if [ "$os" != Linux ]; then row "C2 沙箱镜像内 camoufox-cli" 未判定 "exec 输出 OS=${os:-空}（不在 Linux 沙箱或模型没执行）"
  elif [ "$cf" = yes ]; then row "C2 沙箱镜像内 camoufox-cli" 有 "镜像预装 camoufox-cli，浏览器技能可在沙箱内跑"
  elif [ "$cf" = no ]; then row "C2 沙箱镜像内 camoufox-cli" 无 "镜像未预装；v1 若要浏览器技能需自建镜像"
  else row "C2 沙箱镜像内 camoufox-cli" 未判定 "输出里没有 CAMOUFOX="; fi
}

# ---- C3 delegate_task 在父沙箱
c3() {
  info "C3 delegate_task 子 Agent 是否在父沙箱"
  # shellcheck disable=SC2016  # 要原样交给沙箱里的 shell 展开
  local cmd='echo BOOT=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null || echo none) HN=$(hostname)'
  chat c3 "Step 1: use the exec tool to run exactly: $cmd . Step 2: use the delegate_task tool to delegate this task to a sub-agent: \"use the exec tool to run exactly: $cmd and return the raw output\". Finally reply with two lines: 'PARENT <raw output of step 1>' and 'CHILD <raw output returned by the sub-agent>'." \
    || { row "C3 delegate_task 子 Agent 沙箱" 未判定 "/v1 调用失败"; return; }
  local t="$LOG_DIR/t032-c3.txt" pb ph cb ch
  pb=$(sed -n 's/^.*PARENT.*BOOT=\([A-Za-z0-9-]*\).*/\1/p' "$t" | head -1); ph=$(sed -n 's/^.*PARENT.*HN=\([A-Za-z0-9._-]*\).*/\1/p' "$t" | head -1)
  cb=$(sed -n 's/^.*CHILD.*BOOT=\([A-Za-z0-9-]*\).*/\1/p' "$t" | head -1);  ch=$(sed -n 's/^.*CHILD.*HN=\([A-Za-z0-9._-]*\).*/\1/p' "$t" | head -1)
  local hosthn; hosthn=$(hostname)
  if ! used c3 delegate_task; then row "C3 delegate_task 子 Agent 沙箱" 未判定 "流里没有 delegate_task 工具事件（模型没委派）"
  elif [ -z "$pb" ] || [ -z "$cb" ]; then row "C3 delegate_task 子 Agent 沙箱" 未判定 "回复里缺 PARENT/CHILD 的 BOOT="
  elif [ "$cb" = none ] || [ "$ch" = "$hosthn" ]; then row "C3 delegate_task 子 Agent 沙箱" "在宿主机" "子 Agent 的命令跑在宿主机（hostname=${ch}）→ 新阻塞项"
  elif [ "$pb" = "$cb" ] && [ "$ph" = "$ch" ]; then row "C3 delegate_task 子 Agent 沙箱" "同一沙箱" "父/子 boot_id 与 hostname 一致（hostname=${ph}）"
  else row "C3 delegate_task 子 Agent 沙箱" "不同沙箱" "父 ${ph}/${pb:0:8}，子 ${ch}/${cb:0:8}：子 Agent 在另一个沙箱（仍不在宿主）"; fi
}

# ---- C4 host_exec
c4() {
  info "C4 未设 FASTCLAW_ALLOW_HOST_EXEC 时没有 host_exec"
  local pid envhit=未知 ; pid=$(cat "$POC_HOME/fastclaw.pid" 2>/dev/null || true)
  if [ -n "$pid" ]; then
    if [ -r "/proc/$pid/environ" ]; then tr '\0' '\n' <"/proc/$pid/environ" | grep -q '^FASTCLAW_ALLOW_HOST_EXEC=' && envhit=有 || envhit=无
    elif ps -Eww -p "$pid" >/dev/null 2>&1; then ps -Eww -o command= -p "$pid" | grep -q 'FASTCLAW_ALLOW_HOST_EXEC=' && envhit=有 || envhit=无; fi
  fi
  chat c4 "List the exact names of ALL tools you can call, comma-separated, on one line starting with TOOLS: . Do not call any tool." \
    || { row "C4 host_exec 未注册" 未判定 "/v1 调用失败"; return; }
  local list; list=$(grep -m1 'TOOLS:' "$LOG_DIR/t032-c4.txt" | sed 's/.*TOOLS://' || true)
  if [ "$envhit" = 有 ]; then row "C4 host_exec 未注册" FAIL "gateway 进程环境里有 FASTCLAW_ALLOW_HOST_EXEC"
  elif grep -qw host_exec <<<"$list" || used c4 host_exec; then row "C4 host_exec 未注册" FAIL "工具列表/工具事件里出现 host_exec"
  elif [ -z "$list" ]; then row "C4 host_exec 未注册" 未判定 "模型没给出 TOOLS: 列表（进程环境：${envhit}）"
  else row "C4 host_exec 未注册" PASS "进程环境无该变量（${envhit}）；工具列表无 host_exec（$(tr -d ' ' <<<"$list" | cut -c1-200)）"; fi
  local ft="" t
  for t in write_file edit_file apply_patch; do grep -qw "$t" <<<"$list" && ft="${ft:+$ft,}$t"; done
  if [ -z "$list" ]; then row "C4b 能写文件的工具" 未判定 "模型没给出 TOOLS: 列表"
  elif [ -n "$ft" ]; then row "C4b 能写文件的工具" "有：$ft" "这些工具是否落宿主机以 C1a–C1c 实测为准（B1）"
  else row "C4b 能写文件的工具" 无 "工具列表里没有 write_file/edit_file/apply_patch"; fi
}

for c in c1 c1e c1p c2 c3 c4; do ( set +e; $c ) || row "$c" 未判定 "脚本异常（见上方输出）"; done
{
  echo "## #7 T0.3.2 运行时补测（BoxLite 强制沙箱）"; echo
  echo "生成时间：$(date '+%F %T %Z')；FastClaw 部署模式：$(cat "$POC_HOME/fastclaw.deploy" 2>/dev/null || echo 未知)（hosted 时 C1 应全为「未落宿主机」）；原始输出：\`${LOG_DIR}/t032-*.txt\`"; echo
  echo '| 项目 | 结论 | 说明 |'; echo '|---|---|---|'; cat "$RAW"
} >"$OUT"
rm -f "$RAW"
echo "已写入 ${OUT}"
if [ "${T032_NO_START:-0}" != 1 ]; then "$SCRIPT_DIR/boxlite-poc.sh" report >/dev/null && echo "已并入 ${POC_HOME}/report.md"; fi
