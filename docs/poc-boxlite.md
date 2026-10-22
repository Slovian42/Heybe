# BoxLite 沙箱概念验证手册（M3 Mac，Lima 作对照）

> 配套脚本：`scripts/poc/boxlite-poc.sh`（幂等、失败即停、逐步打印 PASS/FAIL，结果追加到 `~/.local/opt/heybe-poc/results.tsv`）
> 背景：见 `docs/sandbox-options.md`。FastClaw 固定 v1.4.0；源码引用前缀 `FC:` = https://github.com/fastclaw-ai/fastclaw/blob/v1.4.0/
> 约定：「待核实」= 未能从官方文档/源码确认，附排查命令。

## 0. 依据（已核实）

| 事项 | 依据 |
|---|---|
| BoxLite CLI 安装：`curl -fsSL https://sh.boxlite.ai \| BOXLITE_INSTALL_DIR=… sh`，变量必须放在 `sh` 一侧；`BOXLITE_VERSION` 固定版本 | https://docs.boxlite.ai/getting-started/installation |
| BoxLite 要求 Apple Silicon + macOS 12+ | 同上 |
| `boxlite serve` 默认监听 127.0.0.1:8100（0.10.6 起），非回环必须带 `--api-key`；路由 `/v1/{prefix}/boxes` | https://github.com/boxlite-ai/boxlite ；https://docs.boxlite.ai/guides/agent-service-endpoint |
| 「reference server 未实现 WS 流式端点」 | 同上故障表 —— 本次最大风险 |
| FastClaw boxlite 后端变量：`FASTCLAW_SANDBOX_BOXLITE_URL`、`FASTCLAW_SANDBOX_BOXLITE_PREFIX`（默认 default）、`BOXLITE_API_KEY`（Bearer） | `FC:internal/config/env.go:135-147`；`FC:internal/sandbox/boxlite_executor.go` |
| FastClaw 请求路径 = `URL + /{prefix}/boxes…`，exec 结果走 `GET …/executions/{id}/attach` WebSocket | `FC:internal/sandbox/boxlite_executor.go`（`prefixPath`、`attachWebsocketURL`） |
| 创建 box 只发 `{"image","auto_remove":true}`，**不带 allow_net、不挂载宿主目录**；默认镜像 `thinkany/fastclaw-sandbox:latest` | `FC:internal/sandbox/boxlite_executor.go`（`createBox`、常量） |
| `FASTCLAW_SANDBOX_ENABLED`/`_ENFORCE`/`_BACKEND`；设置 BACKEND 会隐含 ENABLED | `FC:internal/config/env.go:120-127`；`FC:internal/buildinfo/buildinfo.go` |
| gateway 默认端口 18953（`FASTCLAW_PORT`），`fastclaw` 无子命令即启动 gateway | `FC:internal/config/env.go:34`；`FC:cmd/fastclaw/main.go:127` |
| `/v1/chat/completions` 选 Agent：body `agent_id` 或 header `x-fastclaw-agent-id`；apikey 用 Bearer | `FC:internal/api/openai.go:28-40,363`；`FC:internal/api/server.go` |
| DeepSeek 密钥变量名 `DEEPSEEK_API_KEY` | `FC:internal/provider/credentials.go:165` |
| docker 后端调用 `docker` CLI 并继承环境变量 → `DOCKER_HOST` 生效（源码推断） | `FC:internal/sandbox/docker.go` |
| docker 后端网络模式来自配置 `sandbox.network`（存数据库，无环境变量）；CLI `fastclaw agents config <agent> set sandbox.network none` 写入 **agent 作用域** | `FC:internal/config/config.go:3-7,208`；`FC:internal/gateway/userspace.go:147,237`；`FC:internal/agentcli/agentcli.go`（`SetConfig`、`settingKey`） |
| `fastclaw agents init <name> --provider deepseek --model deepseek/deepseek-chat --api-key-env DEEPSEEK_API_KEY`；没有用户时自动创建 super_admin `admin` | `FC:cmd/fastclaw/cmd_agents.go:121-175`；`FC:internal/agentcli/agentcli.go`（`Init`、`providerPreset` deepseek → https://api.deepseek.com） |
| `fastclaw apikey create --name <n> [--type user] [--owner]`，默认 owner 为第一个 super_admin，输出含 `token: <key>` | `FC:cmd/fastclaw/cmd_apikey.go:24-80` |
| `fastclaw version` 打印 `FastClaw <ver>` | `FC:cmd/fastclaw/cmd_version.go:20-32` |
| Lima vz 与 docker 模板、socket 位于 `~/.lima/<name>/sock/docker.sock` | https://lima-vm.io/docs/config/vmtype/ ；https://github.com/lima-vm/lima/blob/master/templates/docker.yaml |

