# #19 T1.3.1 Tauri 壳 + React 流式聊天

PR #83 覆盖拆分文档 `docs/design/phase1-split-19-16.md` 中的 19-a、19-b、19-c（菜单栏图标除外）、19-d、19-e、19-f（纯文本安全渲染）。

## 结构

```
React（apps/desktop） --POST /chat/sessions/:id/messages (SSE)--> Heybe 本地服务（services/task-manager，仅 127.0.0.1）
                                                                 --/v1/chat/completions (SSE)--> FastClaw gateway
```

- 前端只连本地服务，不连 FastClaw，不加载 FastClaw `web/`；CSP 只允许 `self` 与 `http://127.0.0.1:*`。
- 服务端事件：`delta` / `tool`（running/done）/ `done` / `error`（interrupted=中断，结果未知；failed=没做成；unavailable），总以 `data: [DONE]` 结束。错误不透传上游原文。
- 会话键 `heybe:chat:<id>`。停止 = 前端断开 → 服务立刻断开上游；状态显示“已停止（服务端是否停止未知）”，下一轮前提示上一轮可能仍被补完（v1.4.0 无 /v1 stop，#9）。
- 告警工具（界面上标“需要留意”）= `FASTCLAW_ALERT_TOOLS`（`packages/shared-types/src/chat.ts`，前端与任务服务共用一份）：
  - 来自 #67（Agent 管理类）：`create_agent` `configure_agent` `check_agent` `delete_agent` `spawn_subagent` `delegate_task` `install_skill`；
  - 来自 `docs/t043` §3（定时任务）：`create_cron_job` `delete_cron_job`。
  - 第一部分里的旧名单（`web_fetch`、`exec` 等）没有出处，已删除。
- 关窗 = 隐藏窗口，点 Dock 图标恢复；Cmd+Q 退出。开机自启默认关（D9，本 PR 不加登录项）。

## 19-b 本地服务与进程管理

```
Tauri 壳（src-tauri/src/service.rs，Supervisor）
  └─ 独立进程组：Heybe 本地服务（services/task-manager/src/main.ts）
        └─ FastClaw gateway（HEYBE_FASTCLAW_GATEWAY_BIN，环境变量走白名单，不带模型密钥）
```

