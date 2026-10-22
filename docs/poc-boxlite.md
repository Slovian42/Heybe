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
| docker 后端网络模式来自配置 `sandbox.network`（存数据库，无环境变量） | `FC:internal/config/config.go:3-7,208`；`FC:internal/gateway/userspace.go:147` |
| Lima vz 与 docker 模板、socket 位于 `~/.lima/<name>/sock/docker.sock` | https://lima-vm.io/docs/config/vmtype/ ；https://github.com/lima-vm/lima/blob/master/templates/docker.yaml |

## 1. 一次性准备（在 Mac 终端）

```bash
# 取脚本（仓库已 clone 的话直接用仓库里的）
cd ~/src/heybe            # 按实际路径
chmod +x scripts/poc/boxlite-poc.sh

# 密钥只放在当前 shell，不写文件、不 echo
read -rs DEEPSEEK_API_KEY && export DEEPSEEK_API_KEY
```

## 2. BoxLite 主线

```bash
scripts/poc/boxlite-poc.sh precheck     # macOS 版本、arm64、kern.hv_support
scripts/poc/boxlite-poc.sh install      # BoxLite → ~/.local/opt/boxlite/bin，FastClaw v1.4.0 → ~/.local/opt/fastclaw/bin
scripts/poc/boxlite-poc.sh serve        # boxlite serve 127.0.0.1:8100 + 直接 REST/WS 探测（不经 FastClaw）
scripts/poc/boxlite-poc.sh fastclaw-boxlite
```

`fastclaw-boxlite` 设置的环境（脚本内，**不设** `FASTCLAW_ALLOW_HOST_EXEC`）：

```bash
FASTCLAW_SANDBOX_ENABLED=1
FASTCLAW_SANDBOX_ENFORCE=1
FASTCLAW_SANDBOX_BACKEND=boxlite
FASTCLAW_SANDBOX_BOXLITE_URL=http://127.0.0.1:8100/v1
FASTCLAW_SANDBOX_BOXLITE_PREFIX=default
BOXLITE_API_KEY=local-poc     # serve 未加 --api-key 时为宽松模式，值任意（待核实：FastClaw 空 key 时是否拒绝）
FASTCLAW_HOME=~/.local/opt/heybe-poc/fastclaw-boxlite
```

**创建 Agent 与 apikey（待核实具体参数）**：FastClaw 的 provider/Agent/apikey 存在数据库里，首次需要初始化：

```bash
export PATH="$HOME/.local/opt/fastclaw/bin:$PATH"
export FASTCLAW_HOME=~/.local/opt/heybe-poc/fastclaw-boxlite
fastclaw agents init poc            # FC:cmd/fastclaw/cmd_agents.go:121
fastclaw agents doctor poc          # 检查 provider/模型是否可用；若缺 provider，打开 http://127.0.0.1:18953 的设置页选 DeepSeek
fastclaw apikey create --help       # 待核实 flag；生成后：
read -rs FASTCLAW_API_KEY && export FASTCLAW_API_KEY
```

然后：

```bash
scripts/poc/boxlite-poc.sh verify boxlite   # 三项验证（经 /v1 流式）
scripts/poc/boxlite-poc.sh metrics
```

三项验证的判定：

| # | 做法 | PASS 条件 |
|---|---|---|
| 1 流式输出 | `serve` 步骤先直连 `…/attach` 做 WebSocket 握手（需 HTTP 101 且收到 3 帧标记）；`verify` 再让 Agent 执行 `echo HEYBE_EXEC_$((40+2)) && uname -a` | 握手 101、3/3 标记；回复含 `HEYBE_EXEC_42` 且 `uname` 为 Linux；FastClaw 日志无 `boxlite attach` 错误 |
| 2 宿主隔离 | 在 `~/Documents/heybe-poc-secret.txt` 写随机 token，让 Agent `cat` 它 | 回复中不出现 token |
| 3 出网拦截 | 让 Agent `curl https://example.com` | 不返回 200/30x |

> **预期**：第 3 项在 v1.4.0 上很可能 FAIL —— FastClaw 创建 box 时不传 `allow_net`。这本身就是要记录的结论（Heybe 需要给 FastClaw 提 PR 或加 shim 注入出网策略）。脚本遇到 FAIL 即停；要继续跑 metrics 请单独执行 `metrics`。

