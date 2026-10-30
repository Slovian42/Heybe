# Heybe 沙箱方案评估（终端用户免装 Docker / OrbStack）

> 状态：草案 · 2026-10-22 · 适用 FastClaw v1.4.0（tag commit `b5ad3dff1f230d692e4e1d5ad9ce486f24749964`）
> 目标：Heybe 首发 macOS，沙箱默认强制开启，终端用户不需要另装 Docker Desktop 或 OrbStack。
> 约定：查不到可靠来源的写「待核实」，需要上机测的写「待实测」。
> 2026-10-30 更新：v1 安装包只出 arm64（Apple 芯片 Mac，M1 及以上），Intel Mac 不支持（`v1-scope.md` D10 10-30 更正，Yang 拍板，经 Grok Bot 转达）。下文关于 Intel Mac 的段落只作调研记录，不再是待办；Lima 仍是 Apple 芯片上 BoxLite 的备选。

源码链接前缀：`https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/`（下文简写为 `FC:`）。

---

## 0. 结论先行

**推荐：BoxLite（本地内嵌 micro-VM）作为正式方案，Docker 兼容 socket 作为开发期和过渡期的后备。**

1. FastClaw v1.4.0 已经内置了 `boxlite` 后端（`FC:internal/sandbox/boxlite_executor.go`）。BoxLite 是 Apache-2.0 协议，基于 libkrun 和 Hypervisor.framework，每个沙箱是一台带独立内核的 micro-VM，能直接跑 OCI 镜像，并提供本地 REST 服务（`boxlite serve`，默认只监听 127.0.0.1:8100）。这条路基本不用改 FastClaw，也不需要 Docker。
2. 风险点：FastClaw 的 boxlite 客户端依赖 WebSocket attach 接口来流式返回 exec 输出。BoxLite 文档提到「reference server」没有实现 WS 流式端点，要实测本地 `boxlite serve` 能不能和 FastClaw 跑通（见 §6）。如果跑不通，就由 Heybe 自己写一个小 shim，补上 FastClaw 需要的那几个 REST/WS 接口。
3. 后备方案：用 Lima（vz）或 vfkit 起一台内置 VM，VM 里跑 containerd/nerdctl 或 podman，对外暴露 Docker 兼容 socket，再把 `DOCKER_HOST` 交给 FastClaw。FastClaw 的 docker 后端调用的是 `docker` **CLI 二进制**，不是 Go SDK，所以 Heybe 还要一并打包 docker CLI（Apache-2.0）。
4. 不推荐把以下方案作为面向用户的默认方案：
   - 要求用户自装 Docker Desktop / OrbStack：两者商用都要付费，安装门槛也高。
   - 只用 sandbox-exec：已被标记为废弃，而且 FastClaw 没有对应后端。
   - gVisor：不能在 macOS 宿主上直接运行。
   - WASM：跑不了 FastClaw 的沙箱镜像（python、node、camoufox）。
5. Apple Containerization（apple/container）的隔离模型最理想，但只支持 macOS 26 和 Apple Silicon，适合作为长期的可选后端，不适合首发。

---

## 1. FastClaw v1.4.0 沙箱的实际实现（源码核实）

