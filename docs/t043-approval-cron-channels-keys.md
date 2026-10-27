# T0.4.3 静态核验：工具审批、定时触发、渠道入口、密钥存储与导出

> 对应 issue #10。对照 FastClaw **v1.4.0**（`b5ad3dff`）源码，日期 2026-10-27。以源码为主；“运行时旁证”一栏只来自 T0.4.1/T0.4.2 实验留下的数据目录（Linux，`grep` 比对，不打印值），**没有为本项单独起 gateway**。
> 表里的 `/v1` 指 FastClaw 官方集成接口，`/api` 指控制台内部接口（可能变化，本仓库适配层 lint 禁用，见 `interface-verification.md` 备注 1）。

## 1. 结论速览

| 项 | 结论 | `/v1` 能做什么 | 只有 `/api`（或 CLI）能做什么 | Heybe 替代方案 |
|---|---|---|---|---|
| 工具前审批 | **缺失** | 只有 `params.planMode=true`：本轮关掉工具，只出计划 | 无审批资源；ACP resume 恒返回 “not awaiting input” | 受控工具 / 受控 MCP 在 Heybe 侧审批；FastClaw 内置工具不能按调用拦截 |
| 定时触发 | **具备，但不适合作 Heybe 的计时者** | 无 cron 路由；但对话里模型可调 `create_cron_job` 自己建定时 | `GET/POST/PUT/DELETE /api/cron`、`/api/agents/{id}/cron`；CLI `fastclaw cron` | Heybe 任务管家做唯一计时者，按“任务+计划时刻”去重后调 `/v1`；监控并告警 `create_cron_job` |
| 渠道入口 / 通知 | **具备（FastClaw 自己的 IM 机器人），对 Heybe 缺失** | 无渠道路由，无“发消息”接口 | `/api/agents/{id}/channels/*`、`/api/channels`、`/api/scoped-channels`；CLI `fastclaw channels` | 先本地闭环；渠道入口与确定性通知由 Heybe 自己的通知模块做（或写 FastClaw 渠道插件，列开发项） |
| 密钥存储与导出 | **部分具备** | 无 | `/api/config`、`/api/providers` 读出时打码；Agent 归档导出不含凭据 | 模型 key 落库是明文，按“数据库即密钥”保护；控制台 API key 只存哈希 |
| MCP 继承环境变量 | **风险** | — | MCP 配置在 `/api/tools`（admin）、`/api/agents/{id}/config` | stdio MCP 拿到网关**全部**环境变量（含模型 key）；gateway 进程只放必需变量，MCP 用最小权限 |

## 2. 工具前审批