## 1. 一次性准备（在 Mac 终端）

```bash
# DeepSeek 密钥文件：权限必须 600，否则脚本直接 FAIL。可用 HEYBE_POC_ENV 改路径。
( umask 077; read -rs K; printf 'DEEPSEEK_API_KEY=%s\n' "$K" > ~/.heybe-poc.env ); chmod 600 ~/.heybe-poc.env

git clone https://github.com/Slovian42/Heybe.git && cd Heybe && git checkout docs/sandbox-poc
scripts/poc/boxlite-poc.sh all
```

`all` 依次运行：`precheck → install → serve → ws-probe → fastclaw-boxlite → setup-boxlite（init/doctor/apikey）→ verify-boxlite → metrics → lima → fastclaw-docker → setup-docker（init/network=none/doctor/apikey）→ verify-docker`，最后生成报告。

- 每一步在子 shell 里运行，FAIL 只记录不中断；依赖它的步骤标为 SKIP（例如 serve 失败则跳过 BoxLite 的 FastClaw 步骤，但 `metrics`、`lima` 及整条 docker 对照照常运行）。
- 不会自动 cleanup。
- 报告：`~/.local/opt/heybe-poc/report.md`（600）。包括步骤状态、handshake/frames_with_marker 两行、自动回填表、`results.tsv` 全文、三条 `--help` 输出、失败步骤日志尾部。写入前做脱敏：DeepSeek key 与两个 FastClaw apikey 的值替换为 `***`，另外抹掉 `token:`、`password`、`Bearer xxx`、`sk-…` 形态。

## 2. 密钥处理

| 密钥 | 来源 | 存放 | 不会出现在 |
|---|---|---|---|
| DEEPSEEK_API_KEY | `${HEYBE_POC_ENV:-~/.heybe-poc.env}`（600 校验） | 只在脚本进程和 FastClaw gateway 环境中 | 终端、日志、报告 |
| FastClaw apikey（每个后端一个） | 脚本运行 `fastclaw apikey create`，先用 `--help` 确认 `--name`（和 `--type`）参数存在，拿不到就 FAIL 并提示 | `~/.local/opt/heybe-poc/{boxlite,docker}/fastclaw-apikey`（600） | 终端、日志、报告 |
| admin 初始密码 | `agents init` 首次创建 admin 时可能生成 | `~/.local/opt/heybe-poc/<backend>/agents-init.log`（600） | 报告 |
| BOXLITE_API_KEY | 占位值 `local-poc`（本地 serve 未加 `--api-key` 为宽松模式） | 环境变量 | — |

## 3. 原手动步骤的自动化情况

| 步骤 | 做法 | 状态 |
|---|---|---|
| 给 Agent 配 DeepSeek | `fastclaw agents init poc --provider deepseek --model deepseek/deepseek-chat --api-key-env DEEPSEEK_API_KEY`，再 `agents doctor` | 已自动（CLI，直接写 FASTCLAW_HOME 的数据库，未用 `/api/*`）。模型 id 可用 `HEYBE_POC_MODEL` 覆盖 |
| 创建 apikey | `fastclaw apikey create --name heybe-poc-<backend> --type user` | 已自动 |
| docker 后端网络 none | `fastclaw agents config poc set sandbox.network none` | 已自动写入，但这是 agent 作用域配置；系统沙箱池（`userspace.go:147` 用的 `cfg.Network`）是否读取它**待核实**，以验证 3 结果为准。CLI 没有写系统作用域 `sandbox` 的入口（`settingKey` 把 `sandbox.*` 固定为 agent 作用域）。若验证 3 失败，只能走设置页（底层是 `/api/*`）或改 FastClaw，标为**需手动** |
| BoxLite 出网白名单 | FastClaw v1.4.0 创建 box 时不传 `allow_net`，无任何配置入口 | **做不到**，需改 FastClaw 或加 shim |

