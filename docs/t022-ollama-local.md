# Mac 真机核验：断网后用 Ollama 本地模型经 FastClaw 对话（#5 / T0.2.2）

给 Yang 在 M3 Mac 上照做。**不需要任何云端密钥**。前半段要联网（下载模型约 2 GB、装依赖），后半段按提示关 Wi-Fi，断网完成 3 轮对话。大约 10–20 分钟（大部分是下载模型）。

验收标准：断网状态下同一会话完成 3 轮流式对话，第 3 轮能答出第 1 轮告诉它的暗号。
**范围外：工具调用不在 T0.2.2 验收范围内**（小模型调工具不稳定，另行核验），本次只看基础对话。

需要的东西：Node.js 20 或更新、pnpm、git、curl、Ollama；磁盘空余 3 GB 以上，内存 8 GB 以上（16 GB 更稳）。

## 为什么脚本自己起一个 Ollama

FastClaw 每轮发给模型的系统提示和工具说明约 1.1 万 token，而 Ollama 默认上下文只有 2k–4k，会把前面截掉（包括上一轮对话），模型就“失忆”了。所以脚本在 **11435 端口**单独起一个 `ollama serve`，上下文设为 16384；它和 Ollama.app（11434）共用已下载的模型，不影响你平时用的 Ollama。

## 步骤（第 1–5 步联网做）

**1. 确认装了 Ollama**

```bash
ollama -v || ls /Applications/Ollama.app
```
看到什么算成功：打印 `ollama version is 0.x.x`，或列出 `/Applications/Ollama.app`。
如果两个都没有，装一个（二选一）：
```bash
brew install ollama
```
或到 https://ollama.com/download 下载 Ollama.app 拖进“应用程序”。

**2. 确认 Node 和 pnpm**

```bash
node -v && (pnpm -v || corepack enable && pnpm -v)
```
看到什么算成功：两行版本号，第一行 `v20.` 或更高。

**3. 取代码（已有 ~/heybe-poc 就会复用）**

```bash
[ -d ~/heybe-poc ] || git clone https://github.com/Slovian42/Heybe.git ~/heybe-poc; cd ~/heybe-poc && git fetch -q && git checkout -q main && git pull -q && echo OK
```
看到什么算成功：最后打印 `OK`。
（PR 还没合入时，把命令里的 `main` 换成 `feat/t022-ollama-mac`。）

**4. 确认网络代理不会挡下载**

用 Clash 等代理且开了 “Fake-IP / 增强模式” 的，先切到“规则/全局”普通模式或暂时关掉代理，否则第 5 步下载模型可能报 `E_PULL`。没用代理就跳过这一步。

**5. 一条命令跑完（先联网，中途会让你断网）**

```bash
cd ~/heybe-poc && scripts/poc/t022-mac.sh all
```
它会自动：在 11435 端口起 Ollama（上下文 16384）→ 下载并预热 `qwen2.5:3b` → 复用或安装 FastClaw v1.4.0 → 在独立目录、端口 18973 启动 → 配好 ollama Agent → 自动生成 FastClaw 访问密钥（只存文件，不显示）→ 装依赖。
看到什么算成功：一串绿色「通过」，然后出现加粗的
`>>> 现在请断网：点屏幕右上角 Wi-Fi 图标把 Wi-Fi 关掉……`
`>>> 断好后按回车继续……`

**6. 断网，按回车**

点右上角 Wi-Fi 图标关掉 Wi-Fi（插网线的拔网线、开着手机热点的也断开），回到终端按回车。
看到什么算成功：`通过 外网已不可达（offline=true）`，接着 3 行 `turn=1 / turn=2 / turn=3 … stream_ok=true`，最后一行是
`T022 RESULT: PASS step=done code=none`
（M3 上每轮首字大约十几到几十秒，是正常的；若提示仍能访问外网，检查 VPN/网线后再按回车，最多检查 3 次。）

**7. 取回传内容（仍在断网状态也可以）**

```bash
cat ~/.local/opt/heybe-t022/t022-report.txt
```
看到什么算成功：7 行左右，含 `turn=1..3` 的 `first_token_ms`、`total_ms`，`recall_ok=true`，`offline=true offline_check=done`，`T022 RESULT: PASS`，以及时间、系统、FastClaw 版本，没有任何密钥。把整段原样发回。

**8. 恢复网络**

重新打开 Wi-Fi 即可。

**9.（可选）清理**

```bash
cd ~/heybe-poc && PURGE=1 scripts/poc/t022-mac.sh cleanup
```
看到 `已清理` 即可（停掉本脚本起的 FastClaw 和 Ollama，删除 `~/.local/opt/heybe-t022`）。模型不会被删；不想留这 2 GB 的话再运行：
```bash
ollama rm qwen2.5:3b
```

## 断网阶段失败后怎么重跑

联网阶段做完后，只重跑断网部分（不会重新下载）：
```bash
cd ~/heybe-poc && scripts/poc/t022-mac.sh chat
```

