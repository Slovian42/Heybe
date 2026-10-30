# 阶段 1 拆分：#19 Tauri 壳 + 流式聊天、#16 模型提供方添加与连接测试

> 状态：方案，未实现。2026-10-30。关联 #19（T1.3.1）、#16（T1.2.1）。
> 约束（已定）：桌面端 Tauri + React；后端只经 FastClaw `/v1`（v1.4.0，b5ad3dff）；默认云端 DeepSeek（D3/D4），用户可自带 key；本地模型为高级选项（Ollama 需大上下文，见 #76）；分发只走 DMG / heybe.dev；沙箱默认强制（`FASTCLAW_SANDBOX_ENFORCE=1`，见 #6/#7）。
> 工作量：S ≤ 0.5 天，M ≈ 1–2 天，L ≈ 3–4 天。

## 0. 架构前提

```
Tauri 窗口（React，只连本机 Heybe 服务）
   │  HTTP/SSE 127.0.0.1 + 每次启动随机会话令牌
Heybe 本地服务（task-manager 同进程，#14）
   │  /v1 only（fastclaw-adapter，#15）；admin key 与 chat key 分开（#72）
FastClaw gateway（子进程，环境变量白名单 fc_env_bg/child-env，数据目录 700/600）
```

- 前端**永远拿不到**模型 key 与 FastClaw key；key 只在 Heybe 服务 ↔ macOS 钥匙串 ↔ FastClaw 之间流动。
- 不加载 FastClaw 自带 `web/`（#19 验收）。
- FastClaw 会把模型 key 明文写进 `fastclaw.db`（阶段 0 结论）：数据目录 700/600 是当前唯一缓解，在设置页说明里写明。

## 1. #19 T1.3.1 Tauri 壳 + React 流式聊天

验收（issue）：流式渲染、停止生成；不加载 FastClaw web/；关闭窗口后台继续。

| ID | 子任务 | 依赖 | 量 | 验收 |
|---|---|---|---|---|
| 19-a | Tauri 2 壳整理：单窗口、CSP 只允许 `self` 与 `http://127.0.0.1:<port>`；`capabilities` 只开必要权限（无 shell/fs 全开）；不打包/不导航到 FastClaw `web/` | — | S | 构建出的 app 只加载本地 React 资源；CSP 单测/检查脚本拒绝外部源 |
| 19-b | 本地服务生命周期：Tauri 侧以 sidecar 起 Heybe 服务（再由它起 gateway），随机端口+启动令牌经 IPC 交给前端；服务健康检查与崩溃重启（退避） | #14、#15 | M | 冷启动到“可聊天” ≤ 5 s（不含首次下载）；杀掉服务进程 10 s 内自动拉起，UI 显示“正在重连” |
| 19-c | 关窗后台继续：关闭窗口=隐藏（菜单栏图标保留），退出才停服务与 gateway；登录项可选（默认关） | 19-b | S | 关窗后正在跑的任务继续并在重新打开时显示结果；“退出”后无残留进程 |
| 19-d | 聊天 API（服务侧）：`POST /chat/sessions/:id/messages` → SSE 转发 `/v1/chat/completions` 的 delta/tool/done；会话键 `heybe:chat:<id>` | #15 | M | mock SSE 测试：增量顺序正确、`[DONE]` 结束、截断→显示“中断，结果未知”（#9 措辞） |
| 19-e | 停止生成：前端停止 → 服务断开上游连接，消息标“已停止（服务端是否停止未知）”；同会话下一轮前提示（v1.4.0 会回答孤儿消息，#9） | 19-d | S | 点停止 ≤ 300 ms 不再出字；状态文案与 #58 一致 |
| 19-f | React 聊天界面：消息列表、流式渲染（Markdown 安全渲染，禁原始 HTML）、工具步骤折叠显示（只有 running/done）、告警工具（#67 名单）显眼提示 | 19-d | M | 1 万字回复无卡顿（虚拟滚动或分块）；XSS 用例不执行 |
| 19-g | 首启引导（最小）：未配置提供方时引导到 #16 的“添加 DeepSeek”一步；沙箱检查失败时阻断聊天并说明（默认强制，不提供“关闭沙箱”按钮） | #16-c、#6 | S | 无 key → 只看到引导；沙箱未就绪 → 明确报错，不回退宿主机执行 |
| 19-h | 打包：DMG（arm64 优先，x64 视 #6 结果）、签名+公证、heybe.dev 下载页链接；不发 App Store/Homebrew | 19-a..c | M | 公证通过；新 Mac 双击安装后首启通过 19-g |

关键路径：19-a → 19-b → 19-d → 19-e/19-f → 19-g → 19-h（约 8–10 人日）。

## 2. #16 T1.2.1 提供方添加与连接测试

