# FastClaw 接口核验表 / Interface Verification

目标版本：FastClaw **v1.4.0**（commit `b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）。每项在实际安装的固定版本上实测，附证据链接（测试记录、脚本、日志截图，已脱敏）后再填状态。
状态取值：`未开始` / `进行中` / `通过` / `不具备（已走降级）` / `待核验`。

`待核验` 表示已经对照 FastClaw **v1.4.0** 源码（commit `b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）或该 tag 上的集成文档看过，但还没有在实际安装的进程上实测。源码核对不能代替实测。

| # | 核验项 | 需要的证据 | 如果不具备 | 状态 | 证据链接 |
|---|---|---|---|---|---|
| 1 | 指定 Agent、独立会话与流式结果 | 两个任务上下文互不串扰，文件可取回 | 先补适配或缩小 MVP | 待核验 | [源码核对](#adapter-v140) |
| 2 | 执行状态、停止和取消 | 能区分执行停止与前端连接中断 | 只读任务先行，不做危险自动接管 | 待核验 | [源码核对](#adapter-v140) |
| 3 | 工具事件与错误 | 能观察失败和真实节点状态 | 加受控执行包装，不用文本猜完成 | 待核验 | [源码核对](#adapter-v140) |
| 4 | 工具前审批与恢复 | 拒绝、过期、重启后都不会误执行 | 用受控工具；未覆盖动作暂缓开放 | | |
| 5 | MCP、浏览器与沙箱边界 | 未授权文件、网络与动作被实际阻止 | 修正隔离，不能只改提示词 | | |
| 6 | 渠道任务入口和确定性通知 | 建任务、查状态、回传交付物能闭环 | 先本地闭环；通知插件列为开发项 | | |
| 7 | 定时触发与重复发生标识 | 一次发生只有一份任务 | 补去重包装，固定唯一计时者 | | |
| 8 | 重启语义和未完成作业 | 已完成记录保留，中断操作可核查 | 不宣传自动无损恢复 | | |
| 9 | 密钥存储与导出 | 数据库、日志和模板无明文密钥 | 调整凭据注入后再扩大测试 | | |
| 10 | （Pro）经 API 创建/删除 Agent 及限定工具范围 | `POST/DELETE /v1/agents` 可用且工具范围可限定 | Pro 工厂延后或列为上游提案 | 待核验 | [源码核对](#adapter-v140) |

## 备注

1. **`/v1/*` vs `/api/*`**：FastClaw 官方集成指南（`skills/agent-integration/SKILL.md`）指定 `/v1/*` 为应用集成接口，`/api/*` 是可能变化的内部控制台接口。Agent 管理、配置、渠道、导入导出逐项核对是否有 `/v1` 等价物；本仓库适配层禁止 `/api/*`（lint 强制）。若将来不得不用，须单独评审，集中在适配层、固定版本并加兼容检查。
2. **model 字段不覆盖 Agent 配置**：`POST /v1/chat/completions` 请求里的 `model` 字段不会覆盖 Agent 自身的模型配置。切换或降级模型须通过已验证的 Agent 配置或候补 Agent，不能只改请求字段。v1.4.0 源码里该字段只被抄进响应回显（见下方端点核对），运行时行为仍是 **待核验**。

## 适配层端点核对（v1.4.0 源码，非运行时实测） {#adapter-v140}

核对日期：2026-10-22。依据是 tag `v1.4.0`（`b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）的路由注册，不是对正在运行的 FastClaw 的请求。营销页 <https://fastclaw.ai/features/api>（页脚 Last updated 2026-10-14）描述了同一组聊天 / Agent / 用量能力，但不作为端点清单的依据。集成说明以 tag 上的 [`skills/agent-integration/SKILL.md`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/skills/agent-integration/SKILL.md) 为准，并与 `internal/api/server.go` 的 `RegisterRoutes` 对过。

`/v1` 路由全部来自 [`internal/api/server.go` 第 74–126 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/server.go#L74-L126)。适配层只调用其中带「本版客户端」的几项；其余路由源码里有，本版没有封装。

| 方法与路径 | 源码 | 本版客户端 | 状态 |
|---|---|---|---|
| `POST /v1/chat/completions` | server.go:82，处理在 [`openai.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go) | `sendMessage` / `streamMessage` | 待核验 |
| `GET /v1/agents` | server.go:91，[`agents.go` `HandleListAgents`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/agents.go) | `listAgents`；`health()` 使用 `?limit=1` | 待核验 |
| `GET /v1/agents/{id}` | server.go:93 | `getAgent`（响应包在 `{ "agent": ... }` 里） | 待核验 |
| `GET /v1/agents/{id}/sessions/{session}/files/{path...}` | server.go:97，[`files.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/files.go) | `getSessionFile`。可选 `project_id`，会话若带了 end-user 须带同一个 `X-Fastclaw-End-User` | 待核验 |
| `POST /v1/agents` | server.go:92 | 未封装 | 待核验 |
| `PATCH /v1/agents/{id}` | server.go:94 | 未封装。改模型走这里的 `model` 字段，不走聊天请求 | 待核验 |
| `DELETE /v1/agents/{id}` | server.go:95 | 未封装 | 待核验 |
| `PUT /v1/agents/{id}/system-files/{name}` | server.go:96 | 未封装 | 待核验 |
| `POST /v1/users` | server.go:107 | 未封装 | 待核验 |
| `GET /v1/usage` | server.go:113 | 未封装 | 待核验 |
| `PUT /v1/quota`、`GET /v1/quota`、`DELETE /v1/quota` | server.go:115–119 | 未封装 | 待核验 |
| `OPTIONS /v1/` | server.go:76 | 不调用（CORS 预检） | 源码已见，无客户端 |

上面每一行的「待核验」都是：路由在 v1.4.0 源码里存在，但本仓库没有对安装好的 `v1.4.0` 进程发过请求。

### 查过、`/v1` 下没有的能力

这些项按「待核验」记下。依据是同一份路由表里没有对应注册，而不是一次失败的实测。适配层不会改走控制台接口。

| 想要的能力 | 依据 | 本版怎么处理 |
|---|---|---|
| 健康检查 `GET /v1/health`（或 `/v1/healthz`） | `RegisterRoutes` 没有这条路由。无鉴权探活是 [`internal/setup/server.go` 第 241–248 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L241-L248) 的 `GET /healthz`、`GET /livez`、`GET /readyz`，返回纯文本 `ok`，不在 `/v1` 下 | **待核验**。`health()` 按集成指南用 `GET /v1/agents?limit=1` 做带鉴权的连通性检查，不调用 `/healthz` |
| 取消 / 停止 | `RegisterRoutes` 没有 cancel 或 stop。服务端停止在 [`internal/setup/server.go` 第 287 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L287) 的 `POST /api/chat/stop`（控制台）。ACP 取消在 [`internal/api/acp.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/acp.go) 的 `POST /acp/runs/{runID}/cancel`，前缀是 `/acp` 不是 `/v1` | **待核验**。客户端只接受调用方的 `AbortSignal`，用来断开这一次 HTTP。不能把它当成已经核实的服务端停止，也不能区分「执行停止」和「连接中断」（表第 2 行） |
| 单独创建会话 `POST /v1/sessions`、列会话、查执行状态 | `RegisterRoutes` 没有 session / run 资源。会话是聊天请求头：[`openai.go` 第 380–384 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L380-L384) 读 `X-Fastclaw-Session-Key`，空则生成 `api-<纳秒>` | **待核验**。`createSession` 只在本地生成 key（默认 `heybe:<uuid>`），第一次 `POST /v1/chat/completions` 才在服务端开会话。没有会话列表或状态查询方法 |
| 工具前审批 | `/v1` 路由表里没有审批资源 | **待核验**（表第 4 行仍未做运行时核验） |
| 聊天请求的 `model` 是否改 Agent 配置 | [`openai.go` 第 473–476 行](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L473-L476) 把非空 `model` 赋给响应回显用的局部变量；第 509–513 行的 `runAgentTurn` / `HandleMessage` 不接收它。集成指南写明请求的 `model` 不改变 Agent 的模型 | **待核验**（源码与指南一致，未实测）。类型注释写在 `packages/shared-types/src/fastclaw.ts` 的 `V1ChatRequest.model` |
| 限定工具范围的 `POST /v1/agents` | 创建体 `createAgentRequest`（[`agents.go`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/agents.go)）只有 `name`、`description`、`instructions`、`model`、`metadata`，没有工具白名单字段。`POST` / `DELETE /v1/agents` 路由本身存在 | **待核验**。表第 10 行的「创建/删除」有源码路由；「限定工具范围」在 v1 创建体里没找到 |

### 和表第 1–3 行对应的源码事实

- **指定 Agent**：body 的 `agent_id` 优先于 `X-Fastclaw-Agent-ID`（openai.go 约 361–378 行）。找不到或不在 key 的 ACL 里是 `404 agent_not_found`，不会换成另一个 Agent。
- **流式**：`stream: true` 时 `Content-Type: text/event-stream`，块为 OpenAI chunk，结束是 `data: [DONE]`。工具调用是空 delta 上的 `tool`（`status` 为 `running` 然后 `done`）。回合失败时 HTTP 仍是 200，最后一块带 `error`（`code: agent_error`）；非流式同一失败是 `502`。
- **产物**：非流式在响应顶层 `files`，流式在带 `finish_reason` 的最后一块。下载 URL 就是上面的 session file GET。`return_files: "inline"` 时小文件另有 `data_url`。

表第 4–9 行这次没有做运行时核验，状态保持未填（视为未开始）。渠道、定时、沙箱、重启和密钥不在 `/v1` 客户端这一版的调用范围内。