| 问题 | 结论 | 依据 |
|---|---|---|
| `FASTCLAW_SANDBOX_ENFORCE` 的行为 | 托管部署（hosted）总是强制。自托管默认**不强制**，只有这个变量设为 `1`、`true` 或 `yes` 时才强制，每次调用时读取。强制时，所有 exec 和文件工具都锁在沙箱里，并且禁止回退到宿主 shell（`registry.SetSandboxRequired(true)`）；沙箱不可用就直接报错，不会偷偷在宿主上执行。不强制时，沙箱只是一个可选工具（`exec` 带 `sandbox:true` 参数时才进沙箱），默认在宿主执行。另外，`host_exec` 这个逃生工具默认关闭，只有设置 `FASTCLAW_ALLOW_HOST_EXEC` 才会注册。 | `FC:internal/buildinfo/buildinfo.go`（`IsSandboxEnforced` 约第 75–97 行，`IsHostExecAllowed` 约第 54 行起）；`FC:internal/agent/loop.go`（约第 166–190 行、第 361 行、第 4111 行）；`FC:internal/agent/tools/exec.go`（约第 505–530 行） |
| 强制模式还需要什么 | 还需要 `FASTCLAW_SANDBOX_ENABLED`，即 `rc.Sandbox.Enabled && IsSandboxEnforced()`。Heybe 需要同时设置 `FASTCLAW_SANDBOX_ENABLED=1` 和 `FASTCLAW_SANDBOX_ENFORCE=1`。 | `FC:internal/agent/loop.go:361`；`FC:internal/config/env.go`（约第 54–61 行、第 120–140 行） |
| Docker API 还是可插拔 runtime | **可插拔**。`Executor` / `ExecutorPool` 接口有三个实现：`docker`、`e2b`、`boxlite`，用 `FASTCLAW_SANDBOX_BACKEND` 选择，默认是 docker。接口注释里也提到可以接 Firecracker 等后端。 | `FC:internal/sandbox/executor.go`；`FC:internal/config/env.go:55`；`FC:internal/gateway/userspace.go`（约第 120–160 行，按 backend 选择执行器池） |
| docker 后端怎么调用 | 不用 Docker Go SDK，而是 `exec.Command("docker", ...)` **调用 docker CLI**，包括 `create`、`start`、`exec`、`port`、`rm -f`。容器参数有：`--label fastclaw=sandbox`；`-v <workspace>:/workspace:rw`；skills 只读挂载；`--cpus` / `--memory` / `--network` 取自 Policy；端口只绑定到 `127.0.0.1`；`--add-host host.docker.internal:host-gateway`；启动命令是 `tail -f /dev/null`。 | `FC:internal/sandbox/docker.go`（`Create` 约第 198–365 行，`Exec` 约第 407 行）；`FC:internal/sandbox/docker_executor.go`；`FC:cmd/fastclaw/cmd_sandbox.go`（第 49、64、79 行） |
| 能否指定 docker host/socket | FastClaw 自己**没有**相关配置项，源码里没有 `DOCKER_HOST`。但它调用 docker CLI 时没有覆盖 `cmd.Env`，子进程会继承父进程的环境变量，所以给 FastClaw 进程设置 `DOCKER_HOST=unix:///…/heybe.sock`（或 `DOCKER_CONTEXT`）就能把它指向任意 Docker 兼容 socket。前提是 PATH 里能找到 `docker` 可执行文件。这一点是从源码推断的，**待实测**。 | `FC:internal/sandbox/docker.go`（全文没有 `cmd.Env` 赋值）；docker CLI 环境变量说明：https://docs.docker.com/reference/cli/docker/#environment-variables |
| 网络策略 | `Policy{NetMode: cfg.Network}`，可选 `none`、`host`、`bridge`。不设置就用 Docker 默认的 bridge（能访问外网）。Heybe 应该显式设置。 | `FC:internal/sandbox/docker.go:18-22`；`FC:internal/gateway/userspace.go:147`；`FC:internal/config/config.go:208` |
| boxlite 后端 | 走 REST 加 WebSocket：`POST /{prefix}/boxes` → `start` → `PUT files`（上传 tar）→ `POST exec` → `GET …/attach`（WS 流式返回）→ `DELETE`。URL 用 `FASTCLAW_SANDBOX_BOXLITE_URL` 配置（默认是 BoxLite Cloud 的 dev 地址），鉴权是 `BOXLITE_API_KEY`（Bearer），默认镜像 `thinkany/fastclaw-sandbox:latest`。把 URL 指向本地 `http://127.0.0.1:8100/v1` 即可。 | `FC:internal/sandbox/boxlite_executor.go`（文件头注释和常量，约第 22–60 行）；`FC:internal/config/config.go:192-207`；`FC:internal/config/env.go:58-61,135-140` |
| MCP 是否在沙箱内 | **不在**。stdio 类型的 MCP server 在**宿主**上用 `exec.Command` 直接启动，而且继承完整的 `os.Environ()`，所有宿主环境变量（包括密钥）都会传给 MCP 子进程。`internal/mcp/` 里没有任何和 sandbox 相关的代码。 | `FC:internal/mcp/stdio.go`（约第 36–47 行） |
| 浏览器工具是否在沙箱内 | v1.4.0 没有独立的原生浏览器工具（仅凭 grep 判断，**待核实**）。浏览器能力靠沙箱镜像里预装的 `camoufox-cli`，通过 exec 调用，所以强制模式下浏览器跑在沙箱**内**。不强制时，如果模型不加 `sandbox:true`，就会去调用宿主上的程序。 | `FC:internal/agent/skills.go:394`（系统提示里列出镜像预装的 python、node、camoufox-cli 等）；`FC:internal/agent/tools/registry.go:763` |
| 许可证 | FastClaw Community License 1.0（在 Apache-2.0 基础上增加了条款），具体限制见仓库 LICENSE。 | `FC:LICENSE` |

