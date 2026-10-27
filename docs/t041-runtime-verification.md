# T0.4.1 运行时核验：指定 Agent、独立会话、流式、文件取回

> 对应 issue #8。环境：Linux（x86_64），FastClaw **v1.4.0**（`b5ad3dff`），独立临时 `FASTCLAW_HOME`，只听 127.0.0.1，模型 DeepSeek `deepseek/deepseek-v4-flash`。日期 2026-10-27。
> 复跑：`HEYBE_LAB_ENV_FILE=<含 DEEPSEEK_API_KEY 的 600 文件> scripts/poc/fastclaw-lab.sh runtime`。脚本自建临时数据目录、Agent 和 apikey，跑完停 gateway、删 apikey、删目录；不打印任何密钥。CI 不跑它（需要真实模型），CI 只跑适配层 mock 测试。

## 1. 结论

| 核验点 | 结论 | 证据（脚本用例） |
|---|---|---|
| 指定 Agent + 流式 | **通过**。body `agent_id` 指定 Agent；SSE 以 `data: [DONE]` 结束，最后一块 `finish_reason=stop` | R1 |
| 两会话隔离（顺序） | **通过**。会话历史按 `X-Fastclaw-Session-Key` 隔离：另一 session key 不知道暗号；同一 session key 换 end-user 也不知道 | R2a–R2c |
| 两个并发任务互不串扰 | **通过**。两个会话同时对话、同时写同名文件 `heybe-lab/par.txt`，各自只复述自己的暗号，经 `/v1` 各自取回自己的文件内容 | R2d、R2e |
| 工具事件出现在流里 | **通过**。空 delta 块上的 `tool`，`running` → `done`。字段**只有** `id`、`name`、`status`，没有参数、结果或错误；被工具层拒绝的调用也是 `done`（见 `t044-agent-boundary.md` §2.1） | R3a |
| 产物文件经 API 取回 | **通过**。流式最后一块带 `files[]`（`name/path/size/content_type/url`），`url` 是 `GET /v1/agents/{id}/sessions/{session}/files/{path}`；同 end-user 200 且内容一致，其他 end-user 或不带 end-user 404 | R3b–R3e |
| 请求 `model` 是否覆盖 Agent 配置 | **不覆盖**。请求 `model=openai/heybe-nonexistent-model` 时，网关日志 `msg="openai request" … model=deepseek-v4-flash`（Agent 配置），对话正常完成；响应 `model` 字段只回显请求值。手工另测 `""`、`deepseek/deepseek-v4-pro`，上游同样是 `deepseek-v4-flash` | R5a、R5b |

**#8 两条验收标准（并发上下文互不串扰、产物经 API 取回）均已满足。** 下面两条是隔离的边界，必须写进 Heybe 的使用约束。

## 2. 隔离的边界（RISK，已复现）

1. **会话工作区只按 session key 落盘**：文件在 `workspaces/<agent>/sessions/<sessionKey>/…`，路径里没有 end-user。HTTP 下载有 end-user 校验（R3d），但**对话里的 `read_file` 没有**：同一 session key 换一个 end-user，模型能读到上一位写的文件（R4a）。
   → Heybe 的 session key 必须全局唯一、永不跨用户复用。现有 `sessionKeyFor({taskId,nodeId})` 已满足；不要用可猜测或可由外部输入拼出的 key。
2. **`MEMORY.md` 走 Agent 共享目录**：对话里 `write_file MEMORY.md` 落在 `agents/<agent>/agent/MEMORY.md`（R4b），不在会话目录。另一会话、另一 end-user 能 `read_file` 读到（手工复现过一次暗号完整泄露；脚本里模型有时拒绝复述，所以 R4c 只记 INFO）。数据库里的按 chatter 记忆（`memory_search` 等）是另一套，按 chatter 分开。
   → 同一 Agent 上的不同任务**不能**假设文件工具完全隔离。Heybe 的 Agent 指令里应禁止写 `MEMORY.md` / Agent 根目录；需要强隔离的任务用不同 Agent。

## 3. 观察到的工具事件名

`write_file`、`read_file`、`list_dir`、`exec`、`memory_search`、`create_agent`（被拒）。事件不带结果，所以任务管家不能凭 `tool.status=done` 判断成功，只能作为“发生过”的记录（#66 跟进 PR 对 Agent 管理类工具另写告警）。

## 4. 一次完整运行的输出（2026-10-27，已脱敏）

```
LAB setup INFO fastclaw=FastClaw_v1.4.0 agent=heybe-lab model=deepseek/deepseek-v4-flash home=mktemp port=18983
LAB R1 PASS 指定 agent_id 流式完成：[DONE] finish_reason=stop chunks=3
LAB R2a PASS 同会话能复述暗号
LAB R2b PASS 另一 session key 看不到（回复：不知道）
LAB R2c PASS 同 session key、不同 end-user 看不到（回复：不知道）
LAB R2d PASS 两个并发会话各自只复述自己的暗号
LAB R2e PASS 并发写同名文件 heybe-lab/par.txt，两个会话经 /v1 各自取回自己的内容
LAB R3a PASS 流里有工具事件 write_file running→done；字段=id,name,status
LAB R3b PASS 最后一块带 files，url 为 /v1 会话文件路径：/v1/agents/<agent>/sessions/lab:file/files/heybe-lab/probe.txt
LAB R3c PASS 同 end-user GET 文件 200 且内容一致
LAB R3d PASS 其他 end-user GET 同一文件 → 404
LAB R3e PASS 不带 end-user GET → 404
LAB R4a RISK 同 session key、不同 end-user 的对话内 read_file 能读到上一位的会话文件（HTTP 下载有 end-user 校验，工具层没有）
LAB R4b INFO 会话 lab:mem-1 写的 MEMORY.md 落盘位置：agents/<agent>/agent/MEMORY.md
LAB R4c INFO 另一会话/end-user 的回复里没有暗号（模型可能拒绝复述；以 R4b 落盘位置为准）
LAB R5a PASS 响应 model 回显请求值
LAB R5b PASS 上游请求 model=deepseek-v4-flash （Agent 配置），未被请求字段覆盖；对话 正常完成
LAB RESULT: PASS
```

用例依赖模型按要求调用工具或复述暗号；单次 FAIL 先看那一行的回复，再决定是否重跑。

## 5. 未覆盖

- macOS 未跑（脚本兼容，`stat` 两种写法都处理了）。
- 沙箱开启（`FASTCLAW_SANDBOX_ENFORCE=1` + docker）下的文件路径未测；本次是默认配置。
- 非流式响应的 `files` 顶层字段只做了源码核对。
