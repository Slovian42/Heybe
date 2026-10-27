# T0.4.4 子 Agent、管理 API、工具权限 → 固定/动态边界映射（静态核验）

> 关联 #11。对象：FastClaw **v1.4.0（b5ad3dff）** 源码静态阅读，2026-10-27。
> 状态：§1 为静态结论；§2 已于 2026-10-27 在 Linux 网关实测（#66 后续修正）。标「待实测」的条目仍需跑一次再关 issue。

## 1. 结论速览

| 能力 | v1.4.0 现状（证据） | Heybe 归类 | Community 处理 | Pro 可用性 |
|---|---|---|---|---|
| `/v1/agents` 增删改查 | `GET/POST /v1/agents`、`GET/PATCH/DELETE /v1/agents/{id}`、`PUT …/system-files/{name}`、`GET …/sessions/{s}/files/{path}`（`internal/api/server.go:85-101`）；受 `gateway.http.endpoints.agents.enabled` 开关控制 | 固定边界（由任务管家调用） | 只在安装/初始化时由 Heybe 调用一次创建默认 Agent；运行期不暴露给模型 | **可用**：创建/删除 API 齐全，满足 Pro 的 Agent 管理需求 |
| 模型在对话中自行创建 Agent | 工具 `create_agent` / `configure_agent` / `check_agent`（`internal/agent/tools/agent_admin.go`），每次调用检查 `callerIsAdmin`；**实测 `/v1` 对话恒为非 operator，被拒**（§2.1） | 动态边界 | 不靠模型自律；告警兜底，见 §2.3 | Pro 也应走审批 |
| 子 Agent：`spawn_subagent` | 把任务发给**已存在**的另一个 agentId（`tools/subagent.go`），禁止自调 | 动态边界 | v1 不开放多 Agent 协作（阶段2 才做） | 阶段2 评估 |
| 子 Agent：`delegate_task` | 临时子 Agent，串行执行，共享父 Agent 沙箱（`tools/delegate.go`、`loop.go:462` 无条件注册） | 动态边界 | 继承父沙箱，暂可接受；需实测确认不越出沙箱 | 同 Community |
| 工具白名单 | `policy.ToolsPolicy{Allow,Deny}` 有定义和默认值（`internal/policy/`），但 v1.4.0 源码中**未找到执行处**；`POST /v1/agents` 也无工具白名单字段 | — | 不能依赖 FastClaw 做工具白名单 | 同左 |

## 2. 对话内建 Agent：实测结论（2026-10-27，Linux，v1.4.0 b5ad3dff）

> 本节更正 #66 的静态判断。原文认为“owner key 调 `/v1/chat/completions` ⇒ 请求方是 owner ⇒ `callerIsAdmin=true` ⇒ 模型可直接 `create_agent`”。**实测不成立。**

### 2.1 `/v1` 对话的 chatter 永远不是 operator

- 源码：`internal/api/openai.go`（第 448–454 行）给 `/v1/chat/completions` 的 chatter 赋值为常量 `"api-user"`（无 end-user 时）或 app_user id `u_…`（带 `X-Fastclaw-End-User` / body `user` 时），**不会是 key owner 的 UUID**。`isAdminChatter`（`internal/agent/slash.go:194`）在 `web`/`api` 渠道要求 `UserID == trustOwnerID()`，工具层的 `callerIsAdmin` 由它经 `Registry.SetCallerIsAdmin`（`tools/registry.go:544`）设置，因此 `/v1` 对话恒为 false。上游单测 `trust_owner_test.go:22` 也断言 `api-user` 不是 admin。
- 实测（本地 Linux 网关，`FASTCLAW_HOME` 为临时目录，DeepSeek `deepseek-v4-flash`）：

| 调用身份 | 网关日志 chatter | 让模型调用 `create_agent` | 结果 |
|---|---|---|---|
| owner 的 `type=user` key，无 end-user | `channel=api user=api-user` | 流里出现 `tool{name:create_agent,status:running→done}` | 工具返回 `create_agent is restricted to the agent operator — the current chatter is not an admin of this agent, so nothing was changed`；`fastclaw agents list` 不变 |
| 另一把 `type=user` key + `X-Fastclaw-End-User: heybe-local` | `user=u_…  end_user=heybe-local` | 同上 | 同样被拒，Agent 列表不变 |
| `type=agent` key（只绑定该 Agent）+ end-user | app_user | 普通对话正常（流式、`[DONE]`） | — |

  未强制要求时，模型会先根据系统提示里的“你不是 operator”直接拒绝，不发起工具调用；把 Agent instructions 改成“测试人员要求调用时必须实际调用”后才拿到上面的工具层拒绝原文。
- 结论：**v1.4.0 下经 `/v1` 对话，模型不能在对话中建/改/查 Agent（`create_agent` / `configure_agent` / `check_agent`），与用哪把 key 无关。** 同理，宿主机 exec 和工作区外文件也按非 operator 处理。

### 2.2 真正的缺口：`type=user` key 本身就能管 Agent