**对 Heybe 的影响**
- 不管选哪个方案，最终都要给 FastClaw 提供以下二者之一：(a) 可执行的 `docker` CLI 加上 Docker 兼容 socket；(b) 一个兼容 BoxLite REST/WS 协议的本地端点。
- MCP 不受沙箱保护。Heybe 需要另外处理：只允许白名单里的 MCP、启动时清理环境变量，或者把 MCP 放进沙箱 VM 里运行（需要改 FastClaw 或加一层包装）。这一点要写进安全设计。
- 沙箱镜像里有 Camoufox/Firefox，体积比较大（具体大小**待实测**），首次下载需要做进度提示，也可以考虑随安装包预置。

---

## 2. 方案详评

### 方案 1：macOS 自带机制

**1a. sandbox-exec / Seatbelt（SBPL 配置文件）**
- 隔离：文件和网络可以按路径、按端口细粒度控制。进程跑在同一个内核上，没有内核级隔离，内核漏洞可以直接逃逸。
- 体积和启动：0 MB，毫秒级启动。
- 许可：系统自带。
- 系统要求：Apple Silicon 和 Intel 都支持。`sandbox-exec` 的 man page 标注为 deprecated，但目前仍然可用；Chromium、Bazel、Codex CLI 等都在用它。来源：man sandbox-exec（`man 1 sandbox-exec`）；Chromium 的 Mac 沙箱设计文档 https://chromium.googlesource.com/chromium/src/+/HEAD/sandbox/mac/README.md 。Apple 什么时候移除它**待核实**。
- 签名和 entitlement：不需要特殊 entitlement。
- FastClaw 兼容：**没有对应后端**。而且 FastClaw 的沙箱语义是「Linux 镜像加 /workspace 挂载」，镜像里的 Linux 工具链在 macOS 上没法直接用。要用的话，得新写一个「host+seatbelt」执行器，并且放弃镜像里预装的工具。
- 工作量：中到高（要 fork 或给上游提 PR 新增 executor，还要维护 SBPL 规则）。
- 定位：适合作为**纵深防御的第二层**，比如包住 VM 辅助进程或 MCP 子进程（BoxLite 本身也会叠加 sandbox-exec，见 §2 方案 2a），不适合作为主沙箱。

**1b. App Sandbox 与子进程继承**
- App 开启 `com.apple.security.app-sandbox` 之后，子进程会继承沙箱，文件访问只能限制在容器目录和用户授权的范围内。来源：https://developer.apple.com/documentation/security/app-sandbox ；子进程继承说明见 https://developer.apple.com/documentation/xcode/embedding-a-helper-tool-in-a-sandboxed-app 。
- 问题：FastClaw 作为本地守护进程需要自由读写 `FASTCLAW_HOME`、启动 VM，在 App Sandbox 下和 Virtualization.framework 的组合能不能用、限制有哪些，**待核实**。同时它也不提供 Linux 运行环境。
- 定位：Heybe 不上架 Mac App Store、走 Developer ID 分发的话，可以不开启。可以以后再评估是否给 Tauri 主进程开启。

