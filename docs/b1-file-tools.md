# B1：文件工具绕过沙箱写宿主机（#7 / #12）

日期：2026-11-02。依据 FastClaw v1.4.0 源码（下文 `FC:` 前缀）和一个只在本地跑、不进仓库的 Go 单测。

## 1. 问题

强制沙箱（`FASTCLAW_SANDBOX_ENABLED=1`、`FASTCLAW_SANDBOX_ENFORCE=1`）只管 `exec`。文件工具按路径分流（`FC:internal/agent/tools/route.go`）：

- 规则 1：`buildinfo.IsHostedDeploy()`（`FASTCLAW_DEPLOY=hosted`）→ 有沙箱就一律进沙箱，没有沙箱就拒绝（`RouteRefuseSuggestSandbox`），**从不**走宿主机。
- 规则 2：本地部署（默认 self-hosted）且有沙箱 → 沙箱优先，但“明确指向宿主”的路径走宿主机 `os.*`（`RouteHostFS`）：`~/Documents|Downloads|Desktop|projects|code|work|src/…`，以及 `/Users/…`、`/home/…` 下的绝对路径（`isExplicitHostScope`，`route.go:136–166`）。

所以默认部署下，模型用 `write_file` / `edit_file` / `read_file` / `list_dir` 能直接读写 Mac 上的 `~/Documents`、`/Users/<u>/…`，沙箱形同虚设（B1）。

各工具实际情况（v1.4.0）：

| 工具 | 本地部署 + 沙箱 | `FASTCLAW_DEPLOY=hosted` + 沙箱 |
|---|---|---|
| `read_file` / `list_dir` | 宿主路径走宿主机（`file.go:1005`、`:1156`） | 进沙箱 |
| `write_file` | 宿主路径写宿主机（`file.go:1084`） | 进沙箱 |
| `edit_file` | 宿主路径读改写宿主机（`file.go:1281`） | 进沙箱 |
| `apply_patch`（沙箱版） | 不经 `route.go`，只写沙箱或工作区存储（`apply_patch.go:623 writeForPatchSandbox`） | 同左 |
| `host_exec` | 只有 `FASTCLAW_ALLOW_HOST_EXEC=1` 才注册（Heybe 从不传） | 即使设了也不注册（`buildinfo.IsHostExecAllowed`） |

本地 Go 单测（临时放进 `internal/agent/tools/`，跑完删除；文件在仓库外 `b1-hosted-route-check_test.go.txt`）：用记录型假 executor，`HOME` 指向临时目录，对 `~/Documents/b1.txt` 和 `$HOME/Documents/b1abs.txt` 调 `write_file` + `edit_file`：

- 不设 `FASTCLAW_DEPLOY`：`~/Documents/b1.txt` 落到宿主机（B1 成立）。
- `FASTCLAW_DEPLOY=hosted`：两个宿主文件都不存在，读写全部记在假 executor 上（进了沙箱）。

## 2. 修法（已实现）

产品里开沙箱时（设置了 `HEYBE_BOXLITE_BIN`），`sandboxGatewayEnv()`（`services/task-manager/src/sandbox.ts`）给 gateway 子进程多传一个环境变量 `FASTCLAW_DEPLOY=hosted`：

- 只是环境变量，经 `buildChildEnv` 的显式 `set`/`extra` 传入；父进程的同名变量被丢弃（`child-env.ts` 白名单里没有它），不能改掉它。
- 不调用任何新的 CLI 或 `/api/*`，Heybe 仍然只用 `/v1` + 已批准的 `agents init` 例外，**不需要 Yang 再批准新例外**。
- 不开沙箱时不设（hosted 无沙箱会让文件工具全部拒绝，而非开沙箱的本地模式本来就不承诺隔离）。

PoC 同样默认 hosted（`boxlite-poc.sh fc_env boxlite`）；`HEYBE_POC_DEPLOY=self-hosted` 可复现修复前的 B1 作对照。

## 3. 副作用（hosted 还会改的东西）

`IsHostedDeploy()` 在 v1.4.0 里的其他用处，逐个看过：

| 位置 | 影响 | 对 Heybe |
|---|---|---|
| `internal/agent/prompt_modules.go:251` | 系统提示里不再介绍 `fastclaw` CLI 管理命令，改为“平台级配置由管理员控制” | 期望的：助理本来就不该让用户去跑 CLI |
| `internal/gateway/userspace.go:196/682` | 没有系统沙箱池时，文件工具限制在工作区目录（路径沙箱） | 开沙箱时有系统池，不走这条 |
| `buildinfo.IsHostExecAllowed` | 永不注册 `host_exec` | 期望的 |
| `internal/setup/handlers_*.go`（日志/工作区在 Finder 打开、配对 host access、`deployMode` 字段） | 只影响 `/api/*` 设置页 | Heybe 不用 `/api/*` |

没有发现对 `/v1/chat/completions`、`/v1/agents`、apikey 鉴权或 `agents init` 的影响；Mac 上仍要实测（见下）。

## 4. 仍然存在的风险

- 用户要把结果文件拿到宿主机，现在只能经工作区存储（相对路径，FastClaw 的工作区目录在 `FASTCLAW_HOME` 下）再由 Heybe 取出；直接写 `~/Documents` 不再可能。这是 v1 预期行为，桌面端交付方式另行设计。
- `web_fetch` 仍在宿主侧发请求（D12），与 B1 无关，风险另记。
- 依赖 FastClaw 内部行为（`route.go` 规则 1）。升级 FastClaw 时要重跑 `t032-runtime-checks.sh` 的 C1。

## 5. 验收

- 单测：`services/task-manager/test/sandbox.test.ts` 断言 gateway 子进程拿到 `FASTCLAW_DEPLOY=hosted`，父进程设 `self-hosted` 也改不掉；`child-env.test.ts` 断言父进程的 `FASTCLAW_DEPLOY` 不被继承。
- 干跑：`scripts/poc/t032-mock-test.sh` 第二轮模拟 hosted，C1a/C1b/C1c 都应是“未落宿主机”。
- **Mac 实测（必须）**：`scripts/poc/boxlite-poc.sh rerun-boxlite` 后跑 `scripts/poc/t032-runtime-checks.sh`，报告头应写“部署模式：hosted”，C1a、C1b、C1c 都是“未落宿主机”，C4 PASS；`verify boxlite` 1–4 全 PASS（确认 hosted 不影响 `/v1` 对话和 exec）。对照：`HEYBE_POC_DEPLOY=self-hosted` 重跑，C1a/C1b 应为“B1 成立”。
