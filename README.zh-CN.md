<!-- Heybe：开源的 Mac 本地 AI 助理 / 本地 AI 智能体（Agent），可自带 API Key -->
<p align="center">
  <a href="https://heybe.dev"><img src="docs/images/social-preview.png" alt="Heybe：在你自己的 Mac 上运行的开源个人 AI 助理" width="760"></a>
</p>

<h1 align="center">Heybe：开源的 Mac 本地个人 AI 助理</h1>

<p align="center"><b>说一句，剩下的交给它。</b><br>
装在你自己电脑上的 AI 智能体（Agent）：在沙箱里干活，做敏感操作前先问你。<br>
默认用 DeepSeek，也可以填自己的 OpenAI 或 Claude API Key。</p>

<p align="center">
  <a href="LICENSE"><img alt="License: Apache-2.0" src="https://img.shields.io/badge/license-Apache--2.0-blue.svg"></a>
  <a href="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml"><img alt="CI status" src="https://github.com/Slovian42/Heybe/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platform: macOS (Apple Silicon)" src="https://img.shields.io/badge/platform-macOS%20%C2%B7%20Apple%20Silicon-black">
  <img alt="Status: developer preview in development" src="https://img.shields.io/badge/status-developer%20preview%20in%20development-orange">
  <a href="CONTRIBUTING.md"><img alt="DCO sign-off required" src="https://img.shields.io/badge/DCO-sign--off-green"></a>
  <a href="https://heybe.dev"><img alt="Website: heybe.dev" src="https://img.shields.io/badge/web-heybe.dev-E8453C"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <b>简体中文</b> ·
  <a href="README.zh-TW.md">繁體中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.pt-BR.md">Português (Brasil)</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.fr.md">Français</a>
</p>