**1c. Endpoint Security**
- 这是给安全软件用的系统级监控和拦截 API，需要 Apple 特批的 `com.apple.developer.endpoint-security.client` entitlement，以及用户的完全磁盘访问授权。来源：https://developer.apple.com/documentation/endpointsecurity 。
- 它本身不提供隔离，只能做审计。申请门槛高，不适合消费级助理。**不采用**。

### 方案 2：基于 Virtualization.framework / Hypervisor.framework 的内置轻量 Linux VM

这一类方案的共性：
- 签名：需要 `com.apple.security.virtualization`（Virtualization.framework）或 `com.apple.security.hypervisor`（Hypervisor.framework，libkrun 用这个）entitlement，用 Developer ID 签名并经过公证。这两个 entitlement 不需要 Apple 特批，自己声明即可。来源：https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.virtualization ；https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.security.hypervisor 。
- 隔离：独立内核，文件只能看到显式共享的目录（virtiofs），网络可以在宿主侧控制。强度和 Docker Desktop 的 VM 边界相当，或者更强。

**2a. BoxLite（libkrun）【推荐】**
- 是什么：嵌入式 micro-VM 运行时，每个 box 一台 VM，能跑任意 OCI 镜像，数据可以持久化（QCOW2 写时复制）。支持出网白名单 `allow_net` 和密钥占位符注入（真实值不进 VM），还会叠加 seccomp 或 sandbox-exec 作为 OS 层沙箱。可以作为库嵌入（不需要守护进程），也可以用 `boxlite serve` 起本地 REST 服务。来源：https://github.com/boxlite-ai/boxlite ；https://github.com/boxlite-ai/boxlite/blob/main/docs/architecture/README.md
- 系统和芯片：macOS 12 以上，**仅支持 Apple Silicon**，Intel Mac 标注为「Coming soon」。来源：https://docs.boxlite.ai/getting-started/installation
- 许可：Apache-2.0，可以捆绑进闭源商业分发（保留 NOTICE 即可）。它依赖的 libkrun 和 libkrunfw 的许可证**待核实**：libkrun 是 Apache-2.0，libkrunfw 里打包了 Linux 内核，属于 GPL-2.0，作为独立组件分发时要提供对应源码。
- 体积和启动：官方宣称「light enough to embed on your laptop」，具体安装体积和冷启动时间**待实测**。libkrun 类 micro-VM 通常是亚秒级到 1 秒级启动，这一点也待实测。
- FastClaw 兼容：**原生支持**（`FASTCLAW_SANDBOX_BACKEND=boxlite`）。风险是 BoxLite 文档写着「reference server 未实现 WS 流式端点」，而 FastClaw 依赖 `…/attach` WS（来源：https://docs.boxlite.ai/guides/agent-service-endpoint 故障表）。`boxlite serve`（Rust CLI 自带的服务端）是否实现了 WS，**待实测**。另外，FastClaw 用的 path prefix 是 `default`，和 BoxLite reference server 的 `/v1/{prefix}/boxes` 一致。
- 签名：需要 `com.apple.security.hypervisor`，具体以 BoxLite 的 macOS 打包说明为准，**待核实**。
- 工作量：低到中。如果 serve 能直接兼容，约 1–2 人周，主要是打包、签名、启动管理、镜像预取。如果要写 shim，再加 1–2 人周。

**2b. Lima（vz 驱动）**
- 用 Virtualization.framework 起 Linux VM，默认带 containerd 和 nerdctl，也有 Docker 模板，可以把 socket 转发到宿主。来源：https://lima-vm.io/docs/config/vmtype/ ；https://github.com/lima-vm/lima 。
- 许可：Apache-2.0。系统要求：vz 需要 macOS 13 以上，Apple Silicon 和 Intel 都支持（来源同上，具体版本**待核实**）。
- 体积和启动：Lima 二进制约几十 MB，再加 VM 镜像几百 MB，冷启动通常是十几到几十秒，**待实测**。
- FastClaw 兼容：走 docker 后端，设置 `DOCKER_HOST` 并捆绑 docker CLI。nerdctl 不是 Docker API，所以 VM 里要跑 dockerd（Moby，Apache-2.0）或 podman 的 Docker 兼容 API。
- 隔离：所有会话共用一台 VM，容器之间靠 namespace 隔离，比 BoxLite 的「每会话一台 VM」弱一些。
- 工作量：中，约 2–3 人周，包括 VM 生命周期、socket 转发、镜像预置、升级。

