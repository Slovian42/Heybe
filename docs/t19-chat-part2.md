# #19 桌面聊天 第二部分（流式稳定 · 关窗不丢 · 失败说实话 · 模型来源 · Markdown）

对应 M14「Tauri + React 流式聊天」退出条件 4「关闭窗口不丢任务；失败不显示为成功」，以及设计项 19-c/d/e/f。
其余 #19 内容（附件、多会话列表、可点链接、发布版 sidecar 等）放到 v1.1。

> 为避免和 PR #90 冲突，本 PR 不改 `docs/t19-desktop-chat.md`、`service.ts`、`main.ts`、`index.ts`、`gateway.ts`、
> `providers.ts`、`ci.yml`、README、`scripts/dev/heybe-desktop-dev.sh`、`scripts/poc/*`、`test/fixtures/fake-gateway.mjs`；
> 说明都写在这份新文档里。只走 FastClaw `/v1`。

## 1. 结构：一轮对话（turn）跟 HTTP 连接解耦

```
桌面 (React)  ──POST /chat/sessions/:id/messages (SSE)──►  task-manager ChatRunner ──/v1/chat/completions──► FastClaw
     ▲  关窗 / 刷新 / 断线：只断这条 SSE，turn 继续跑                     │
     └──GET /chat/sessions/:id、GET /chat/turns/:id/events?after=n ◄── SQLite chat_turns（schema v3）
```

- 每个事件带递增 `seq`，每轮恰好一个终止事件：`done` / `error` / `stopped`。终止后再来的 chunk 一律丢弃。
- 事件：`turn`（turnId）→ `source`（模型来源）→ `delta` / `tool` … → 终止事件。
- 存储：`chat_turns`（task-manager 的 SQLite，`HEYBE_TASK_DB`）。delta 合并后最多 250ms 落一次盘，其余事件立即落盘。
- 服务启动时把上次没结束的轮标为 `interrupted / service_restarted`；服务正常关闭时把仍在跑的轮标为 `interrupted`。
- 同一会话同时只能有一轮在跑，第二次发送返回 409（带正在跑的 turnId）。
- 历史最多返回最近 200 轮。

### 路由（都需要启动令牌，OPTIONS 返回 204 + CORS）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/chat/sessions/:id/messages` | 开一轮，SSE 推事件；409 = 上一轮未结束 |
| GET | `/chat/sessions/:id` | `{sessionId, turns: ChatTurnSnapshot[], activeTurnId}`，进行中的轮用内存里的最新文本 |
| GET | `/chat/turns/:id/events?after=n` | 还在跑：从 seq>n 起实时续推；已结束：一个 `snapshot` + `[DONE]` |
| POST | `/chat/turns/:id/stop` | `{turn, serverStopped: "unknown"}` |

### 桌面端

- 会话 id 存在 `localStorage`（`heybe.chat.sessionId`），重开窗口 / 刷新后用 `GET /chat/sessions/:id` 恢复，再续上 `activeTurnId`。
- 本地 SSE 断了（`cut`）就用 `after=lastSeq` 续接，最多 3 次；还不行就显示「中断，结果未知」。
- 按 seq 去重，snapshot 整条替换，不会重复渲染；终止后不再显示「正在输入」。
- 停止：本地立即标为「已停止（服务端是否停止未知）」（<300ms，测试覆盖），中止当前 fetch，再 POST stop；
  还没拿到 turnId 时先查会话再停 activeTurnId。提示「上一轮已停止，服务端可能仍会补完」。
- Tauri：关窗只隐藏（main.rs 已有），Cmd+Q 退出。`service.rs` 在没设置 `HEYBE_TASK_DB` 时给本地服务传
  `~/Library/Application Support/Heybe/heybe-tasks.db`（目录 0700）；目录建不了时退回内存库（会打印一行提示）。

## 2. 失败原因（中文，不显示裸「没做成」）

| 情况 | kind / reason | 显示 |
|---|---|---|
| 上游 401/403 | failed / key_invalid | 模型密钥无效，请到设置里更换 |
| 402 / 余额不足 | failed / insufficient_balance | 模型账户余额不足，请充值后再试 |
| 429 | failed / rate_limited | 模型服务限流了（请求太频繁），请稍等一会儿再试 |
| 404 / model not exist | failed / model_not_found | 模型不存在，请到设置里检查模型名 |
| 408/504、Go 超时 | failed / timeout | 模型服务响应超时，请稍后再试 |
| 连不上上游（`send request: Post …`） | failed / network | 连不上模型服务，请检查网络后再试 |
| 200 流中途 `error.code=agent_error` | 按 message 里的上游状态归类（同上） | 同上 |
| 非流式 502 | 按 body 归类 | 同上 |
| 流被截断 / `[DONE]` 前没有 finish | interrupted | 中断，结果未知 |
| 流长时间无数据（含 `: ping` 都没有） | interrupted / timeout | 本地运行时长时间没有任何回应，这一轮中断了，结果未知 |
| 沙箱拒绝（sandbox unavailable / no sandbox is configured / … no executor available） | failed / sandbox_denied | 沙箱拒绝执行这一步（没有可用的沙箱，或不允许在本机直接执行），没做成 |
| `E_FC_*` | unavailable / runtime_error | 每个码一句中文（端口被占、版本不一致、启动超时、意外退出…） |
| FastClaw 连不上 / 鉴权失败 | unavailable / runtime_unavailable | 本地运行时未响应 |
| 本地服务重启 | interrupted / service_restarted | 本地服务重启过，这一轮中断了，结果未知 |
| 本地服务 401（启动令牌） | unavailable | 本地服务拒绝了这次请求（启动令牌不对），请退出后重开 Heybe |
| 本地服务 409 | — | 这个会话上一轮还没结束，请等它结束或先停止 |
| 其它 | failed / unknown | 没做成，请稍后再试（错误码 xxx） |