## 4. 单步运行（排查用）

```bash
scripts/poc/boxlite-poc.sh precheck|install|serve|ws-probe|metrics|lima
scripts/poc/boxlite-poc.sh fastclaw-boxlite && scripts/poc/boxlite-poc.sh setup boxlite && scripts/poc/boxlite-poc.sh verify boxlite
scripts/poc/boxlite-poc.sh fastclaw-docker  && scripts/poc/boxlite-poc.sh setup docker  && scripts/poc/boxlite-poc.sh verify docker
scripts/poc/boxlite-poc.sh report
```

三项验证判定：

| # | 做法 | PASS 条件 |
|---|---|---|
| 1 流式输出 | `ws-probe` 直连 `…/attach` 做 WebSocket 握手；`verify` 让 Agent 执行 `echo HEYBE_EXEC_$((40+2)) && uname -a` | 握手 101 且 3/3 标记帧；回复含 `HEYBE_EXEC_42`、uname 为 Linux；日志无 attach 错误 |
| 2 宿主隔离 | 在 `~/Documents/heybe-poc-secret.txt` 写随机标记，让 Agent `cat` | 回复中没有该标记 |
| 3 出网拦截 | 让 Agent `curl https://example.com` | 不是 200/30x |

> 预期：BoxLite 的验证 3 在 v1.4.0 上很可能 FAIL（见第 3 节）。这本身就是要记录的结论。

## 5. 清理（手动执行，`all` 不会自动做）

```bash
scripts/poc/boxlite-poc.sh cleanup            # 停进程、删测试文件和沙箱容器、停 Lima VM
PURGE=1 scripts/poc/boxlite-poc.sh cleanup    # 另外删除 ~/.local/opt/{boxlite,fastclaw,heybe-poc}（含 apikey 文件）和 Lima VM
brew uninstall lima docker                    # 可选
rm ~/.heybe-poc.env                           # 用完删除密钥文件
```

## 6. 结果回填表

`report.md` 会自动填写下表；空格或「未运行」项需要人工补充。

| 项 | BoxLite | Lima+docker |
|---|---|---|
| macOS / 芯片 / 内存 | | 同左 |
| 组件版本 | | |
| REST `/v1/default/boxes` | | — |
| WS 握手 / 标记帧 | | — |
| 验证1 / 2 / 3 | | |
| 冷启动 / 热启动 ms | | |
| 首轮对话 ms | | |
| 安装 / 数据体积 | | |
| 内存 MB | | |

## 7. 待核实与排查

1. `boxlite serve --host/--port` 参数，以及 exec 请求体字段（`command`/`args`）：看报告里的 `--help` 输出；`curl -s http://127.0.0.1:8100/openapi.json | python3 -m json.tool | head -100`。
2. `boxlite serve` 是否实现 attach WebSocket：看报告里的 handshake 行；必要时用 `RUST_LOG=debug` 重跑。
3. FastClaw release 资产名 `fastclaw_darwin_arm64.tar.gz`：`curl -s https://api.github.com/repos/fastclaw-ai/fastclaw/releases/tags/v1.4.0 | grep name`。
4. DeepSeek 模型 id 是否为 `deepseek-chat`：`fastclaw agents config poc get model`；doctor 输出。
5. `sandbox.network`（agent 作用域）是否作用于系统沙箱池：验证 3（docker）结果；`grep 'sandbox executor pool created' ~/.local/opt/heybe-poc/logs/fastclaw-docker.log`。
6. FastClaw 对 `BOXLITE_API_KEY` 占位值的处理：`grep -i boxlite ~/.local/opt/heybe-poc/logs/fastclaw-boxlite.log`。
7. CLI 在 gateway 运行时写同一数据库是否会立即生效：`agents config` 会调 `notifyGatewayReload`；`agents init` 是否同样生效待核实（如有问题，重跑 `fastclaw-<backend>` 前先 `cleanup-fastclaw`）。
8. BoxLite 数据目录（脚本假定 `~/.boxlite`）：`ls -d ~/.boxlite ~/Library/Application\ Support/boxlite 2>/dev/null`。
9. Lima docker socket 路径：`ls ~/.lima/heybe-poc/sock`。