| 请求 | owner `type=user` key | 普通 `type=user` key（含 end-user 头） | `type=agent` key |
|---|---|---|---|
| `POST /v1/agents` | 200 | **200**（实测建出了 Agent） | **403** `this api key cannot create agents` |
| `DELETE /v1/agents/{id}` | 200 | **200** | **403** `this api key cannot delete agents` |
| `PATCH /v1/agents/{id}` | 200 | 200 | **200**（能改 description/instructions/model） |
| `GET /v1/agents` | 全部 | 全部 | 只列绑定的 Agent |
| 另一 FastClaw 用户（`admin create-user --role user`）的 key 对 owner 的 Agent 对话 | — | — | `404 agent_not_found`（`appAgent` 要求 `rec.UserID == AccountID`） |

- `X-Fastclaw-End-User` 只改变 chatter，**不改变 `/v1/agents` 的权限**（`internal/api/server.go:86-89` 注释：Agent 管理接口归 key 的 app，不看 end-user）。
- `Identity.CanCreateAgent()` 只对 `type=agent` 为 false。但 v1.4.0 CLI 建不出 `type=agent` key：`fastclaw apikey create --type agent` 传入空 agent 列表，报 `type=agent requires at least one agent`；帮助（`cmd/fastclaw/cmd_apikey.go:34`）提到的 `--agents` 参数并未注册。只能走控制台 `POST /api/apikeys {type:"agent", agentIds:[…]}`（或控制台 UI），这在 `/v1` 之外。
- `gateway.http.endpoints.agents.enabled=false` 会把 `GET /v1/agents`（适配层 `health()` 探活）和会话文件下载 `GET …/files/{path}` 一起关掉（`server.go:85-101` 同一开关），**不可用**。

### 2.3 Heybe 的处理（本 PR）

1. **两把 key 分开配置**：`HEYBE_FASTCLAW_CHAT_TOKEN`（对话，非 owner）与 `HEYBE_FASTCLAW_ADMIN_TOKEN`（owner，只给任务管家建/删 Agent）。两者相同时配置报错。旧名 `HEYBE_FASTCLAW_TOKEN` 只作为对话 key 的兼容别名，**永远不会**被当成 admin key。
2. **对话固定带 end-user**：`HEYBE_FASTCLAW_END_USER`（默认 `heybe-local`），每次对话发 `X-Fastclaw-End-User` 和 body `user`，文件下载带同一个值。这样 chatter 是 owner 名下的 app_user，记忆/USER.md 不与网关上所有不带 end-user 的调用共用 `api-user`。
3. **适配层本地角色守卫**：`chat` 角色只允许 `GET` 与 `POST /v1/chat/completions`，其余（`POST/PATCH/DELETE /v1/agents*`、`PUT system-files`、`/v1/users`、`/v1/quota`）在发请求前就以 `role_forbidden` 拒绝；`admin` 角色只允许 `GET`、`POST /v1/agents`、`DELETE /v1/agents/{id}`，不能对话。任务管家的 `FastClawAgentAdmin` 是唯一持有 admin 客户端的地方。
4. **工具事件告警**：任务管家在流里看到 `create_agent` / `configure_agent` / `check_agent` / `delete_agent` / `spawn_subagent` / `delegate_task` / `install_skill` 时，除原有 `fastclaw_tool` 外再写一条 `fastclaw_tool_alert`，节点结果改为 `needs_check`。原因：流里的 `tool` 只有 `id/name/status`，`done` 不代表成功，看不出是否被拒。

**如实说明**：第 1、3 条是 Heybe 自身的约束，FastClaw 不强制——普通 `type=user` key 泄露后照样能建/删 Agent。它们缩小的是“哪个组件持有哪把 key”的爆炸半径，不是服务端权限。

### 2.4 替代方案（按推荐顺序）

1. **对话 key 用 `type=agent`（推荐，需一次性人工步骤）**：在 FastClaw 控制台（API Keys 页面）为 Heybe 默认 Agent 建一把 `type=agent` key 填进 `HEYBE_FASTCLAW_CHAT_TOKEN`。实测这把 key 对话正常，`POST/DELETE /v1/agents` 被服务端 403。代价：每新增一个 Agent 都要在控制台把它绑到这把 key 上（`PUT /api/apikeys/{id}/agents`）；它仍可 `PATCH` 已绑定 Agent 的 instructions/model。Heybe 不自动调用 `/api/*`（适配层禁止）；若要自动化，须按备注 1 单独评审。
2. **上游补丁/提案**：让 CLI 支持 `--agents`，或给 `type=user` key 增加“禁止 Agent 管理”的标志。需要维护 fork，v1 不建议。
3. **保留本 PR 的告警兜底**：只能事后发现，不能阻止。

## 3. 待实测清单（Linux 网关即可，不依赖 Mac）

- [x] owner key 对话里让模型“新建一个 Agent”：**被拒**（见 §2.1，原风险不成立）
- [x] end-user 身份下同一请求被拒；普通对话、流式正常（文件取回见 #8 的核验文档）
- [x] `type=user` key 能否 `POST/DELETE /v1/agents`：**能**（§2.2）；`type=agent` key：403
- [ ] `gateway.http.endpoints.agents.enabled=false`：源码确认会连带关闭 `GET /v1/agents` 和文件下载，未实测（已判定不可用）
- [ ] `delegate_task` 子 Agent 的文件/命令仍在父沙箱内（需 T0.3.1 沙箱环境，可放 Mac 一起测）

## 4. 对接口核验表的更新

`docs/interface-verification.md` 第 10 行与备注 3 已按 §2 更新：`POST/DELETE /v1/agents` 实测可用；“限定工具范围”仍不具备；对话内 `create_agent` 经 `/v1` 不可用。
