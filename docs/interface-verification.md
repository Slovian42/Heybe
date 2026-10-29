# FastClaw 接口核验表 / Interface Verification

目标版本：FastClaw **v1.4.0**（commit `b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）。每项在实际安装的固定版本上实测，附证据链接（测试记录、脚本、日志截图，已脱敏）后再填状态。
状态取值：`未开始` / `进行中` / `通过` / `不具备（已走降级）` / `待核验`。

`待核验` 表示已经对照 FastClaw **v1.4.0** 源码（commit `b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）或该 tag 上的集成文档看过，但还没有在实际安装的进程上实测。源码核对不能代替实测。

| # | 核验项 | 需要的证据 | 如果不具备 | 状态 | 证据链接 |
|---|---|---|---|---|---|
| 1 | 指定 Agent、独立会话与流式结果 | 两个任务上下文互不串扰，文件可取回 | 先补适配或缩小 MVP | **通过**（2026-10-27 Linux 实测；边界：会话文件只按 session key 落盘、`MEMORY.md` 走 Agent 共享目录） | [T0.4.1 实测](t041-runtime-verification.md)、`scripts/poc/fastclaw-lab.sh runtime` |
| 2 | 执行状态、停止和取消 | 能区分执行停止与前端连接中断 | 只读任务先行，不做危险自动接管 | **不具备（已走降级）**（2026-10-27 实测：协议层区分不了，重启和断网都是流没 `[DONE]` 就断；但客户端断开时 gateway 立即取消这一轮，所以“断开”≈“已停止”，工具副作用需人工核查。适配层报 `stream_truncated`，任务管家记 `needs_check`） | [源码核对](#adapter-v140)、[降级说明](#t04-degrade)、[T0.4.2 实测](t042-restart-verification.md) |
| 3 | 工具事件与错误 | 能观察失败和真实节点状态 | 加受控执行包装，不用文本猜完成 | **不具备（已走降级）**（工具事件只有 `id/name/status`，被拒的调用也是 `done`，**看不出工具失败**；流被切断时没有 `error` 块，适配层改报 `stream_truncated`） | [T0.4.1 实测](t041-runtime-verification.md#3-观察到的工具事件名)、[T0.4.2 实测](t042-restart-verification.md) |
| 4 | 工具前审批与恢复 | 拒绝、过期、重启后都不会误执行 | 用受控工具；未覆盖动作暂缓开放 | **不具备（已走降级）**（无审批钩子，`BeforeToolCall` 不能否决；`/v1` 只有 `params.planMode` 先出计划，不是逐工具审批） | [源码核对](#adapter-v140)、[降级说明](#t04-degrade)、[T0.4.3 §2](t043-approval-cron-channels-keys.md#2-工具前审批) |
| 5 | MCP、浏览器与沙箱边界 | 未授权文件、网络与动作被实际阻止 | 修正隔离，不能只改提示词 | **待核验**（2026-10-28 源码：exec 与浏览器技能在强制沙箱内；文件工具对显式宿主机路径直通宿主机；MCP/插件在宿主机运行并继承全部环境变量；渠道、`web_fetch` 在 gateway 进程内。阻塞项 B1–B3，运行时随 #6 实测） | [T0.3.2](t032-tool-isolation.md)（#7） |
| 6 | 渠道任务入口和确定性通知 | 建任务、查状态、回传交付物能闭环 | 先本地闭环；通知插件列为开发项 | **不具备（已走降级）**（渠道只在 `/api`，IM 直连 Agent、绕过 Heybe；无推送/通知接口。源码核对，未实测） | [T0.4.3 §4](t043-approval-cron-channels-keys.md#4-渠道入口与通知) |
| 7 | 定时触发与重复发生标识 | 一次发生只有一份任务 | 补去重包装，固定唯一计时者 | **不具备（已走降级）**（FastClaw cron 至少一次、无发生标识，管理只在 `/api`；但 `/v1` 对话可经 `create_cron_job` 自建定时。Heybe 做唯一计时者。源码核对，未实测） | [T0.4.3 §3](t043-approval-cron-channels-keys.md#3-定时触发) |
| 8 | 重启语义和未完成作业 | 已完成记录保留，中断操作可核查 | 不宣传自动无损恢复 | **不具备（已走降级）**（2026-10-27 Linux 实测：重启后历史保留；进行中的流 TERM/KILL 都被直接切断、无优雅收尾；中断那一轮用户消息留下、回复丢失、不续跑；daemon 模式崩溃自动拉起但同样不续跑。不在同一会话自动重试） | [源码核对](#adapter-v140)、[降级说明](#t04-degrade)、[T0.4.2 实测](t042-restart-verification.md) |
| 9 | 密钥存储与导出 | 数据库、日志和模板无明文密钥 | 调整凭据注入后再扩大测试 | **不具备（已走降级）**（模型 key 明文存于 `fastclaw.db` 的 `configs.data`；API key 只存哈希；日志、Agent 归档无明文；`agents init` 输出含 admin 密码；stdio MCP 继承网关全部环境变量） | [T0.4.3 §5–6](t043-approval-cron-channels-keys.md#5-密钥存储与导出) |
| 10 | （Pro）经 API 创建/删除 Agent 及限定工具范围 | `POST/DELETE /v1/agents` 可用且工具范围可限定 | Pro 工厂延后或列为上游提案 | 创建/删除：**通过**（2026-10-27 Linux 实测，owner key 200）；限定工具范围：**不具备**（创建体无白名单字段）；对话内 `create_agent`：经 `/v1` **被拒**（chatter 恒非 operator） | [t044 §2](t044-agent-boundary.md#2-对话内建-agent实测结论2026-10-27linuxv140-b5ad3dff)、备注 3 |

## 备注

1. **`/v1/*` vs `/api/*`**：FastClaw 官方集成指南（`skills/agent-integration/SKILL.md`）指定 `/v1/*` 为应用集成接口，`/api/*` 是可能变化的内部控制台接口。Agent 管理、配置、渠道、导入导出逐项核对是否有 `/v1` 等价物；本仓库适配层禁止 `/api/*`（lint 强制）。若将来不得不用，须单独评审，集中在适配层、固定版本并加兼容检查。
2. **model 字段不覆盖 Agent 配置**：`POST /v1/chat/completions` 请求里的 `model` 字段不会覆盖 Agent 自身的模型配置。切换或降级模型须通过已验证的 Agent 配置或候补 Agent，不能只改请求字段。v1.4.0 源码里该字段只被抄进响应回显（见下方端点核对）。运行时（2026-10-27 Linux）：**已实测不覆盖**——请求 `model` 为 `openai/heybe-nonexistent-model`、`deepseek/deepseek-v4-pro` 或空时，网关发往上游的都是 Agent 配置的 `deepseek-v4-flash`，响应 `model` 只回显请求值（`docs/t041-runtime-verification.md` R5）。切换模型须改 Agent 配置或换 Agent。

3. **对话 key 与管理 key 分开（#66 后续）**：Heybe 用 `HEYBE_FASTCLAW_CHAT_TOKEN`（对话，带 `HEYBE_FASTCLAW_END_USER`，默认 `heybe-local`）和 `HEYBE_FASTCLAW_ADMIN_TOKEN`（owner，仅任务管家建/删 Agent）两把 key。实测：`/v1` 对话里模型调用 `create_agent` 一律被拒（与 key 无关）；但**任何 `type=user` key 都能 `POST/DELETE /v1/agents`**，服务端不区分。只有控制台建的 `type=agent` key 会被 403（v1.4.0 CLI 建不出）。因此 key 分离是 Heybe 侧约束，服务端强制要靠 `type=agent` 对话 key。详见 `docs/t044-agent-boundary.md` §2。

## T0.4.x 降级结论（源码，非运行时伪造） {#t04-degrade}

更新日期：2026-10-23。依据仍是 v1.4.0 `RegisterRoutes` 与适配层端点核对，**没有**把未发生的运行时请求写成「通过」。

| 能力 | `/v1` 结论 | Heybe 降级 | 表行 |
|---|---|---|---|
| 取消 / 停止 | 无 cancel/stop 路由；控制台 `POST /api/chat/stop` 与 ACP `/acp/runs/{id}/cancel` 均不在 `/v1`，适配层不调用 | 调用方 `AbortSignal` 断开本次 HTTP；任务管家 `POST /tasks/{id}/cancel` **停止派发新节点**并记 `task_cancelled` 事件。**不能**区分「执行已停止」与「仅连接中断」 | 第 2 行 → 不具备（已走降级） |
| 会话 / 执行状态查询 | 无 session/run 资源；会话靠 `X-Fastclaw-Session-Key` 在首次聊天时隐式创建 | 任务管家本地状态机（pending/running/…/cancelled）作为唯一可信执行状态 | 第 2 行（状态查询部分）→ 不具备（已走降级） |
| 工具事件 | 运行时已见：流式空 delta 上的 `tool{id,name,status}`，`running` 然后 `done`，无结果/错误字段；回合失败时流式 HTTP 仍 200、末块带 `error`（源码） | 适配层已解析为 `V1StreamEvent` 的 `tool` / 抛错；不用 `done` 判断成功 | 第 3 行 → 进行中 |
| 重启 / 作业恢复 | `/v1` 无作业恢复或未完成 run 列举 API；运行时：进行中的流被切断（无 `[DONE]`），用户消息已落盘、回复丢失、不续跑 | **不宣传**自动无损恢复；截断 → `stream_truncated` → 节点 `needs_check`，不在同一 session key 自动重试；已完成记录以任务管家本地库为准，中断操作可核查事件日志 | 第 8 行 → 不具备（已走降级） |
| 工具前审批 | `/v1` 无审批资源 | 用受控 MCP / 受控工具包装；未覆盖动作暂缓开放 | 第 4 行 → 不具备（已走降级） |
| 请求 `model` 字段 | 源码、集成指南与运行时一致：只回显、不覆盖 Agent 配置 | 切换模型改 Agent 配置或换 Agent | 备注 2 → 已实测不覆盖 |

## 适配层端点核对（v1.4.0 源码，非运行时实测） {#adapter-v140}

核对日期：2026-10-22（T0.4 降级标注补于 2026-10-23）。依据是 tag `v1.4.0`（`b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）的路由注册，不是对正在运行的 FastClaw 的请求。营销页 <https://fastclaw.ai/features/api>（页脚 Last updated 2026-10-14）描述了同一组聊天 / Agent / 用量能力，但不作为端点清单的依据。集成说明以 tag 上的 [`skills/agent-integration/SKILL.md`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/skills/agent-integration/SKILL.md) 为准，并与 `internal/api/server.go` 的 `RegisterRoutes` 对过。

`/v1` 路由全部来自 [`internal/api/server.go` 第 74–126 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/server.go#L74-L126)。适配层只调用其中带「本版客户端」的几项；其余路由源码里有，本版没有封装。

| 方法与路径 | 源码 | 本版客户端 | 状态 |
|---|---|---|---|
| `POST /v1/chat/completions` | server.go:82，处理在 [`openai.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go) | `sendMessage` / `streamMessage` | 待核验 |
| `GET /v1/agents` | server.go:91，[`agents.go` `HandleListAgents`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/agents.go) | `listAgents`；`health()` 使用 `?limit=1` | 待核验 |
| `GET /v1/agents/{id}` | server.go:93 | `getAgent`（响应包在 `{ "agent": ... }` 里） | 待核验 |
| `GET /v1/agents/{id}/sessions/{session}/files/{path...}` | server.go:97，[`files.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/files.go) | `getSessionFile`。可选 `project_id`，会话若带了 end-user 须带同一个 `X-Fastclaw-End-User` | 待核验 |
| `POST /v1/agents` | server.go:92 | `createAgent`（仅 `admin` 角色；任务管家 `FastClawAgentAdmin`） | 实测 200（2026-10-27） |
| `PATCH /v1/agents/{id}` | server.go:94 | 未封装（`chat` 角色本地拒绝）。改模型走这里的 `model` 字段，不走聊天请求 | 实测 200（`type=agent` key 也可改已绑定 Agent） |
| `DELETE /v1/agents/{id}` | server.go:95 | `deleteAgent`（仅 `admin` 角色） | 实测 200，返回 `{id, deleted:true}` |
| `PUT /v1/agents/{id}/system-files/{name}` | server.go:96 | 未封装 | 待核验 |
| `POST /v1/users` | server.go:107 | 未封装 | 待核验 |
| `GET /v1/usage` | server.go:113 | 未封装 | 待核验 |
| `PUT /v1/quota`、`GET /v1/quota`、`DELETE /v1/quota` | server.go:115–119 | 未封装 | 待核验 |
| `OPTIONS /v1/` | server.go:76 | 不调用（CORS 预检） | 源码已见，无客户端 |

上面每一行的「待核验」都是：路由在 v1.4.0 源码里存在，但本仓库没有对安装好的 `v1.4.0` 进程发过请求。

### 查过、`/v1` 下没有的能力

这些项原先记为「待核验」。T0.4 按源码路由表把**确实没有**的能力改为「不具备（已走降级）」或保持「待核验」（仍需运行时证据的项）。适配层不会改走控制台接口。

| 想要的能力 | 依据 | 本版怎么处理 |
|---|---|---|
| 健康检查 `GET /v1/health`（或 `/v1/healthz`） | `RegisterRoutes` 没有这条路由。无鉴权探活是 [`internal/setup/server.go` 第 241–248 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L241-L248) 的 `GET /healthz`、`GET /livez`、`GET /readyz`，返回纯文本 `ok`，不在 `/v1` 下 | **待核验**。`health()` 按集成指南用 `GET /v1/agents?limit=1` 做带鉴权的连通性检查，不调用 `/healthz` |
| 取消 / 停止 | `RegisterRoutes` 没有 cancel 或 stop。服务端停止在 [`internal/setup/server.go` 第 287 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L287) 的 `POST /api/chat/stop`（控制台）。ACP 取消在 [`internal/api/acp.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/acp.go) 的 `POST /acp/runs/{runID}/cancel`，前缀是 `/acp` 不是 `/v1` | **不具备（已走降级）**。客户端只接受调用方的 `AbortSignal`，用来断开这一次 HTTP。任务管家取消停止派发新节点并记事件。不能区分「执行停止」和「连接中断」（表第 2 行） |
| 单独创建会话 `POST /v1/sessions`、列会话、查执行状态 | `RegisterRoutes` 没有 session / run 资源。会话是聊天请求头：[`openai.go` 第 380–384 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L380-L384) 读 `X-Fastclaw-Session-Key`，空则生成 `api-<纳秒>` | **不具备（已走降级）**。`createSession` 只在本地生成 key（默认 `heybe:<uuid>`），第一次 `POST /v1/chat/completions` 才在服务端开会话。执行状态以任务管家本地状态机为准 |
| 工具前审批 | `/v1` 路由表里没有审批资源 | **不具备（已走降级）**。降级为受控 MCP / 受控工具；表第 4 行 |
| 聊天请求的 `model` 是否改 Agent 配置 | [`openai.go` 第 473–476 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L473-L476) 把非空 `model` 赋给响应回显用的局部变量；第 509–513 行的 `runAgentTurn` / `HandleMessage` 不接收它。集成指南写明请求的 `model` 不改变 Agent 的模型 | **回显与不覆盖均已实测**（`t041-runtime-verification.md` R5：上游 model 始终是 Agent 配置）。类型注释在 `V1ChatRequest.model` |
| 限定工具范围的 `POST /v1/agents` | 创建体 `createAgentRequest`（[`agents.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/agents.go)）只有 `name`、`description`、`instructions`、`model`、`metadata`，没有工具白名单字段。`POST` / `DELETE /v1/agents` 路由本身存在 | **待核验**。表第 10 行的「创建/删除」有源码路由；「限定工具范围」在 v1 创建体里没找到 |
| 重启后恢复未完成作业 | `/v1` 无 run / job 恢复或列举未完成作业的路由 | **不具备（已走降级）**。不宣传自动无损恢复；表第 8 行 |

### 和表第 1–3 行对应的源码事实

- **指定 Agent**：body 的 `agent_id` 优先于 `X-Fastclaw-Agent-ID`（openai.go 约 361–378 行）。找不到或不在 key 的 ACL 里是 `404 agent_not_found`，不会换成另一个 Agent。
- **流式**：`stream: true` 时 `Content-Type: text/event-stream`，块为 OpenAI chunk，结束是 `data: [DONE]`。工具调用是空 delta 上的 `tool`（`status` 为 `running` 然后 `done`）。回合失败时 HTTP 仍是 200，最后一块带 `error`（`code: agent_error`）；非流式同一失败是 `502`。
- **产物**：非流式在响应顶层 `files`，流式在带 `finish_reason` 的最后一块。下载 URL 就是上面的 session file GET。`return_files: "inline"` 时小文件另有 `data_url`。

表第 5 行已做源码核对（[T0.3.2](t032-tool-isolation.md)，#7），运行时核验随 #6。第 4、6、7、9 行的源码核对与旁证见 [T0.4.3](t043-approval-cron-channels-keys.md)（issue #10）；其中 MCP 环境变量继承（T0.4.3 §6）是第 5 行的输入。渠道、定时、沙箱和密钥不在 `/v1` 客户端这一版的调用范围内。