- 壳每次启动生成 64 位十六进制随机令牌，服务监听 `127.0.0.1` 随机端口（`HEYBE_SERVICE_PORT=0`），就绪时在标准输出打一行 `HEYBE_SERVICE_READY {"port":N}`（不含令牌）。
- 前端只通过 Tauri 命令 `service_info` 拿 `{status,url,token}`，请求带 `Authorization: Bearer`；除 `GET /health` 外没令牌一律 401（常量时间比较）。
- gateway 用 `fastclaw gateway --port $FASTCLAW_PORT` 前台子命令启动，stdin 指向 `/dev/null`，**不需要 TTY**（从 Dock/Finder 启动也行）。以前直接跑无子命令的 `fastclaw`：FastClaw v1.4.0 根命令把 `/dev/null` 当成交互终端（`cmd/fastclaw/main.go` 的 `RunE` + `cmd_chat.go` 的 `isInteractiveTerminal` 只看是不是字符设备），于是走聊天：先拉起一个后台 daemon（服务退出后还留着），再开 TUI，因为没有 `/dev/tty` 报 `could not open a new TTY: open /dev/tty: device not configured` 退出，服务跟着退出、被壳重启，循环。无 TTY 复现/验证：`FASTCLAW_BIN=… scripts/dev/gateway-notty-check.sh`（新会话 = 没有控制终端；Linux 用 `setsid`，macOS 用 perl `POSIX::setsid`）。
- 服务启动时先拉起 gateway 并等 `/healthz`（默认最长 30 秒，`HEYBE_FASTCLAW_READY_TIMEOUT_MS` 可改；轮询间隔 0.2 秒起、翻倍到 2 秒）；聊天接口默认开启（Agent = `HEYBE_FASTCLAW_AGENT_ID`，不设则用 `/v1/agents` 第一个）。
- 启动前检查（`services/task-manager/src/gateway.ts`）：先跑 `fastclaw version` 取 CLI 版本，再看 `FASTCLAW_PORT`（默认 18963）有没有人占：
  - 端口上已经有 FastClaw 在响应（例如上次留下的 daemon）→ `E_FC_FOREIGN_GATEWAY`，版本和 CLI 不一样时 → `E_FC_VERSION_MISMATCH`。**不去连别人的 gateway**，报错并提示 `fastclaw daemon stop` / `scripts/poc/t021-mac.sh cleanup` / 换 `FASTCLAW_PORT`。
  - 端口被别的程序占着（或 gateway 打出 `address already in use`）→ `E_FC_PORT_BUSY`，提示 `lsof -nP -iTCP:<端口> -sTCP:LISTEN`。
  - 自己拉起的 gateway 健康后再核对一次 `/api/status` 版本，不一致 → 停掉它，`E_FC_VERSION_MISMATCH`。
  - 30 秒没就绪 → 停掉它，`E_FC_READY_TIMEOUT`；没就绪就退出 → `E_FC_EXITED`（带 stderr 末尾）。
  - 注意：FastClaw v1.4.0 官方发布包的 gateway 在 `/api/status` 报 `"version":"dev"`（发布构建只注入了 `main.version`，没注入 `buildinfo.Version`），所以 FastClaw 自己会打 `gateway is running FastClaw dev but this CLI is v1.4.0` 的假警告。我们把 `dev`/空当作“版本未知”，不算不一致。
  - 启动失败时服务在标准输出打一行 `HEYBE_SERVICE_ERROR {"code","message","retryable"}`；端口/版本三类不可重试，退出码 3。
- 壳（Supervisor）：
  - 等 READY 默认 60 秒（`HEYBE_SERVICE_READY_TIMEOUT_MS` 可改，要比服务里等 gateway 的 30 秒长）；服务没打 READY 就退出会立刻发现，不再空等。
  - **报 READY 之前不做健康检查**；READY 后第一次 `/health` 成功前有 10 秒宽限，宽限内失败不计数。
  - 收到不可重试的 `HEYBE_SERVICE_ERROR` → 直接 `failed`，不重启。
  - 连续 5 次不稳定（没起来，或起来不到 30 秒就挂）→ 停止重试，`failed`。
  - `service_info` 多了 `error` 字段；`failed` 时横幅显示“本地服务没有启动，请退出后重开 Heybe：<原因>”。
