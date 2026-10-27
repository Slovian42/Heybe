# T0.4.2 运行时核验：停止 / 取消 / 重启语义

> 对应 issue #9。环境：Linux（x86_64），FastClaw **v1.4.0**（`b5ad3dff`），独立临时 `FASTCLAW_HOME`，只听 127.0.0.1，模型 DeepSeek `deepseek/deepseek-v4-flash`。日期 2026-10-27。
> 复跑：`HEYBE_LAB_ENV_FILE=<含 DEEPSEEK_API_KEY 的 600 文件> scripts/poc/fastclaw-lab.sh restart`（S4 需要 pnpm；`HEYBE_LAB_SKIP_ADAPTER=1` 跳过）。脚本自建临时数据目录、Agent 和 apikey，跑完停 gateway / daemon、删 apikey、删目录；不打印任何密钥。CI 不跑它，CI 只跑适配层和任务管家的 mock 测试。
> 依赖 T0.4.1（`t041-runtime-verification.md`）。工具事件字段的结论来自 T0.4.1 R3a 和 `t044-agent-boundary.md` §2.1。

## 1. 结论

| 场景 | 观察 | 用例 |
|---|---|---|
| 空闲时 SIGTERM 再启动 | 0–1 秒退出；重启后同 session key + end-user 的历史还在（存在 SQLite） | S1 |
| 进行中的流遇 SIGTERM | **没有优雅收尾**：0–1 秒内进程退出，流直接断，**没有** `[DONE]`、`finish_reason` 或 `error` 块 | S2-TERM |
| 进行中的流遇 SIGKILL | 同上 | S2-KILL |
| 中断那一轮在服务端留下什么 | 用户消息**已落盘**（`internal/agent/loop.go` 第 2513 行 `sess.Append(userMsg)` 在调模型之前，`internal/session/manager.go` 第 484–509 行同步写库）；已推给客户端的**半截回复不落盘**（助手消息在回合结束才写，第 2777 行）。下一轮模型常把这条“孤儿”用户消息当成没回答的问题重新作答（S2-KILL-user 这次就重新写起了散文），有时又会忽略它（多次运行里 TERM/KILL 各出现过一次“不知道”） | S2-*-partial、S2-*-user |
| 客户端主动断开（gateway 不重启） | gateway **立即取消**这一轮：日志 `LLM chat canceled`，`after model call` 的 elapsed ≈ 断开时刻（6 秒）。和重启一样：用户消息留下、回复不留；之前一次运行里下一轮直接去回答了被取消的那条（写出 1479 字散文） | S3、S3-server、S3-history |
| daemon 模式 gateway 崩溃 | `fastclaw daemon start`（`agents init` 在 gateway 没运行时也会自动这样拉起）下，gateway 被 SIGKILL 视为崩溃，daemon 1 秒内重新拉起；退避 1s、2s、4s … 30s，最多 10 次（[`internal/daemon/daemon.go` `RunLoop`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/daemon/daemon.go)） | S5-KILL |
| daemon 模式 gateway 收到 SIGTERM | 视为正常退出（`proc_unix.go` `isCleanShutdown`），daemon 跟着退出，**不再拉起**。`fastclaw daemon stop` 读 `fastclaw.pid`，而这个文件会被 gateway 自己覆盖成 gateway 的 pid，所以 stop 实际是给 gateway 发 TERM（5 秒后 KILL） | S5-TERM |
| 适配层看到什么 | 修复前：流没 `[DONE]` 就结束时 `streamMessage` **静默正常结束**，任务管家会把半截文本当成功。本 PR 后：抛 `FastClawError {kind:"network", code:"stream_truncated"}` | S4 + mock 测试 |

## 2. #9 验收对照

| 验收标准 | 结论 |
|---|---|
| 能区分执行停止与连接断开 | **协议层不能区分**：gateway 重启（TERM/KILL）和网络断开在客户端看都是“流没 `[DONE]` 就断了”，`/v1` 没有 run 状态查询（见 `interface-verification.md` 第 2 行）。但实测补上了语义：**客户端断开会让服务端立即取消这一轮**（S3），所以对 Heybe 来说“连接断开”≈“执行已停止”，不存在“连接断了但服务端还在后台跑完”的情况（在本版、本场景下）。已执行的工具副作用（写文件、exec）不会回滚，需要人工核查 |
| 工具失败可观测 | **不可观测**：工具事件只有 `id/name/status`，被拒的调用也是 `done`（T0.4.1 R3a、T0.4.4 §2.1）。降级：不凭 `tool.status` 判成功，需要可靠结果的动作走受控工具 / 受控 MCP（第 3、4 行） |
| 重启后中断执行状态有结论 | **有**：重启后历史保留；中断那一轮的用户消息留下、回复丢失、不会自动续跑；`/v1` 无作业恢复 API。daemon 模式下崩溃会被自动拉起，但拉起后同样不续跑 |