> [!IMPORTANT]
> **当前状态：开发者预览版开发中，还没有可下载的安装包。** 下面的截图是设计稿，内容为示例数据，不代表最终界面。
> 想第一时间试用，请到 **[heybe.dev](https://heybe.dev)** 留邮箱，或先体验[可点击的交互原型](https://heybe.dev/demo)。

## Heybe 是什么？

Heybe 是一个**跑在你自己电脑上的私人 AI 助理**。你像跟朋友说话一样交代一件事，它会拆成步骤、上网查资料、写好报告或草稿，并把结果存成文件放在你的 Mac 上。关掉窗口它也会接着做。

它面向从没用过 “AI Agent” 的普通用户，也面向想要一个**可自托管、可审查、可修改**的 AI 助理的一人公司和开发者：

- **本地运行**：文件、任务和历史记录都留在你的电脑上。
- **安全空间**：所有操作默认在隔离沙箱里执行，碰不到你的个人文件。
- **先问再做**：删文件、写到它的文件夹之外、超出预算，都要你亲手点一下确认；在聊天里打“好”不算数。
- **模型自己选**：默认 DeepSeek；可以自带 OpenAI 或 Anthropic Claude 的 API Key；也可以用 Ollama 跑本地模型离线聊天。
- **开源**：社区版采用 Apache-2.0，构建和运行都不需要注册我们的账号。

## 界面预览（设计稿）

> 以下为 v1 设计稿，内容均为示例，实际产品可能不同。

<p align="center">
  <img src="docs/images/heybe-screens-overview.png" alt="Heybe 桌面应用界面总览：首次启动、对话、任务进度、操作确认、结果报告和设置" width="900">
</p>

| | |
|---|---|
| <img src="docs/images/heybe-onboarding-choose-ai-model.png" alt="Heybe 首次启动：选择 DeepSeek、自带 OpenAI 或 Claude API Key，或在本机运行模型" width="420"><br>**1. 首次启动**：选 AI 从哪来（DeepSeek、自己的 Key 或本地模型）。 | <img src="docs/images/heybe-chat-plan.png" alt="Heybe 对话：本地 AI 助理把一句话拆成分步计划" width="420"><br>**2. 对话**：说一句，它先列计划；关掉窗口也会继续。 |
| <img src="docs/images/heybe-task-progress-sandbox.png" alt="Heybe 任务进度：每一步都在沙箱安全空间里执行，可随时停止并显示花费" width="420"><br>**3. 任务进行中**：实时步骤、安全空间标识、停止按钮、已花费用。 | <img src="docs/images/heybe-action-approval.png" alt="Heybe 操作确认弹窗：AI 智能体删除文件前先征求同意，可拒绝、修改或同意" width="420"><br>**4. 操作确认**：敏感操作等你点：拒绝、修改或同意。 |
| <img src="docs/images/heybe-task-result-report.png" alt="Heybe 任务结果：带来源的对比表和推荐结论，保存为本地文件" width="420"><br>**5. 任务结果**：带来源的成品报告，存在你的 Heybe 文件夹。 | <img src="docs/images/heybe-settings-api-keys.png" alt="Heybe 设置：AI 服务与 API Key、沙箱常开的安全规则、Telegram 等聊天软件即将推出" width="420"><br>**6. 设置**：AI 服务和密钥、安全规则、聊天软件（即将推出）。 |

## Heybe 能帮你做什么？

| 你说 | Heybe 做 |
|---|---|
| “帮我比较这五款笔记软件。” | 逐个看官网，做出带来源的对比表，并给出推荐。 |
| “把这份会议记录整理成周报。” | 提炼决定、待办和负责人，生成可编辑的草稿。 |
| “总结这篇文章和它引用的三篇。” | 读完网页，写一份附链接的简报。 |
| “帮我清理草稿文件夹。” | 找出旧副本，移到废纸篓前先问你。 |
| “查一下周末去波特兰的机票和酒店。” | 把选项整理到一页，方便你挑。 |
| “把这周的网站数据做个小结。”（一人公司） | 一份简短回顾，加上下周的几条建议。 |

更多场景见 [docs/use-cases.md](docs/use-cases.md)。首个预览版之后计划加入：定时早报、降价提醒，以及在 **Telegram** 等聊天软件里直接和 Heybe 对话。

## 功能与进度

| 功能 | 状态 |
|---|---|
| macOS 桌面应用（Tauri + React），优先支持 Apple Silicon | 开发中 |
| 流式对话：DeepSeek（默认）、OpenAI、Claude（自带 API Key） | 开发中 |
| 通过 Ollama 使用本地模型（仅聊天，可离线） | 开发中 |
| 直接读取网页的联网搜索，标注来源 | 开发中 |
| 关窗不丢的长任务（本地任务管家，SQLite） | 骨架已合并 |
| 默认开启沙箱：每个会话一台微型虚拟机（Apple Silicon 用 BoxLite，备选 Lima） | 概念验证中 |
| 敏感操作点击确认（本地写入、删除、超预算） | 开发中 |
| 每个任务显示花费和所用模型 | 开发中 |
| 从 heybe.dev 下载签名公证的 DMG（不上 Mac App Store） | 计划中 |
| 可查看、修改、删除的长期记忆 | v1.1 |
| Telegram 等聊天软件接入 | 计划中 |
| 动态组建 Agent 团队 | Heybe Pro（以后） |

## 与同类产品对比

Heybe 介于云端 Agent（上手容易，但活在别人的服务器上跑）和开发者工具（强大，但面向终端）之间。下表基于 2026 年 10 月的公开资料，产品变化很快，请以各家官方文档为准。

| | 运行位置 | 源码 | 模型 | 安全机制 | 聊天软件 |
|---|---|---|---|---|---|
| **Heybe**（开发中） | 你的 Mac | 开源（Apache-2.0），以后有 Pro | DeepSeek、OpenAI、Claude（自带 Key）、Ollama | 默认沙箱 + 点击确认 | 计划支持 Telegram |
| [ChatGPT](https://chatgpt.com)（Work / 云端浏览器） | OpenAI 云端；有桌面和手机应用 | 闭源 | OpenAI | 访问新网站和重要操作前会询问 | — |
| [Claude](https://claude.com) 桌面版（Cowork） | 桌面应用（macOS、Windows），代码在本地虚拟机运行，也有云端会话 | 闭源 | Claude | 只访问你授权的文件夹，敏感操作前确认 | — |
| [Manus](https://manus.im) | 云端 Agent；桌面应用可操作你授权的文件夹 | 闭源 | Manus 托管 | 本地每条命令需批准 | — |
| [OpenClaw](https://github.com/openclaw/openclaw) | 你的电脑或服务器（macOS、Windows、Linux） | 开源（MIT） | 云端或本地 | 可选沙箱（如 Docker） | 20 多个渠道 |
| [FastClaw](https://github.com/fastclaw-ai/fastclaw) | 自托管多 Agent 运行时 | 源码可得（FastClaw Community License） | 云端或本地 | 多种沙箱后端 | 多个渠道 |
| [Open Interpreter](https://github.com/openinterpreter/openinterpreter) | 你的终端 | 开源（Apache-2.0） | 云端或本地 | 运行代码前询问 | — |
| [Jan](https://jan.ai) | 桌面应用 | 开源（Apache-2.0） | 本地（llama.cpp）和云 API | 以聊天为主，工具调用需批准 | — |
| [LM Studio](https://lmstudio.ai) | 桌面应用 | 闭源，个人和工作免费 | 本地模型 | 以聊天为主 | — |

**为什么选 Heybe？** 如果你在找一个跑在自己 Mac 上、开源、能自带 API Key、并且在 AI 和你的文件之间隔着沙箱和确认按钮的 **Manus 替代品** 或 **ChatGPT Agent 替代品**。
**为什么暂时不选？** Heybe 还没发布。如果今天就要用，上面这些工具都很成熟。

Heybe 通过 `/v1` API 运行在 FastClaw 之上，本仓库不包含 FastClaw（见 [NOTICE](NOTICE)）。文中提到的产品名称和商标归各自所有者所有，Heybe 与它们均无隶属或背书关系。

## 隐私与安全

以下是 v1 的设计原则，每一条在预览版发布前都会有测试证据。

- **默认本地**：任务、文件和记录存在你的 Mac 上。提示词只发给你选的 AI 服务；用本地模型则哪儿都不发。
- **密钥归你**：API Key 存在 macOS 钥匙串里，绝不写进仓库、日志或导出包。
- **沙箱常开**：v1 没有“关闭沙箱”的模式。操作在隔离的微型虚拟机里执行，网页读取也按设计在里面进行。
- **确认靠点击，不靠聊天**：敏感操作会写清楚要做什么、能不能撤回；你不点，它就不动。
- **结果诚实**：失败就显示失败，绝不假装成功；拿不准的结果停在“待你确认”。

## 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 | 仓库、FastClaw `/v1` 适配层、沙箱概念验证、接口核验 | 进行中 |
| 1 | 桌面对话、模型与密钥、网页读取、任务与结果 | 进行中 |
| v1 开发者预览 | 在 macOS（Apple Silicon）上从源码构建 | 尚未提供 |
| v1.1 | 长期记忆 | 计划中 |
| 之后 | Telegram 等聊天软件、定时任务、多 Agent 团队、heybe.dev 签名 DMG | 计划中 |

进度见 [里程碑](https://github.com/Slovian42/Heybe/milestones) 和 [Issues](https://github.com/Slovian42/Heybe/issues)。到 **[heybe.dev](https://heybe.dev)** 留邮箱，开放试用时通知你。

## 开发者快速开始

目前仓库里能跑的是 TypeScript 工作区（适配层、任务管家、占位桌面壳）和测试，还没有端到端可用的应用。

```bash
# 需要 Node 20+ 和 pnpm 10（corepack enable）
git clone https://github.com/Slovian42/Heybe.git && cd Heybe
pnpm install
pnpm lint      # eslint + 边界检查 + TypeScript
pnpm test      # vitest
pnpm --filter @heybe/desktop dev   # 占位界面：http://localhost:1420
```

FastClaw 和沙箱环境见 [docs/phase0-dev-env.md](docs/phase0-dev-env.md)、[docs/sandbox-options.md](docs/sandbox-options.md)、[docs/poc-boxlite.md](docs/poc-boxlite.md)。不要把真实密钥写进文件：本地值放在 `.env`（已被 git 忽略），模板见 `.env.example`。

## 常见问题

<details><summary><b>有没有能在 Mac 本地运行的开源 AI 助理？</b></summary>
Heybe 正是按这个目标开发的：Apache-2.0 开源、在你 Mac 上运行、默认开启沙箱的个人 AI 助理。目前在开发中，还不能下载。</details>

<details><summary><b>Heybe 是免费的 Manus 替代品吗？</b></summary>
社区版免费开源。和云端 Agent 不同，活儿在你自己的电脑上干。你只需付 AI 服务的费用（比如 DeepSeek），用本地模型则完全免费。</details>

<details><summary><b>能用自己的 OpenAI 或 Claude API Key 吗？</b></summary>
可以。支持自带 OpenAI 或 Anthropic Claude 的 Key，默认用 DeepSeek。Key 存在 macOS 钥匙串里。</details>

<details><summary><b>能离线用本地模型吗？</b></summary>
v1 计划支持通过 Ollama 和本地模型离线聊天。本地模型的工具调用暂不承诺，因为小模型目前还不够可靠。</details>

<details><summary><b>让 AI Agent 操作我的电脑安全吗？</b></summary>
Heybe 默认在隔离沙箱里执行操作，敏感操作前必须你点击确认，任务随时可以停止。</details>

<details><summary><b>能在 Telegram 里和 Heybe 聊天吗？</b></summary>
暂时不能。Telegram 等聊天软件计划在首个预览版之后接入。</details>

<details><summary><b>支持 Windows 或 Linux 吗？</b></summary>
v1 不支持，只支持 Mac（优先 Apple Silicon）。</details>

更多问题见 [docs/faq.md](docs/faq.md)（英文）。

## 社区版与 Pro 版

| | Heybe 社区版 | Heybe Pro（以后） |
|---|---|---|
| 许可 | Apache-2.0，即本仓库 | 闭源，Slovian Inc |
| 助理、任务、沙箱、确认、自带 Key | ✓ | ✓ |
| 按任务自动组建合适的 Agent 团队 | — | ✓ |
| 价格 | 免费 | 未公布 |

社区版绝不依赖 Pro，可以独立构建和运行。

## 参与贡献

欢迎贡献，请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。每个 commit 都要 DCO 签署（`git commit -s`），CI 会检查。PR 尽量小，绝不提交密钥；较大的改动请先开 [Issue](https://github.com/Slovian42/Heybe/issues) 讨论。引用本项目请见 [CITATION.cff](CITATION.cff)。

## 许可证

自研代码采用 [Apache License 2.0](LICENSE)，Copyright 2026 Slovian Inc。FastClaw 单独适用 FastClaw Community License，见 [NOTICE](NOTICE)。Heybe 与 FastClaw、OpenAI、Anthropic、DeepSeek、Manus、xAI 均无隶属关系。