**2c. vfkit**
- 一个很小的 Virtualization.framework 命令行封装，podman machine 在 macOS 上用的就是它。Apache-2.0。来源：https://github.com/crc-org/vfkit 。
- 只负责启动 VM，guest 系统、容器引擎、socket 转发都得自己做，比 Lima 更底层。工作量中到高。系统要求 macOS 11 以上（**待核实**）。

**2d. Apple Containerization / apple/container**
- 每个容器一台轻量 VM，Swift 实现，Apache-2.0。来源：https://github.com/apple/container ；https://github.com/apple/container/blob/main/docs/technical-overview.md
- 系统要求：**Apple Silicon，官方只支持 macOS 26**。macOS 15 能跑，但网络功能受限，官方不修相关问题。
- FastClaw 兼容：它不提供 Docker 兼容 API（是否有兼容层**待核实**），需要新写一个 executor，或者用 Containerization Swift 包做一个 Docker API shim。工作量高。
- 定位：隔离模型最好，又是系统一方组件，但首发时用户的系统版本覆盖面不够。适合作为阶段 3 的可选后端。

**2e. krunkit / libkrun（不经过 BoxLite 直接使用）**
- krunkit 是 libkrun 的 vfkit 风格命令行，podman machine 的 libkrun provider 用的就是它，支持 GPU（Venus）。Apache-2.0。来源：https://github.com/containers/krunkit ；https://github.com/containers/libkrun 。
- 只支持 Apple Silicon。比 BoxLite 更底层，FastClaw 没有对应后端。已经有 BoxLite 的情况下没必要直接用。

**2f. Colima**
- 基于 Lima 的 Docker/containerd 一键环境，MIT 许可。来源：https://github.com/abiosoft/colima 。
- 适合开发者，但它本身依赖 Lima 和 docker CLI，捆绑进产品相当于方案 2b 再多一层封装，没有额外价值。

### 方案 3：要求用户自装 Docker Desktop 或 OrbStack

- **Docker Desktop**：个人、教育、非商业开源项目和小企业（员工少于 250 人**且**年收入低于 1000 万美元）免费；超出范围的商业使用必须订阅，Pro 每用户每月 9 美元（年付），Team 15 美元，Business 24 美元。来源：https://docs.docker.com/subscription-billing/desktop-license/ ；https://www.docker.com/pricing/
- **OrbStack**：个人非商业使用免费；自由职业、企业、非营利和政府使用都要按用户购买许可，每用户每月 8 美元（年付 96 美元），试用期 30 天。来源：https://orbstack.dev/pricing ；https://docs.orbstack.dev/licensing
- 两者都**不能捆绑**进 Heybe 分发，只能让用户自己装、自己承担许可费用。
- FastClaw 兼容：开箱即用，因为它是为 Docker 后端设计的。隔离强度是 VM 加容器。
- 定位：只作为**开发期**环境（Yang 的 Mac 已经装了 OrbStack，Slovian Inc 商用需要买 Pro 许可），以及高级用户自选的「使用已有 Docker」选项。

### 方案 4：其他

- **gVisor**：用户态内核，只能运行在 Linux 宿主上，不支持 macOS 宿主。来源：https://gvisor.dev/docs/ 。在 macOS 上只能放进 VM 里，作为 VM 内容器的 runtime（runsc）再加一层，属于纵深防御，不能替代 VM。许可 Apache-2.0。
- **WASM（Wasmtime / WasmEdge + WASI）**：启动快、体积小、能力模型严格。来源：https://wasmtime.dev/ 。但它跑不了 FastClaw 沙箱镜像里的 python、node、Firefox 等原生 Linux 程序，和 FastClaw「执行任意 shell 命令」的模型不兼容。只适合将来做受限插件或技能。
- **E2B / BoxLite Cloud（远程沙箱）**：FastClaw 原生支持（`e2b` 和 `boxlite` 后端）。本地不需要任何虚拟化，但用户文件要上传到云端，和「本地助理、隐私优先」的定位冲突，而且有运营成本。可以作为 Intel Mac 或无法开启虚拟化的机器的**付费兜底**，留给 Pro 版考虑。