- 崩溃重启：服务退出，或 `/health` 连续 3 次（每 2 秒一次）失败 → 杀整个进程组 → 退避 0.5/1/2/4/8 秒重启；界面显示“本地服务断开，正在重连…”，好了自动消失。
- 一键开发脚本启动前也会探测端口：有 FastClaw 在响应报 `E_FC_FOREIGN_GATEWAY`，被别的程序占着报 `E_FC_PORT_BUSY`。
- 退出（Cmd+Q）：壳给进程组发 SIGTERM，3 秒后 SIGKILL；服务收到 SIGTERM / 标准输入关闭（壳意外死掉）都会先停 gateway。gateway 自己挂了，服务也跟着退出并由壳重启。
- 开发版命令：debug 构建用 `pnpm -C services/task-manager start`（tsx）；可用 `HEYBE_SERVICE_CMD` 覆盖。发布版打包成 sidecar 留给 19-h。
- 一键开发脚本：`scripts/dev/heybe-desktop-dev.sh`（预检 → DeepSeek key 连接测试 → 首次或 key 变了自动跑 `scripts/poc/t021-mac.sh` 准备/更新 FastClaw + DeepSeek Agent → `pnpm install` → Node/better-sqlite3 检查 → `pnpm tauri dev`）；`… check` 检查残留进程。
- Node 版本：仓库固定 Node 22（`.nvmrc`）。better-sqlite3 是原生模块，按安装时的 Node 编译；换了 Node（例如 Mac 默认变成 v26）会报 `NODE_MODULE_VERSION` 不一致、本地服务起不来。脚本在启动前实际加载一次，不匹配时用中文说明原因，并提示 `nvm use` / `fnm use` 或 `pnpm -r rebuild better-sqlite3`；交互终端会先问，加 `--yes` 直接重建。`providers-mac-check.sh` 同样检查。
- 国内镜像（可选，默认关）：`scripts/dev/heybe-desktop-dev.sh --mirror cn`（或 `HEYBE_MIRROR=cn`）让这次编译的 crates.io 走 `sparse+https://rsproxy.cn/index/`，`HEYBE_CARGO_MIRROR=<索引地址>` 可换成别的镜像。实现是给这次的 `cargo run` 传 `--config source.crates-io.replace-with=…`（经 `pnpm tauri dev -- <参数>`），并在本进程设 `CARGO_REGISTRIES_CRATES_IO_PROTOCOL=sparse`，**不改 `~/.cargo/config.toml`**，也不需要在仓库里放 `.cargo/config.toml`（之前手工放的可以删掉）。见 `scripts/lib-mirror.sh`，测试 `scripts/mirror-mock-test.sh`。

- 图标：`apps/desktop/src-tauri/icons/` 目前是**占位图标**（纯色底 + H，RGBA），正式图标由品牌方提供后覆盖同名文件（见该目录 `README.md`）。缺图标时 `generate_context!` 编译期 panic，`apps/desktop/test/icons.test.ts` 检查 `tauri.conf.json` 引用的图标都在。

## 换 DeepSeek key（Mac 复验问题 1）

- 现象：`heybe-desktop-dev.sh` 以前只在第一次（没有 `fastclaw-apikey` 或 FastClaw 二进制时）跑 t021 建 Agent，之后一直复用 `~/.local/opt/heybe-t021`。FastClaw v1.4.0 在 `agents init` 那一刻把 key 存进它自己的数据库（system 级 provider 行，按提供方名字 `deepseek` 存一份），之后不再读 `~/.heybe-poc.env`，所以 10-29 用旧 key 建的 Agent 换了 key 也一直 401。
- FastClaw v1.4.0 没有单独改 key 的命令或 /v1 接口（/v1 只有 chat、agents、sessions）。现成的办法就是已批准的 `fastclaw agents init <名字> --id <agt_…> --api-key-env DEEPSEEK_API_KEY`：对已有 Agent 是原地更新（输出 `Agent "…" updated`），不换 owner、不生成新密码，重新从环境变量读 key；gateway 在跑时 CLI 会发 SIGHUP 让它重新加载。用真 FastClaw v1.4.0 + mock 上游核对过：更新后下一次对话上游收到的就是新 key（只比对了 Authorization 的 sha256）。
- 现在的做法（`scripts/poc/lib-fc-key.sh`）：
  - 每次启动比对 `~/.heybe-poc.env` 里 key 的 sha256 和 `~/.local/opt/heybe-t021/deepseek-key.sha256`（一行 `sha256:<hex>`，权限 600，不存明文也不存末 4 位）。
  - 没变：直接复用。变了，或者没有指纹文件（旧版本建的目录）：重跑 t021。t021 现在先按名字查 Agent id，已有就带 `--id` 原地更新，然后做一次真实流式对话，成功写指纹。
  - 原地更新失败（t021 以退出码 3 结束）：把旧目录改名为 `heybe-t021.bak-<时间>`（不删），再完整重建一次。
  - key 只在 shell 变量里，经 `fc_env_exec` 只交给那一次 `agents init` 子进程；`agents init` 的输出（新建时含管理员密码）整段丢弃。
  - 启动时连接测试：用 key 调一次 DeepSeek `GET /models`（不花钱），HTTP 401/403 → 红色 `✗ [E_KEY_INVALID]`，中文提示到 `~/.heybe-poc.env` 换 key；连不上或其他状态码只给黄色提示、继续启动。`HEYBE_SKIP_KEY_TEST=1` 跳过。