## 3. Heybe 的处理与约束（1、2 本 PR 已实现；3、4 是约束）

1. **适配层**（`packages/fastclaw-adapter`）：`parseChatSse` 没读到 `[DONE]` 就结束时抛 `SseTruncatedError`；读 body 中途出错（`TypeError: terminated` 等）同样归为截断。`streamMessage` 把两者包成 `FastClawError {kind:"network", code:"stream_truncated"}`，消息里只带错误名和脱敏后的前 80 字，不带 token。调用方自己 `abort()` 的不算截断，原样抛出。
2. **任务管家**（`services/task-manager`）：`stream_truncated` → 节点 `needs_check`（不是 `failed`，也不是 `succeeded`），记 `StreamError` 事件，带已收到字数和 `TRUNCATED_NOTE`：“流被中断（未收到 [DONE]），服务端执行结果未知，需人工核查；不要在同一会话自动重试”，`serverStopped: "unknown"`。
3. **不在同一 session key 上自动重试**：重试会叠在孤儿用户消息后面，模型很可能先去回答旧问题（S2/S3）。要重试就换新的 session key，并把需要的上下文显式带进新会话。`sessionKeyFor` 目前只按 `taskId/nodeId` 生成，同一节点从 `retry_wait` 回到 `running` 会复用同一个 key；接入重试派发时要给 key 加上 attempt 维度（本 PR 不改，截断已走 `needs_check`，不会进入 `retry_wait`）。
4. **部署**：用 daemon 模式时，崩溃（OOM、KILL）会被自动拉起，但中断那一轮不会恢复；运维停服务用 `fastclaw daemon stop` 或 TERM，不要依赖 daemon 做“无损重启”。

## 4. 没覆盖的

- macOS / Windows（Windows 上 `isCleanShutdown` 恒为 false，TERM 也会被 daemon 重启，未实测）。
- 沙箱模式下的 exec 中断（工具进程是否随 gateway 一起被杀）。
- 工具调用进行中被中断时，工具副作用是否已发生：脚本只测了纯文本长回复；带工具的场景按“副作用可能已发生”处理（needs_check）。
- 控制台 `POST /api/chat/stop` 和 ACP cancel 不在 `/v1`，没测。

## 5. 一次完整运行的输出（2026-10-27，已脱敏）

```
LAB setup INFO fastclaw=FastClaw_v1.4.0 agent=heybe-lab model=deepseek/deepseek-v4-flash home=mktemp port=18983
LAB S1 INFO 空闲 gateway SIGTERM 到进程退出 0 秒，重启后 /healthz 正常
LAB S1 PASS 重启后同 session key + end-user 能复述重启前的暗号（历史在 SQLite 里保留）
LAB S2-TERM PASS 进行中的流被直接切断：无 [DONE]、无 finish_reason、无 error 块（收到 30 块）；信号到进程退出 0 秒
LAB S2-TERM-partial PASS 已推给客户端的半截回复没有落盘（FASTCLAW_HOME 下找不到其开头片段）
LAB S2-TERM-user PASS 重启后能复述被中断那一轮的用户消息里的暗号（用户消息已落盘）
LAB S2-KILL PASS 进行中的流被直接切断：无 [DONE]、无 finish_reason、无 error 块（收到 43 块）；信号到进程退出 0 秒
LAB S2-KILL-partial PASS 已推给客户端的半截回复没有落盘（FASTCLAW_HOME 下找不到其开头片段）
LAB S2-KILL-user INFO 重启后没复述出被中断那一轮的暗号：《秋天的城市》 一 城市的秋天来得不动声色。它不像乡野那样，先由稻穗和棉桃发出通告，也不像山林那样，一夜之间就把整座山点
LAB S3 INFO 客户端 6 秒后主动断开：done=false chunks=439
LAB S3-server INFO 客户端断开 → gateway 立即取消这一轮（日志 LLM chat canceled，after model call elapsed=5.998272546s，≈断开时刻）
LAB S3-history INFO 客户端断开后再问上一条回复：没有回复
LAB S5-KILL PASS daemon 模式下 gateway 被 SIGKILL（视为崩溃）后 1 秒内被自动拉起
LAB S5-TERM PASS gateway 收到 SIGTERM 视为正常退出：daemon 跟着退出，不再拉起
LAB S4 PASS 适配层把被切断的流报成 FastClawError kind=network code=stream_truncated（不再静默结束）
LAB RESULT: PASS
```

模型行为相关的行（`*-user`、`S3-history`）是 INFO：同一条件多次运行结果不完全一致，结论以源码（用户消息先落盘、助手消息后落盘）为准。