## 回传格式（直接贴第 7 步输出最好）

```
T022: PASS / FAIL
错误码: none / E_xxx
step: done / precheck / ollama / model / warmup / fastclaw / gateway / agent / apikey / deps / offline / chat
offline: true / false    offline_check: done / skipped / failed
turn1 first_token_ms / total_ms: ____ / ____
turn2 first_token_ms / total_ms: ____ / ____
turn3 first_token_ms / total_ms: ____ / ____
recall_ok: true / false
model: ollama/qwen2.5:3b
```
不要贴：`~/.local/opt/heybe-t022/fastclaw-home/` 里的任何文件（含访问密钥 `heybe-t022-apikey`）。`chat.json` 里有模型回复片段，可以贴但一般不需要。

## 常见错误对照

| 错误码 | 意思 | 下一步 |
|---|---|---|
| E_NO_OLLAMA | 没找到 ollama | 做第 1 步的安装，再重跑第 5 步 |
| E_OLLAMA_START | 11435 端口的 Ollama 30 秒没起来 | 看 `~/.local/opt/heybe-t022/ollama.log` 最后几行；端口被占可加 `HEYBE_T022_OLLAMA_HOST=127.0.0.1:11436` 重跑 |
| E_PULL | 下载模型失败 | 检查网络；用 Clash 等 Fake-IP 模式的先切普通模式或关代理（第 4 步），再重跑 |
| E_OLLAMA_MODEL | 模型载入/调用失败 | 多半内存不够：关掉大应用重跑，或 `HEYBE_T022_MODEL=qwen2.5:1.5b scripts/poc/t022-mac.sh all` |
| E_NO_NODE / E_NODE_OLD | 没装 Node 或版本太旧 | `brew install node@20`，再重跑 |
| E_NO_PNPM | 没有 pnpm | `npm i -g pnpm`，再重跑 |
| E_DOWNLOAD / E_VERSION | FastClaw 下载失败或版本不对 | 检查网络能否访问 GitHub，稍后重跑 |
| E_PORT_BUSY | 端口 18973 被占用 | `HEYBE_T022_PORT=18983 scripts/poc/t022-mac.sh all` |
| E_GATEWAY | FastClaw 没启动起来 | 重跑一次；仍失败回传错误码 |
| E_AGENT_INIT | 配置 ollama Agent 失败 | 回传错误码 |
| E_APIKEY / E_APIKEY_PARSE | 自动生成访问密钥失败 | `PURGE=1 scripts/poc/t022-mac.sh cleanup` 后重跑第 5 步 |
| E_DEPS | 装依赖失败 | 多为网络问题，联网重跑 |
| E_STILL_ONLINE | 检查 3 次仍能上外网 | 关 Wi-Fi、拔网线、断热点/VPN 后运行 `scripts/poc/t022-mac.sh chat` |
| E_NOT_PREPARED | 联网阶段没跑完就跑了 chat | 先联网运行第 5 步 |
| E_CHAT_context_lost | 3 轮都通了，但第 3 轮没答出暗号 | 再跑一次 `chat`；仍失败回传整段报告（看 `prompt_truncated=` 是否为 true） |
| E_CHAT_timeout | 某一轮 5 分钟没答完 | 机器太忙或内存不足，关掉大应用后跑 `chat` |
| E_CHAT_network / E_CHAT_unauthorized | 连不上本机 FastClaw / 访问密钥失效 | `PURGE=1 … cleanup` 后联网重跑第 5 步 |
| E_CHAT_其他 | 其他对话错误 | 回传整段第 7 步输出 |

## 参考

- FastClaw v1.4.0 原生支持 ollama：`fastclaw agents init <名字> --provider ollama --model ollama/<模型> --api-base http://127.0.0.1:11435/v1`；provider 预设见源码 `internal/agentcli/agentcli.go` 的 `providerPreset`（ollama → openai-chat 协议），不填密钥时自动用占位值 `ollama`（同文件 557–563 行），不需要任何云端密钥。
- 多轮记忆由 FastClaw 服务端按会话保存：同一个会话 key 连发 3 轮（`internal/api/openai.go` 380–410 行）。
- 换模型：`HEYBE_T022_MODEL=qwen2.5:7b scripts/poc/t022-mac.sh all`（约 4.7 GB，16 GB 内存可用）。上下文：`HEYBE_T022_NUM_CTX`（默认 16384）。
- 本 box（Linux x86_64 纯 CPU，Ollama 0.40.13，qwen2.5:3b）上：联网跳过断网检测跑通 PASS，每轮首字约 64 s（纯 CPU 慢，M3 会快很多）；在无外网的隔离网络命名空间（`unshare -rn`）里真断网跑断网阶段，`offline=true offline_check=done`、3 轮 `stream_ok=true`、`recall_ok=true`、PASS（2026-10-29 11:20 CST）。
- 如果不设大上下文，Ollama 日志会出现 `truncating input prompt … prompt=11086`，第 3 轮就答不出暗号——这就是脚本自己起 Ollama 的原因。
