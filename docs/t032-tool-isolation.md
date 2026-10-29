# T0.3.2 静态核验：MCP、浏览器技能、渠道等工具是否在沙箱隔离内

> 关联 #7。对象：FastClaw **v1.4.0（b5ad3dff）** 源码静态阅读，2026-10-28。**未实测**：运行时确认要在 #6（T0.3.1，`FASTCLAW_SANDBOX_ENFORCE=1` + BoxLite，Mac 上 `boxlite-poc.sh`）的环境里做。
> 结论只对 Heybe 目标配置成立：本地自托管、配置了沙箱、`FASTCLAW_SANDBOX_ENFORCE=1`、**不设** `FASTCLAW_ALLOW_HOST_EXEC`。

## 0. 前提：自托管默认不是“沙箱边界”

- `IsSandboxEnforced()` 自托管默认 **false**，只有 `FASTCLAW_SANDBOX_ENFORCE=1/true/yes` 才把沙箱当硬边界（[`buildinfo.go:75–97`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/buildinfo/buildinfo.go#L75-L97)）。默认模式下 exec 在宿主机跑，沙箱只是 `exec(sandbox:true)` 的可选工具（[`loop.go:166–187`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/loop.go#L166-L187)、[`loop.go:225–238`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/loop.go#L225-L238)）。
- 强制模式下，registry 设 `SetSandboxRequired(true)`，拿不到执行器时 exec 拒绝而不是退回宿主机（[`loop.go:179–186`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/loop.go#L179-L186)）。
- `host_exec` 只在 `FASTCLAW_ALLOW_HOST_EXEC=1` 时注册（[`registry.go:955–964`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/registry.go#L955-L964)）。**Heybe 必须不设这个变量。**

## 1. 逐项核验表

“在隔离内”指：执行发生在沙箱执行器（BoxLite/Docker/E2B）里，文件与网络受沙箱约束。

| # | 工具 / 入口 | 在不在隔离内 | 证据（v1.4.0） | Heybe 处理 |
|---|---|---|---|---|
| 1 | `exec` / `bash` 类 | **在**（强制模式） | `SetExecutor` 换成 `registerSandboxedExec`（[`registry.go:955–961`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/registry.go#L955-L961)）；沙箱缺失时只给提示、不回退宿主机（[`exec.go:495–530`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/exec.go#L495-L530)） | 待 #6 实测 |
| 2 | 文件工具 `read_file`/`write_file`/`list_dir`/`apply_patch` | **部分**：默认路径进沙箱；**显式宿主机路径**（`~/Documents`、`~/Downloads`、`~/Desktop`、`~/projects`、`~/code`、`~/work`、`/Users/<u>/…`、`/home/<u>/…`）走 `RouteHostFS` 直接读写宿主机 | [`route.go:96–110`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/route.go#L96-L110) “local with sandbox → sandbox-first … Host disk is reachable only via explicit host-scope paths”；`isExplicitHostScope` 同文件 | **阻塞项 B1** |
| 3 | 工作区产物（相对路径如 `report.md`）、身份文件（`MEMORY.md` 等） | **不在沙箱内，但在 FastClaw 自己的存储里**（`RouteWorkspaceStore`/`RouteSystemStore`，优先于沙箱判断） | [`route.go:72–83`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/route.go#L72-L83) | 可接受（这是产物取回的通道，见 #8）；`MEMORY.md` 跨会话共享见 T0.4.1 §2 |
| 4 | 浏览器技能（`camoufox-cli`） | **跟随 exec**：没有独立浏览器工具，经 `exec` 调用 camoufox 守护进程（[`exec.go:84`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/exec.go#L84)、[`delegate.go:29–52`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/delegate.go#L29-L52)）。强制模式下在沙箱内；镜像里必须预装 | 第 1 行；待 #6 实测沙箱镜像是否带 camoufox |
| 5 | `web_fetch` | **不在**：在 gateway 进程里发请求。有 SSRF 防护（拒私网、回环、链路本地、CGNAT，拨号时检查，限重定向，[`web_fetch.go:29–104`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_fetch.go#L29-L104)），但出网不受沙箱网络策略约束 | 同左 | 可接受为“只读出网”，**风险**：能把会话内容带到任意公网 URL（GET 参数外传）。D3 先用它做网页抓取，见 `docs/design/t051-web-report.md` |
| 6 | `web_search` | **不在**：gateway 进程调外部搜索提供方（exa/brave/searxng，[`web_search.go:12–36`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/web_search.go#L12-L36)） | 同左 | v1 不配置搜索提供方（D3） |
| 7 | MCP（stdio） | **不在**：`exec.Command` 在**宿主机**起子进程，`Env = os.Environ()` 全量继承，再追加配置里的 env，`$VAR` 形式还会从宿主机环境展开（[`mcp/stdio.go:37–47`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/mcp/stdio.go#L37-L47)）；对比 exec 工具会走 `scrubSensitiveEnv`（[`env_scrub.go:89–111`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/agent/tools/env_scrub.go#L89-L111)），MCP 没走 | 同左 | **阻塞项 B2** |
| 8 | 插件进程（`internal/plugin`） | **不在**：宿主机 `exec.CommandContext`，未设 `cmd.Env` 即继承全部环境（[`plugin/process.go:62–69`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/plugin/process.go#L62-L69)） | 同左 | v1 不装插件；**阻塞项 B2** 同类 |
| 9 | 技能安装（`install_skill` / clawhub） | **不在**：宿主机起进程装到技能目录（[`skills/clawhub.go:104`](https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/internal/skills/clawhub.go#L104)） | 同左 | 已在 #67 告警名单；v1 禁止对话内装技能 |
| 10 | 渠道（telegram/discord/slack/whatsapp/line/imessage/wechat/feishu/wecom） | **不在**：在 gateway 进程里跑；iMessage 直接读宿主机 `chat.db`（需完全磁盘访问，`channels/imessage.go`）；IM 消息直接进 Agent，不经 Heybe（T0.4.3 §4） | 同左 | v1 不开渠道（Telegram 推到 v1.1）；**阻塞项 B3**（开渠道前） |
| 11 | 定时（`create_cron_job` 等） | **不在沙箱语义内**：调度器在 gateway 里，触发后的回合再按 1–2 行进沙箱 | T0.4.3 §3 | 告警 + Heybe 做唯一计时者 |
| 12 | 子 Agent（`delegate_task` / `spawn_subagent`） | **源码看共享父沙箱**（`delegate.go` 注释 “share the single sandbox”）；`spawn_subagent` 进另一个 Agent 自己的配置 | T0.4.4 §1 | 已告警；待 #6 实测 |
| 13 | `image_gen` / `tts` / 连接器（`connectors.go`） | **不在**：gateway 进程调外部 API | 同左 | v1 不配置 |

## 2. 不在隔离内 → 阻塞项

| 编号 | 内容 | 解除条件 |
|---|---|---|
| **B1** | 强制沙箱下，文件工具对“显式宿主机路径”仍直通宿主机读写（`~/Documents` 等） | 上游无开关。选项：① gateway 以独立低权限用户运行、HOME 指向空目录，让这些路径不存在/无权限；② 在 Mac 上用 BoxLite/Lima 把 **整个 gateway** 放进虚机（#6 方案）；③ 上游提案加开关。#6 实测前**不得**对外宣称“文件已隔离” |
| **B2** | MCP / 插件子进程在宿主机运行且继承 gateway 全部环境变量 | v1 不启用 stdio MCP 与插件；Heybe 启 gateway 时只传白名单环境变量（安全跟进 PR）；以后需要 MCP 时由 Heybe 受控 MCP 提供 |
| **B3** | 渠道在宿主机进程内、绕过 Heybe | v1 不开；v1.1 Telegram 走 Heybe 自建桥（方案 C） |

`web_fetch` 出网（第 5 行）不列阻塞：只读、有 SSRF 防护、v1 需要它；记为风险，写进用户说明。

## 3. 待 #6 一起实测的清单

- [ ] 强制模式 + BoxLite：`exec` 写的文件不出现在宿主机、`exec` 不能访问宿主机 `~`
- [ ] 文件工具写 `~/Documents/heybe-probe.txt`：预期**落到宿主机**（验证 B1）
- [ ] 沙箱镜像内有无 `camoufox-cli`
- [ ] `delegate_task` 子 Agent 的命令在父沙箱内
- [ ] 不设 `FASTCLAW_ALLOW_HOST_EXEC` 时工具列表里没有 `host_exec`