---

## 3. 对比表

| 方案 | 文件隔离 | 网络隔离 | 进程/内核隔离 | 安装体积 / 启动 | 许可（可否捆绑闭源） | 系统 / 芯片 | 签名 entitlement | FastClaw 兼容 | 工作量 |
|---|---|---|---|---|---|---|---|---|---|
| 1a sandbox-exec | 中（按路径） | 中 | 弱（共享内核） | 0 / 毫秒 | 系统自带 | 全部 Mac；已废弃 | 无 | ✗ 需新 executor，且失去 Linux 镜像 | 中到高 |
| 1b App Sandbox | 中 | 中 | 弱 | 0 | 系统自带 | 全部 | app-sandbox | ✗ | 高（待核实可行性） |
| 1c Endpoint Security | 仅审计 | 仅审计 | 无 | — | 需特批 | 全部 | ES 特批 | ✗ | 高 |
| **2a BoxLite** | 强（只共享指定目录） | 强（allow_net 白名单） | **强（每个 box 独立内核）** | 待实测 / 待实测（预计秒级） | Apache-2.0 ✓（libkrunfw 是 GPL 内核，需提供源码，待核实） | macOS 12+，**仅 Apple Silicon** | hypervisor（待核实） | **✓ 原生后端**（WS 接口待实测） | 低到中 |
| 2b Lima vz + dockerd | 强 | 中到强 | 强（共享一台 VM，容器之间是 namespace） | 几百 MB / 十几秒级（待实测） | Apache-2.0 ✓（再加 Moby/CLI，Apache-2.0） | macOS 13+，两种芯片都支持（待核实） | virtualization | ✓ docker 后端加 DOCKER_HOST | 中 |
| 2c vfkit | 强 | 自建 | 强 | 小 + 自建镜像 | Apache-2.0 ✓ | 待核实 | virtualization | ✓（需自建 Docker API） | 中到高 |
| 2d apple/container | 强 | 强 | 强（每个容器一台 VM） | 待实测 | Apache-2.0 ✓ | **macOS 26 + Apple Silicon** | virtualization | ✗ 需新 executor 或 shim | 高 |
| 2e krunkit/libkrun | 强 | 自建 | 强 | 小 | Apache-2.0 ✓ | 仅 Apple Silicon | hypervisor | ✗ | 高 |
| 2f Colima | 同 2b | 同 2b | 同 2b | 同 2b | MIT ✓ | 同 Lima | virtualization | ✓ | 中（无额外价值） |
| 3 Docker Desktop / OrbStack | 强 | 中 | 强 | 用户自装约 1–2 GB / 秒级 | ✗ 不可捆绑；商用要付费 | 两种芯片都支持 | 不涉及 | ✓ 开箱即用 | 低（但用户门槛高） |
| 4 gVisor | — | — | — | — | Apache-2.0 | ✗ 无 macOS 宿主 | — | 仅能放在 VM 里 | — |
| 4 WASM | 强 | 强 | 强（能力模型） | 小 / 毫秒 | 多为 Apache-2.0 | 全部 | 无 | ✗ 跑不了镜像 | 高 |
| 4 E2B / BoxLite Cloud | 强（在云端） | 强 | 强 | 0 本地 | 服务条款 | 全部（含 Intel） | 无 | ✓ 原生 | 低（有隐私和成本问题） |

---

## 4. 推荐与理由

**主方案：内置 BoxLite（`FASTCLAW_SANDBOX_BACKEND=boxlite`，URL 指向 Heybe 自己管理的本地 `boxlite serve`）**
- 理由一：用户零依赖，许可干净（Apache-2.0），可以捆绑进闭源 Pro 分发。
- 理由二：每个会话一台 micro-VM，隔离强度高于「共享 VM + 容器」，符合「沙箱默认强制」的定位；`allow_net` 和密钥占位符也正好满足助理场景。
- 理由三：FastClaw v1.4.0 已经有这个后端，Heybe 不需要 fork FastClaw。
- 代价：首发只支持 Apple Silicon。（10-30 已定：v1 不支持 Intel Mac，只出 arm64 包，不为 Intel 做兜底。）