## 3. Lima 对照

```bash
scripts/poc/boxlite-poc.sh lima              # brew install lima docker；limactl start --vm-type=vz template://docker
scripts/poc/boxlite-poc.sh fastclaw-docker   # 停掉 boxlite 版 FastClaw，以 DOCKER_HOST=unix://~/.lima/heybe-poc/sock/docker.sock + backend=docker 启动
# 新的 FASTCLAW_HOME（fastclaw-docker）需要重复一次 agents init / apikey create
scripts/poc/boxlite-poc.sh verify docker
```

说明：Lima 默认把宿主 `$HOME` 只读挂进 VM，但 FastClaw 容器只挂 workspace，所以第 2 项看的是容器边界。第 3 项需先把网络模式设成 `none`（在 FastClaw 设置页的 sandbox network，待核实入口），否则 Docker 默认 bridge 可出网。

## 4. 清理

```bash
scripts/poc/boxlite-poc.sh cleanup            # 停进程、删测试文件、删 fastclaw 沙箱容器、停 Lima VM
PURGE=1 scripts/poc/boxlite-poc.sh cleanup    # 另外删除 ~/.local/opt/{boxlite,fastclaw,heybe-poc} 和 Lima VM
brew uninstall lima docker                    # 可选
unset DEEPSEEK_API_KEY FASTCLAW_API_KEY
```

## 5. 结果回填表

| 项 | BoxLite | Lima+docker | 备注 |
|---|---|---|---|
| macOS / 芯片 / 内存 | | 同左 | precheck |
| 组件版本 | boxlite= / fastclaw=v1.4.0 | lima= / docker CLI= | |
| REST `/v1/default/boxes` HTTP 码 | | — | |
| WS attach 握手 / 标记帧 | 101? / ?/3 | — | 最大风险 |
| 验证1 经 /v1 流式输出 | PASS/FAIL | PASS/FAIL | |
| 验证2 ~/Documents 不可读 | | | |
| 验证3 出网被拦 | | | 预期 BoxLite FAIL |
| 冷启动（首次 create+start，含拉镜像） ms | | lima_cold_start_ms | |
| 热启动（warm exec / docker run） ms | | | |
| 首轮对话耗时 ms | | | first_turn_ms |
| 安装体积 | | lima_install / lima_disk | |
| 内存占用 MB（serve / VM） | | | |
| 失败日志摘要 | | | `~/.local/opt/heybe-poc/logs/` |

## 6. 待核实与排查

1. `boxlite serve` 的 flag 名（`--host`/`--port`）与 exec 请求体字段（`command`/`args`）：`boxlite serve --help`；`curl -s http://127.0.0.1:8100/openapi.json | python3 -m json.tool | head -100`。
2. `boxlite serve` 是否实现 attach WS：看 `serve` 步骤输出的 `handshake:` 行；`RUST_LOG=debug boxlite serve …` 重跑。
3. FastClaw release 资产名是否为 `fastclaw_darwin_arm64.tar.gz`：`curl -s https://api.github.com/repos/fastclaw-ai/fastclaw/releases/tags/v1.4.0 | grep name`。
4. `fastclaw --version`、`fastclaw apikey create` 的 flag、Agent 初次配置 DeepSeek 的方式：`fastclaw --help`、`fastclaw apikey create --help`、`fastclaw agents config poc get`。
5. 本地宽松模式下 FastClaw 对 `BOXLITE_API_KEY` 为空的行为：`grep -i boxlite ~/.local/opt/heybe-poc/logs/fastclaw-boxlite.log`。
6. BoxLite 数据目录（用于体积统计，脚本假定 `~/.boxlite`）：`ls -d ~/.boxlite ~/Library/Application\ Support/boxlite 2>/dev/null`。
7. docker 后端网络模式在哪里设：`grep -i network ~/.local/opt/heybe-poc/logs/fastclaw-docker.log`，以及设置页。
8. Lima docker 模板的 socket 路径：`limactl list heybe-poc --format '{{.Dir}}'; ls ~/.lima/heybe-poc/sock`。
