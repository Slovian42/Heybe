# OpenGrok Community (codename)

> **中文** | [English](#english)

装在你自己电脑上的个人 Agent 助理：自己搭一支固定的助理团队，记得你的事，资料留在你电脑上。
基于 [FastClaw](https://github.com/fastclaw-ai/fastclaw)（只经 `/v1/*` API 调用），自研 Tauri + React 桌面界面和本地任务管家。

> ⚠️ 早期脚手架阶段（阶段 0）：代码均为占位，尚未实测任何端到端功能。“OpenGrok” 是临时代号，与 Oracle OpenGrok 项目及 xAI/Grok 无关，公开发布前会更名。

## 仓库结构
| 路径 | 说明 |
|---|---|
| `apps/desktop` | Tauri 2 + React 桌面壳（占位） |
| `services/task-manager` | 本地任务管家：TypeScript + SQLite（better-sqlite3），含任务/节点/审批/回执/共享记忆表草案 |
| `packages/fastclaw-adapter` | FastClaw 类型化客户端，**只允许 `/v1/*`** |
| `packages/shared-types` | 共享类型，含给闭源 Pro 用的带版本接口（`PRO_INTERFACE_VERSION`） |
| `docs/` | 架构、接口核验表、阶段 0 开发环境 |

## 快速开始
```bash
# 前置：见 docs/phase0-dev-env.md（Node 20、pnpm、Rust、OrbStack、FastClaw v1.4.0）
pnpm install
pnpm lint
pnpm test
cp .env.example .env   # 只填你自己的值；.env 已被 git 忽略
```

## 边界
- Community 绝不依赖闭源 Pro；不装 Pro、无 Jev 凭据也能独立构建和运行。
- 不使用 FastClaw 前端；`/api/*` 内部接口禁止在适配层使用（lint 强制）。
- 默认强制沙箱：`FASTCLAW_SANDBOX_ENFORCE=1`（需 OrbStack/Docker）。

## 许可证
自研代码许可证**待定**（候选 Apache-2.0 / AGPL-3.0），见 [LICENSE](LICENSE)。FastClaw 单独适用 FastClaw Community License，见 [NOTICE](NOTICE)。

---

## English

A personal agent assistant that lives on your own machine: build a fixed team of assistants that remember what matters to you, with your data staying local.
Built on [FastClaw](https://github.com/fastclaw-ai/fastclaw) (via its `/v1/*` API only), with our own Tauri + React desktop app and a local task manager.

> ⚠️ Early scaffold (stage 0): everything is a placeholder; nothing end-to-end is tested yet. "OpenGrok" is a temporary codename, unaffiliated with Oracle's OpenGrok or xAI/Grok, and will be renamed before public launch.

### Layout
| Path | What |
|---|---|
| `apps/desktop` | Tauri 2 + React shell (placeholder) |
| `services/task-manager` | Local task manager, TypeScript + SQLite (better-sqlite3), draft schema for tasks/nodes/approvals/receipts/shared memory |
| `packages/fastclaw-adapter` | Typed FastClaw client, **`/v1/*` only** |
| `packages/shared-types` | Shared types incl. the versioned interface consumed by the closed Pro modules |
| `docs/` | Architecture, interface verification table, stage-0 dev environment |

### Quick start
```bash
# Prereqs: docs/phase0-dev-env.md (Node 20, pnpm, Rust, OrbStack, FastClaw v1.4.0)
pnpm install && pnpm lint && pnpm test
```

### Boundaries
- Community never depends on Pro; it builds and runs without Pro or Jev credentials.
- No FastClaw web UI; FastClaw's internal `/api/*` is banned in the adapter (enforced by lint).
- Sandbox enforced by default: `FASTCLAW_SANDBOX_ENFORCE=1` (requires OrbStack/Docker).

### License
License for our own code is **TBD** (Apache-2.0 or AGPL-3.0); see [LICENSE](LICENSE). FastClaw is separately governed by the FastClaw Community License; see [NOTICE](NOTICE). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md).