**后备方案：Lima（vz）+ dockerd + 捆绑 docker CLI，通过 `DOCKER_HOST` 交给 FastClaw**
- 如果 BoxLite 实测在 WS、稳定性或体积上过不了关，就切到这个方案。（它技术上也能覆盖 Intel Mac，但 v1 不支持 Intel，只在 Apple 芯片上用作备选。）

**通用要求（与选哪个方案无关）**
- Heybe 启动 FastClaw 时固定设置 `FASTCLAW_SANDBOX_ENABLED=1`、`FASTCLAW_SANDBOX_ENFORCE=1`，**不设置** `FASTCLAW_ALLOW_HOST_EXEC`，网络策略显式配置。
- MCP 不在沙箱内，需要单独做白名单和环境变量清理，或者另外设计隔离方式。

## 5. 分阶段落地路径

| 阶段 | 内容 | 产出 |
|---|---|---|
| 0（现在，开发） | 开发者使用 OrbStack 和 docker 后端（已经写在 phase0-dev-env.md）。Slovian Inc 需要购买 OrbStack Pro 许可。 | 开发环境 |
| 1（2 周内，PoC） | 在 Apple Silicon Mac 上跑 `boxlite serve`，再用 FastClaw v1.4.0 的 boxlite 后端完整跑一遍：exec 流式输出、文件读写、camoufox、端口预览。同时用 Lima vz + dockerd 做对照测试。 | 实测报告，以及选型定稿 |
| 2（里程碑内，打包） | Tauri sidecar 管理 boxlite（或 Lima）的生命周期；Developer ID 签名、hypervisor/virtualization entitlement、公证；首次运行时下载并预取沙箱镜像，带进度提示；系统和芯片检测（只出 arm64 包；Intel Mac 不支持，不做 x64 后备分支）。 | 可公证的 .dmg |
| 3（之后） | MCP 放进沙箱运行；用 sandbox-exec 再包一层 VM 辅助进程；评估 apple/container 作为 macOS 26 的可选后端；Pro 版提供云沙箱兜底。 | 纵深防御，覆盖更多机型 |

## 6. 待实测 / 待核实清单

1. 本地 `boxlite serve` 是否实现了 FastClaw 需要的全部接口，特别是 `GET …/executions/{id}/attach` WebSocket 和 `PUT …/files`（上传 tar）。
2. BoxLite 在 macOS 上的安装体积、冷启动和热启动时间、空闲内存占用；VM 内 `thinkany/fastclaw-sandbox` 镜像的大小和首次拉取耗时。
3. BoxLite macOS 打包需要的 entitlement（hypervisor？），以及能否放进 Tauri .app 后正常签名和公证。
4. libkrun 和 libkrunfw（内核 GPL-2.0）在闭源分发中的合规做法。
5. 给 FastClaw 进程设置 `DOCKER_HOST` 后，docker 后端能否指向 Lima 或 podman 的 socket（源码推断可以，待实测）；podman 兼容 API 对 `docker port` 和 `--add-host host-gateway` 的支持情况。
6. Lima vz 的最低系统版本、冷启动时间、安装体积（Apple 芯片；Intel 不再测，v1 不支持）。
7. apple/container 有没有 Docker API 兼容层；macOS 15 下的实际限制。
8. App Sandbox 和 Virtualization.framework、本地守护进程能否共存。
9. `sandbox-exec` 在 macOS 26 上的状态，以及 Apple 有没有移除计划。
10. FastClaw v1.4.0 有没有沙箱外的原生浏览器工具（目前只看到 camoufox-cli 跑在镜像内）。
11. FastClaw Community License 的附加条款对把 FastClaw 和 BoxLite 一起捆绑分发有没有限制（需要法务看 `FC:LICENSE` 全文）。