## 3. 模型来源

- 来自 FastClaw 每个 SSE chunk 的 `model` 字段（`provider/model`，即这一轮真正用的配置），不是前端写死的。
- 显示「提供方 · 模型」+ 云端/本地/自定义标签：`DeepSeek · deepseek-chat 云端`、`本地 Ollama · qwen2.5:3b 本地`。
  不认识的提供方显示「自定义接口 xxx」，没有斜杠的 id 显示「未知提供方」，这一轮没收到模型信息时显示
  「模型来源未知（这一轮没收到模型信息）」。

## 4. Markdown（19-f）

- `react-markdown` + `remark-gfm` + `rehype-sanitize`，`skipHtml`，不自写解析器，不渲染原始 HTML。
- 禁用 `img/iframe/script/style/object/embed/form/input`；URL 只放行 `http(s)` 和 `mailto`；链接不跳转（title 显示地址）。
- `useDeferredValue` + `memo`，1 万字渲染测试 <500ms。
- 未参考 PorkBot 代码（其许可证禁止商用）。

### 新增依赖许可证

直接依赖：`react-markdown@^10.1.0`（MIT）、`remark-gfm@^4.0.1`（MIT）、`rehype-sanitize@^6.0.0`（MIT）。
传递依赖共 102 个：101 个 MIT，1 个 ISC（`@ungap/structured-clone@1.4.0`）。没有 GPL/AGPL/商用限制许可证。

## 5. 测试（CI 全用 mock，不用真 key）

- `packages/fastclaw-adapter/test/stream-p2.test.ts`：空闲超时、`onModel`。
- `services/task-manager/test/chat.test.ts`：事件顺序/seq/来源、Ollama 来源、截断、无 finish、流中途 401、终止后丢弃、
  断开不中止 + `after=n` 续接 + snapshot、停止 <300ms、409、重启孤儿轮、服务关闭、400/404/405/CORS。
- `services/task-manager/test/chat-e2e.test.ts` + `fixtures/fake-v1-chat.ts`：真 `FastClawClient` 对 mock `/v1`（ok/error/cut/slow）。
- `services/task-manager/test/chat-errors.test.ts`：沙箱拒绝、`E_FC_*`、空闲超时。
- `apps/desktop/test/*`：状态机（去重、snapshot、load、停止）、客户端（cut、401/409、续接/停止 URL）、Markdown XSS（10 种）、
  模型来源文案、会话 id。
- `apps/desktop/src-tauri/src/service.rs`：`task_db_location`、`private_dir_is_0700`。

## 6. 已知限制

- FastClaw `/v1` 没有停止接口：停止只是不再接收，服务端可能仍会补完（界面如实提示，`serverStopped: "unknown"`）。
- FastClaw 内部的模型回退不可见；502 或首个 chunk 前就失败时没有来源（显示「模型来源未知」）。
- 沙箱拒绝只有在整轮失败时才识别。
- 本地服务重启后无法续接进行中的轮，只能标为「本地服务重启过…结果未知」。
- 崩溃时最多丢最后 ≤250ms 的 delta。
- 等首个响应头 60s 超时归为「本地运行时未响应」。
- 链接不可点击（v1.1）。

## 7. Mac 验收（Apple 芯片）

```bash
cd ~/heybe && git fetch origin && git switch feat/19-chat-part2 && git pull --ff-only
pnpm install && pnpm lint && pnpm test          # 预期：全部通过
scripts/dev/heybe-desktop-dev.sh                 # 起桌面版
```

1. 发「用 markdown 列一个三行表格，再写一段 python 代码」→ 表格/代码块正常渲染；消息下方显示
   `DeepSeek · deepseek-chat` + 「云端」。
2. 发「写一篇 2000 字的文章」，输出中途点窗口红色关闭按钮 → 窗口隐藏；从 Dock 重新打开 → 已输出的内容还在并继续增长，没有重复。
3. 再发一条长回复，中途按 Cmd+R 刷新 → 同上，恢复并续上。
4. 发一条长回复，中途点「停止」→ 立刻显示「已停止（服务端是否停止未知）」和「上一轮已停止，服务端可能仍会补完」，不再显示「正在输入」。
5. 发 `<img src=x onerror=alert(1)>` 和 `[x](javascript:alert(1))` 让它原样复述 → 不弹窗，链接不跳转。
6. 断网后发消息 → 显示「连不上模型服务，请检查网络后再试」之类的中文原因，不是「没做成」。
7. 发一条长回复，中途 Cmd+Q 退出，再启动 → 那一轮显示「中断，结果未知」或「本地服务重启过，这一轮中断了，结果未知」；之前的历史都在。
   `ls -ld ~/Library/Application\ Support/Heybe` 预期 `drwx------`。
8. `scripts/dev/heybe-desktop-dev.sh check` → `✓ 没有残留进程，端口 18963 已释放`。