验收（issue）：OpenAI/Anthropic/DeepSeek/OpenRouter/Ollama/自定义兼容 6 类各一次连接测试通过并显示错误原因；密钥不下发前端、不进日志。

| ID | 子任务 | 依赖 | 量 | 验收 |
|---|---|---|---|---|
| 16-a | 提供方模型（shared-types）：`{id, kind, baseUrl, model, keyRef}`，`kind ∈ deepseek/openai/anthropic/openrouter/ollama/openai_compatible`；默认预置 DeepSeek（`https://api.deepseek.com`） | #15 | S | 类型与校验单测；`keyRef` 只是钥匙串条目名 |
| 16-b | 密钥存储：macOS 钥匙串（Tauri 插件或服务侧 `security`），服务读出后只在内存；API 只返回“已设置/未设置+末 4 位”；日志统一走 `redactSecrets` | 16-a | M | 测试：任何 API 响应、事件、日志快照里搜不到 key；前端 bundle 无 key |
| 16-c | 连接测试（服务侧）：**经 FastClaw `/v1`** 做一次最小对话（建/更新专用探针 Agent，`max_tokens` 很小），而不是前端直连提供方；超时 20 s | 16-b、#15 | M | mock 下 6 类成功/失败各一例；真实 DeepSeek 本地集成测试（key 用 source 读取，不进 CI，CI 用 mock） |
| 16-d | 错误归类与文案：401/403→“key 无效或无权限”，404 model→“模型名不存在”，429→“额度/限流”，DNS/超时→“网络不可达”，Ollama 连接拒绝→“本地 Ollama 没启动”，上下文过小→见 16-e；原始错误只留状态码与提供方 code，不带响应体里可能回显的 key | 16-c | S | 每类至少一个映射用例；UI 显示中文原因 |
| 16-e | Ollama 高级选项：默认隐藏在“高级”；检测 `num_ctx`，低于 16k 时警告（FastClaw 每轮约 1.1 万 token，默认 2k 会截断，#76 结论）；可选由 Heybe 起独立实例（如 11435 端口、`OLLAMA_CONTEXT_LENGTH=16384`），不改用户自己的 Ollama | 16-c、#5 | M | Mac 上 #76 脚本同等条件 3 轮记忆通过；num_ctx 不足时连接测试给出警告而非“通过” |
| 16-f | 设置页 UI：提供方列表、添加/编辑/删除、“测试连接”按钮与结果；DeepSeek 一步添加（只填 key） | 16-c/d、19-f | M | 6 类表单可用；key 输入框不回显已存 key |
| 16-g | 6 类真实连接验收：DeepSeek（已有 key）、Ollama（Mac）、其余 4 类需 Yang 提供测试 key 或接受 mock+文档验收 | 16-c..f | S | 每类一条记录（时间、模型、结果、错误原因截图） |

关键路径：16-a → 16-b → 16-c → 16-d → 16-f → 16-g（约 7–9 人日），16-e 可并行。

## 3. 两项之间的依赖与顺序

1. 先做 #14/#15 余项（服务常驻 + 适配层），它们是两边共同前置。
2. 并行：19-a/19-b 与 16-a/16-b。
3. 19-d 与 16-c 共用“服务→/v1 流式”代码，16-c 复用 19-d 的流客户端。
4. 19-g 依赖 16-c（引导里调用连接测试）和 #6（沙箱就绪检查）。
5. 19-h（DMG）最后；需要 Apple 开发者账号与公证凭据。

## 4. 风险

- FastClaw `/v1` 没有 stop / 工具审批：停止只能断连接（19-e）；工具失败只能推断（#74）。
- 模型 key 明文进 `fastclaw.db`：16-b 无法完全消除，只能靠数据目录权限；需在设置页说明。
- 沙箱：#6 BoxLite 0.10 与 FastClaw v1.4.0 不兼容，当前靠垫片或固定 0.9.5；19-g 的就绪检查要跟着最终方案走。
- 自定义兼容提供方可指向内网地址：连接测试走 FastClaw 出网，不额外拦私网（用户自填的本地服务是合法用法），但 baseUrl 只接受 http(s)。

## 5. 需要 Yang 决定

1. 除 DeepSeek 外 4 类云提供方（OpenAI/Anthropic/OpenRouter/自定义）的验收：提供测试 key，还是接受 mock + 文档验收？
2. 钥匙串之外 FastClaw 仍会把 key 明文存进 `fastclaw.db`：v1 是否接受（只靠 700/600 + 说明）？
3. 关窗后台运行时，是否默认开机自启（建议默认关）？
4. DMG 只出 arm64，还是 arm64 + x64（或通用包）？Apple 开发者账号/公证由谁提供？
5. BoxLite 固定 0.9.5 还是用本地垫片跟 0.10.x（影响 19-g 就绪检查）？
