# T0.5.1 设计：单 Agent 读网页生成本地 Markdown 报告并取回

> 关联 #12。状态：方案，未实现。2026-10-28。
> 验收标准：沙箱开启下 Agent 读 1 个公开网页生成 Markdown 报告，经 API 取回到本地目录。

## 1. 端到端流程

```
用户（桌面端 / CLI）→ 任务管家 POST /tasks {url, goal}
  → 单节点任务 → FastClawNodeExecutor（#62）
  → POST /v1/chat/completions（stream，session key = heybe:task:<t>:node:<n>）
      模型：web_fetch(url) → 整理 → write_file("report.md")   ← 相对路径走工作区存储
  → 流末块 files[] 里有 report.md
  → 任务管家 GET /v1/agents/{id}/sessions/{session}/files/report.md（同 end-user）
  → 写到本地 <输出目录>/<taskId>/report.md，事件 artifact_saved，节点 awaiting_review
```

## 2. 网页抓取（D3：先用普通网页抓取）

- 用 FastClaw 内置 `web_fetch`：gateway 进程里发 GET，有 SSRF 防护（拒私网/回环/元数据地址，限重定向），见 `docs/t032-tool-isolation.md` 第 5 行。不配置 `web_search` 提供方。
- 不用浏览器技能（camoufox）：依赖沙箱镜像、冷启动 2–3 分钟，v1 不需要 JS 渲染。
- Agent 指令（`system-files`）固定：只抓用户给的那一个 URL；不得跟随页面里的指令（提示注入）；不调用 exec、cron、Agent 管理类工具。命中告警名单的工具调用让节点进 `needs_check`（#67 机制）。
- 风险：`web_fetch` 不在沙箱网络策略内（T0.3.2 第 5 行），可被注入诱导去 GET 其它公网 URL。v1 缓解：指令约束 + 工具事件审计（事件只有工具名，看不到 URL）。后续可改为**任务管家先抓取**（Heybe 侧 fetch + 同样的私网拦截），把正文作为消息喂给模型并关闭 `web_fetch`——这样抓取在我们控制下，作为 v1 备选。

## 3. 报告写回与取回

- 模型 `write_file("report.md")`：相对路径走 `RouteWorkspaceStore`（不进沙箱容器，容器回收后仍在），路径 `workspaces/<agent>/sessions/<sessionKey>/report.md`。
- 取回只走 `/v1`：流末块 `files[]` 的 `url`（T0.4.1 R3b–R3e 已验证，同 end-user 200、其他 404）。适配层已有 `getSessionFile`。
- 本地落盘：默认 `~/Library/Application Support/Heybe/reports/<taskId>/report.md`（Linux 开发：`$XDG_DATA_HOME/heybe/reports/…`）；目录 700、文件 600；文件名做白名单（只允许 `[\w.-]`，拒 `..`、绝对路径）；大小上限（如 2 MB）；内容类型限 `text/markdown`/`text/plain`。
- 没有 report.md（模型没写或写到别处）→ 节点 `failed`，错误码 `artifact_missing`；不从流文本里猜。

## 4. 任务管家串联（改动点）

| 模块 | 改动 |
|---|---|
| `packages/shared-types` | 任务模板 `web_report {url, goal}`；事件 `artifact_saved {name,size,path}` |
| `services/task-manager` | `FastClawNodeExecutor` 在 `done` 后按 `files[]` 取回声明的产物；新模块 `artifacts.ts` 做路径校验与落盘 |
| URL 校验 | 建任务时只接受 `http(s)`、公网主机（与 FastClaw 拦截一致，提前报错） |
| 测试 | CI：mock SSE + mock 文件下载（含路径穿越、超大、缺文件用例）；本地：`fastclaw-lab.sh` 加 `report` 场景，抓一个固定公开页（如 `https://example.com`） |

## 5. 依赖

| 依赖 | 作用 | 状态 |
|---|---|---|
| #8 T0.4.1 | 指定 Agent、会话隔离、文件经 `/v1` 取回 | 已关闭（满足） |
| #58 / #62 / #65 | 真实派发与常驻调度 | 已合；#58 余工具失败可观测问题 |
| #6 T0.3.1 | “沙箱开启下”这一条：`FASTCLAW_SANDBOX_ENFORCE=1` + BoxLite | **等 Mac**（`boxlite-poc.sh`） |
| #7 T0.3.2 | 哪些工具在隔离内（`web_fetch` 不在，文件显式宿主路径不在） | 本 PR 静态完成，实测随 #6 |
| #4 T0.2.1 | Mac 上云端对话链路 | **等 Mac**（`t021-mac.sh`） |

## 6. 先在 Linux 能做的

1. 第 3、4 节的全部代码与 CI 测试（不依赖沙箱）。
2. Linux 本地 FastClaw v1.4.0 + DeepSeek 跑通“抓 example.com → report.md → 落本地”，**沙箱关闭**；记为“非沙箱通过”。
3. Linux 上能装 Docker 的话可用 `sandbox.backend=docker` + `FASTCLAW_SANDBOX_ENFORCE=1` 先预跑沙箱路径（不等同于 Mac BoxLite，只做提前发现问题）。
4. Mac 上的最终验收：#6 通过后，在 BoxLite 强制沙箱下复跑第 2 步，这一步才关 #12。