- **没有审批钩子**：`BeforeToolCall` 只是通知，`HookRegistry.Run` 依次调用、无返回值，不能否决（[`hooks.go:89–93`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/hooks.go#L89-L93)；调用点 [`loop.go:2780–2792`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/loop.go#L2780-L2792)）。插件钩子也只能替换 `Messages`（[`hook_adapter.go:71–95`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/plugin/hook_adapter.go#L71-L95)）。
- **ACP 没有等待输入的状态**：`POST /acp/runs/{id}`（resume）恒返回 403 “run is not awaiting input”（[`acp.go:386–393`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/acp.go#L386-L393)），且 `/acp` 不在 `/v1`。
- **唯一近似物是计划模式**：`/v1/chat/completions` 的 `params` 原样传给回合（[`openai.go:461`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L461)、[`openai.go:702–715`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L702-L715)），`params.planMode=true` 时本轮关掉工具、只输出计划，用户下一轮正常回复才执行（[`loop.go:2385–2400`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/loop.go#L2385-L2400)）。这是“先看计划”，不是逐个工具审批：执行那一轮里所有工具照常直接跑；有活动 goal 时计划模式还会被静默去掉。
- **工具白名单**：`policy.ToolsPolicy` 有定义但未找到执行处（见 `t044-agent-boundary.md` §1）。
- **替代**：需要审批的动作做成 Heybe 的受控工具（受控 MCP），审批状态、过期和重启后不误执行都在 Heybe 任务管家里实现；FastClaw 内置的 `exec`/`write_file` 等无法逐调用拦截，所以有副作用的任务只交给工具受限的 Agent，或放进沙箱。`planMode` 可作“先出方案、人工确认后再跑”的 UX，不能作安全边界。表第 4 行。

## 3. 定时触发

- **存储与触发**：DB 模式下调度器轮询 `cron_jobs`，到期就 `LockCronJob`（`locked_by IS NULL OR locked_at < now-5min` 的条件 UPDATE）→ 往总线投一条 `Source=cron` 的入站消息 → 再 `UpdateCronJobRun` 写下一次时间并解锁（[`scheduler.go:226–336`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/cron/scheduler.go#L226-L336)、[`database.go:4534–4553`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/store/database.go#L4534-L4553)）。
- **重复发生标识：没有**。入站消息只带渠道、会话、Agent、文本和 `Source: cron`，没有 job id 或计划时刻（[`scheduler.go:296–306`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/cron/scheduler.go#L296-L306)）。投递和写下一次时间之间崩溃，锁 5 分钟后过期，**同一次发生会再触发一次**（至少一次，不是恰好一次）。停机期间错过的多次只在启动后补触发**一次**（`next_run <= now`）。
- **多实例**：同库多实例靠行锁互斥；目标渠道不在线就累计失败，连续 3 次自动删除该定时（[`scheduler.go:70`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/cron/scheduler.go#L70)、[`scheduler.go:249–272`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/cron/scheduler.go#L249-L272)）。
- **`/v1` 能间接建定时**：Agent 只要有数据存储就注册 `create_cron_job` / `list_cron_jobs` / `delete_cron_job`（[`manager.go:289–294`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/manager.go#L289-L294)、[`cron.go:34`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/cron.go#L34)），没有开关。`/v1` 对话里模型可以自己建定时；触发时回到渠道 `api`（或请求头 `X-Fastclaw-Channel` 指定的渠道，[`openai.go:440–446`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L440-L446)），`ChatID` 是 session key。调度器对 `api` 渠道免检、照常触发（[`scheduler.go:250–254`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/cron/scheduler.go#L250-L254)），但出站路由里没有注册 `api` 渠道时回复只记一条 “unknown outbound channel” 后丢弃（[`manager.go:207–224`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/channels/manager.go#L207-L224)）。`/v1` 是一问一答，没有推送通道，所以**触发结果 Heybe 收不到**，只会进那个会话的历史（未实测）。
- **替代**：Heybe 任务管家做唯一计时者，用（计划 id + 计划时刻）做唯一键建任务，再按普通任务调 `/v1`。FastClaw 侧不建定时；在 Agent 指令里禁止 `create_cron_job`，并把 `create_cron_job` / `delete_cron_job` 加进工具事件告警（与 #66 的 Agent 管理类工具告警同一机制）。表第 7 行。

## 4. 渠道入口与通知

- **渠道是 FastClaw 自己的 IM 机器人**：Telegram、Discord、Slack、微信、LINE、iMessage、飞书、企业微信、WhatsApp 等，全部经 `/api/agents/{id}/channels/*` 连接（[`server.go:378–398`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L378-L398)），IM 消息直接进 Agent，不经过 Heybe。
- **`/v1` 没有渠道或推送**：`RegisterRoutes` 里只有聊天、Agent、会话文件、用户、用量、配额（[`server.go:75–119`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/server.go#L75-L119)），没有“往某渠道发一条消息”的接口，也没有出站 webhook。
- **入站 webhook**：系统 hooks 开启后有一个同步 webhook（收消息→回复正文，[`gateway.go:411–415`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/gateway/gateway.go#L411-L415)），是另一个进 Agent 的入口，不是通知出口。
- **渠道插件**：插件可以实现渠道（`internal/plugin/channel_adapter.go`），这是把 FastClaw 渠道消息转给 Heybe 的唯一扩展点，需要开发和维护。
- **替代**：MVP 先本地闭环（桌面端建任务、查状态、取交付物，交付物经 `/v1` 会话文件取回）。通知由 Heybe 自己的通知模块确定性发送（任务状态变化 → 通知），不依赖模型回复。IM 入口要么 Heybe 自己接 IM 机器人，要么写 FastClaw 渠道插件（列为开发项）。同一个 IM 机器人不能同时接在 FastClaw 渠道和 Heybe 上。表第 6 行。

## 5. 密钥存储与导出

| 东西 | 存哪里 / 怎么存 | 证据 |
|---|---|---|
| 模型 provider key（`agents init` 保存） | SQLite `configs.data`，**明文 JSON** | 运行时旁证：用 key 值 `grep -c` 实验库，命中 `fastclaw.db` 里 `configs.data` 1 行（值未打印） |
| 控制台 / `/v1` API key | `api_keys` 表只存 `key_hash` 和 `key_prefix` | 运行时旁证：表结构 `id,user_id,name,key_hash,key_prefix,type,created_at`；用 key 值比对全库无命中 |
| `CredentialManager` 凭据文件 | AES-GCM 加密，文件 0600；未设口令时密钥由主机名+home 派生（同机可解） | [`credentials.go:233–328`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/provider/credentials.go#L233-L328) |
| 网关日志、`agents init` 输出 | 实验日志里没有模型 key；但 `agents init` 首次会把**控制台 admin 密码明文打到 stdout** | 运行时旁证：`gateway.log`、`init.log` 用 key 值比对无命中；`init.log` 有 `Created user "admin" with password: …` |
| `GET /api/config`、`/api/providers`、`fastclaw provider list` | 读出时打码（前 4 后 4） | [`handlers.go:582–586`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/handlers.go#L582-L586)、[`handlers.go:2196–2201`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/handlers.go#L2196-L2201) |
| Agent 归档导出 `GET /api/agents/{id}/archive` | 只含身份文件和 Agent 自己的技能；**不含**模型凭据、MCP 配置（其 env/headers 带密钥）、渠道、技能 env、聊天和 `USER.md`/`MEMORY.md` | [`handlers_agent_archive.go:38–41`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/handlers_agent_archive.go#L38-L41) |
| 会话导出 `fastclaw session export` | 导出聊天内容；对话里出现过的密钥会原样带出 | `cmd/fastclaw/cmd_session.go` |

- **`/v1` 不涉及**：`/v1` 没有任何读配置、读 provider、导出的接口，所以 Heybe 经 `/v1` 拿不到也泄不出 FastClaw 存的密钥。风险在 FastClaw 数据目录本身。
- **替代 / 约束**：`FASTCLAW_HOME`（尤其 `fastclaw.db`）按“含明文模型 key”保护：0700、不进备份或同步盘、不打包进诊断日志。Heybe 的引导流程把 `agents init` 的 stdout 当敏感输出处理（不落盘，或只留脱敏版）。导出给别人用 Agent 归档，不要拷数据目录。表第 9 行。

## 6. MCP 与子进程的环境变量

- **stdio MCP 继承网关全部环境变量**：`StdioClient.Connect` 先 `cmd.Env = os.Environ()`，再追加配置里的 `env`；值以 `$` 开头时从网关环境取（[`stdio.go:37–47`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/mcp/stdio.go#L37-L47)）。**没有**过滤，所以网关进程里的 `DEEPSEEK_API_KEY`、`FASTCLAW_STORAGE_DSN` 等会进到每个 stdio MCP server。如果某个 MCP server 能执行命令或把环境回显给模型，就等于把这些密钥交给模型。
- **对比**：`exec` / `bash_session` / host exec 会按名字过滤（名字含 `_API_KEY`、`APIKEY`、`TOKEN`、`SECRET`、`PASSWORD`、`_DSN` 或前缀 `FASTCLAW_STORAGE_`、`AWS_` 等，[`env_scrub.go:14–83`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/env_scrub.go#L14-L83)），但只按变量名匹配，名字不像密钥的变量（如 `DEEPSEEK_KEY`）照样继承。
- **替代 / 约束**：启动网关时只给必需的环境变量（模型 key 优先走 provider 配置，不放进网关环境；放了就要接受 MCP 子进程都能读到）。Heybe 的受控 MCP 不回显环境、不提供任意命令执行。第三方 MCP 进沙箱或单独 Agent。归入表第 5 行（MCP 边界）的输入，运行时验证留给第 5 行。

## 7. 没覆盖的

- 以上都是源码核对 + 实验数据目录旁证，没有单独实测：`create_cron_job` 在 `/v1` 对话里实际创建并触发、触发后回复的去向，崩溃导致的重复触发，`planMode` 行为，stdio MCP 子进程实际拿到的环境。
- Postgres 存储、多实例、云模式（`UserLookup`）。
- macOS（iMessage 渠道等）。
