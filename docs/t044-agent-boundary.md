# T0.4.4 子 Agent、管理 API、工具权限 → 固定/动态边界映射（静态核验）

> 关联 #11。对象：FastClaw **v1.4.0（b5ad3dff）** 源码静态阅读，2026-10-27。
> 状态：**静态结论**；标「待实测」的条目需在真机/Linux 网关上跑一次再关 issue（不依赖 Mac 沙箱）。

## 1. 结论速览

| 能力 | v1.4.0 现状（证据） | Heybe 归类 | Community 处理 | Pro 可用性 |
|---|---|---|---|---|
| `/v1/agents` 增删改查 | `GET/POST /v1/agents`、`GET/PATCH/DELETE /v1/agents/{id}`、`PUT …/system-files/{name}`、`GET …/sessions/{s}/files/{path}`（`internal/api/server.go:85-101`）；受 `gateway.http.endpoints.agents.enabled` 开关控制 | 固定边界（由任务管家调用） | 只在安装/初始化时由 Heybe 调用一次创建默认 Agent；运行期不暴露给模型 | **可用**：创建/删除 API 齐全，满足 Pro 的 Agent 管理需求 |
| 模型在对话中自行创建 Agent | 工具 `create_agent` / `configure_agent` / `check_agent`（`internal/agent/tools/agent_admin.go`），每次调用检查 `callerIsAdmin` | 动态边界（高风险） | **必须拦截**，见 §2 | Pro 也应走审批 |
| 子 Agent：`spawn_subagent` | 把任务发给**已存在**的另一个 agentId（`tools/subagent.go`），禁止自调 | 动态边界 | v1 不开放多 Agent 协作（阶段2 才做） | 阶段2 评估 |
| 子 Agent：`delegate_task` | 临时子 Agent，串行执行，共享父 Agent 沙箱（`tools/delegate.go`、`loop.go:462` 无条件注册） | 动态边界 | 继承父沙箱，暂可接受；需实测确认不越出沙箱 | 同 Community |
| 工具白名单 | `policy.ToolsPolicy{Allow,Deny}` 有定义和默认值（`internal/policy/`），但 v1.4.0 源码中**未找到执行处**；`POST /v1/agents` 也无工具白名单字段 | — | 不能依赖 FastClaw 做工具白名单 | 同左 |

## 2. 关键风险：单人桌面场景下模型就是“管理员”

`isAdminChatter`（`internal/agent/slash.go:194`）：`web`/`api` 渠道下，只要请求方 UserID 等于 Agent 的 owner 就是管理员。
Heybe 用用户自己的 FastClaw apikey 调 `/v1/chat/completions`，请求方就是 owner ⇒ `callerIsAdmin=true` ⇒ **模型可在对话中直接调用 `create_agent`**。

也就是说，“Community 无自主创建 Agent 路径”**不能靠 FastClaw 默认行为保证**。可选限制方式（按推荐顺序）：

1. **调用身份降权（推荐）**：Heybe 对话走一个非 owner 的 app 用户身份（`POST /v1/users` 预建 end-user，请求带 `X-Fastclaw-End-User`），使 `isAdminChatter=false`，`create_agent` 等返回“restricted to the agent operator”。管理操作（建/删 Agent）仍由任务管家用 owner key 走 `/v1/agents`。—— **待实测**：end-user 身份下普通对话、文件取回是否正常。
2. **工具事件兜底**：任务管家已记录 `fastclaw_tool` 事件（#62）；见到 `create_agent`/`configure_agent` 即标记节点 `needs_check` 并告警。只能事后发现，不能阻止。
3. **上游补丁**：给 `RegisterAgentAdmin` 加配置开关或让 ToolsPolicy 生效。需要改 FastClaw 并维护 fork，v1 不建议。

## 3. 待实测清单（Linux 网关即可，不依赖 Mac）

- [ ] owner key 对话里让模型“新建一个 Agent”，确认 `create_agent` 会成功（复现风险）
- [ ] end-user 身份下同一请求被拒，普通对话/流式/文件取回不受影响
- [ ] `gateway.http.endpoints.agents.enabled=false` 后 `/v1/agents` 返回 404
- [ ] `delegate_task` 子 Agent 的文件/命令仍在父沙箱内（需 T0.3.1 沙箱环境，可放 Mac 一起测）

## 4. 对接口核验表的更新建议

`docs/interface-verification.md` 中“工具白名单”行维持“不支持”；新增一行“对话内建 Agent（create_agent）：支持且 owner 身份默认可用 → 需降权”。