- #85 的 provisioner（设置页“测试连接”）：每次测试都用当前 key 跑一次 `agents init`，已存在时按 `already exists (id …)` 带 `--id` 重试，所以不会卡在旧 key（加了单测：换 key 后第二次测试带 `--id` 且子进程拿到新 key）。注意 FastClaw 的 key 是按提供方名字存的：同一个 `FASTCLAW_HOME` 里测试 `deepseek` 会同时更新聊天 Agent 用的 deepseek key（这正是“一提供方一把 key”的设计）。设置页保存 key（`PUT /providers/keys/:ref`）目前只写钥匙串，还没接到聊天 Agent（首启引导 19-g / #16-c 再接）。
- 测试：`scripts/poc/key-sync-mock-test.sh`（假 fastclaw + 假 DeepSeek，CI 里跑）。

## 后续（不在本 PR）

- 19-c 余下：菜单栏图标。
- 19-f 余下：Markdown 渲染（禁原始 HTML）、1 万字虚拟滚动/分块。
- 19-g：首启引导（依赖 #16-c、#6）。
- 19-h：sidecar 打包、arm64 DMG 签名公证（依赖 Slovian Inc Apple 开发者账号）。

## Mac 验收步骤（Apple 芯片）

前提：`~/.heybe-poc.env` 里有 `DEEPSEEK_API_KEY=…`，权限 600（`chmod 600 ~/.heybe-poc.env`）；装了 Xcode 命令行工具、Node 22（`.nvmrc`；`nvm use` / `fnm use`）、pnpm、Rust。

1. 启动：
   ```bash
   cd Heybe && git fetch && git checkout feat/19-tauri-chat && git pull
   scripts/dev/heybe-desktop-dev.sh
   ```
   终端应看到一串 `✓`；首次会自动跑 t021（下载 FastClaw、配置 DeepSeek Agent）和编译 Rust，需几分钟。
2. 看窗口：弹出 “Heybe” 窗口，顶部黄条“正在启动本地服务…”在约 10 秒内消失，发送按钮可点。
   - 成功标准：黄条消失；终端没有红色 `✗`。
3. 聊天：输入“用三句话介绍你自己”回车。
   - 成功标准：回答逐字流出，结束后不再闪光标；再问“我刚才让你做什么？”能答出上一轮内容（同一会话）。
4. 停止：问一个长问题（“写一篇 800 字的文章”），流出一半点“停止”。
   - 成功标准：立即停住，显示“已停止（服务端是否停止未知）”；还能继续发下一条。
5. 崩溃重启：另开终端执行 `pkill -9 -f services/task-manager/src/main.ts`。
   - 成功标准：窗口出现“本地服务断开，正在重连…”，10 秒内消失；再发一条消息能正常回答。
6. 关窗与退出：点窗口左上角红色关闭 → 窗口消失但 Dock 图标还在；点 Dock 图标 → 窗口回来，聊天记录还在。然后按 Cmd+Q。
   - 成功标准：终端里 `pnpm tauri dev` 结束；再执行 `scripts/dev/heybe-desktop-dev.sh check` 输出 `✓ 没有残留进程，端口 18963 已释放`。
7. 安全检查（可选）：`curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:<端口>/chat/sessions/x/messages`（端口见终端 `heybe: service ready on 127.0.0.1:<端口>` 行）应返回 `401`。

有任何一步不符合，请把终端最后 30 行（不含密钥，脚本本身不会打印密钥）和截图发到 #19。
