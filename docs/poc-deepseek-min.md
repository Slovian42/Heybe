# DeepSeek 最小对话 PoC

用 `@heybe/fastclaw-adapter` 的 `/v1`（`streamMessage` + 一次 `sendMessage` 做 model 回显）验证：本机 FastClaw v1.4.0 已配 DeepSeek 时，能否完成一轮流式对话，并核对请求 `model` 回显（T0.2.1）。

**本脚本不读取、不打印 DeepSeek 密钥。** DeepSeek 密钥只写进 FastClaw Agent 配置。脚本只读：

| 变量 | 含义 |
|---|---|
| `HEYBE_FASTCLAW_BASE_URL` | 例 `http://127.0.0.1:18953` |
| `HEYBE_FASTCLAW_TOKEN` | FastClaw API key（Bearer） |

可选：`HEYBE_FASTCLAW_AGENT_ID`、`HEYBE_POC_PROBE_MODEL`（默认 `heybe-probe-model-echo`）、`HEYBE_POC_PROMPT`。

固定版本与安装见 [`phase0-dev-env.md`](./phase0-dev-env.md)。

## 1. 用 FastClaw 配置 DeepSeek（一次性）

在 **已安装 v1.4.0** 的机器上（优先用户的 M3 Mac）：

```bash
# DeepSeek 密钥只放本机环境或钥匙串，不要写进仓库 / 日志 / PR
export DEEPSEEK_API_KEY=…   # 或从受控文件 source，勿 cat

fastclaw --version   # 期望与 phase0 钉死的 v1.4.0 一致
fastclaw daemon start   # 或按 phase0 前台启动；默认端口 18953

# 按官方向导创建/配置 Agent，模型选 DeepSeek
# 若子命令名有出入，以 `fastclaw -h` / 控制台为准
fastclaw agents init
```

控制台路径（备选）：打开 `http://127.0.0.1:18953` → Agents → 新建或编辑 → 模型提供方选 DeepSeek → 粘贴密钥（只显示一次的录入框）→ 保存。

创建 FastClaw API key（只显示一次），写入钥匙串或当前 shell（**不要** `echo` 进历史可检索文件）：

```bash
# macOS 钥匙串示例（phase0 已有）
security add-generic-password -s heybe-fastclaw -a "$USER" -w   # 交互输入

export HEYBE_FASTCLAW_BASE_URL=http://127.0.0.1:18953
export HEYBE_FASTCLAW_TOKEN="$(security find-generic-password -s heybe-fastclaw -w)"
```

Linux / 临时 shell：直接 `export HEYBE_FASTCLAW_TOKEN=…`（会话级），结束后 `unset`。

## 2. 跑脚本

在仓库根目录：

```bash
pnpm install   # 若尚未安装
pnpm dlx tsx scripts/poc/deepseek-min-chat.ts
```

成功时 stdout 是一段 **脱敏 JSON**，例如字段含义：

| 字段 | 含义 |
|---|---|
| `ok` / `stream_ok` | 流式是否成功 |
| `first_token_ms` | 首个 delta 延迟 |
| `total_ms` | 流式总耗时 |
| `error_code` / `error_kind` / `error_status` | 失败时的码（无则 null） |
| `request_model` | 请求里带的探针 model |
| `response_model` | 非流式响应里的 model 回显 |
| `model_echo_matches_request` | 是否与请求一致（T0.2.1） |
| `agent_id` | 使用的 Agent id |
| `note` | 说明（已做简单脱敏） |

脚本 **不会** 打印 token、DeepSeek 密钥或模型回复正文。

## 3. 没有 FastClaw 时的行为

若进程未启动、端口不对、或 token 无效，脚本会：

1. 打印 `ok: false` 的 JSON（含可读 `note`）；
2. 以退出码 `1` 结束；
3. **不假装成功**。

此时把状态记为 **待 Mac / 本地 FastClaw**，不要把失败改写成「通过」。

## 4. 与核验表的关系

- 流式成功 → 可给表第 1 行补充运行时证据（仍建议双会话隔离另测）。
- `model_echo_matches_request` → 备注 2 / T0.2.1 的运行时证据；**不等于**证明 Agent 实际用了该 model（源码预期是只回显、不覆盖）。
- 取消 / 状态 / 审批 / 重启：见 `interface-verification.md` 的 T0.4 降级结论，本脚本不覆盖。

## 5. 本仓库 CI / Linux box 说明

CI 继续用 mock，不把真实 DeepSeek 或 FastClaw token 放进 GitHub Secrets（未经用户确认前）。

在共享 Linux box 上若未装好可对话的 FastClaw + DeepSeek Agent，本 PoC 标记为 **待 Mac / 本地 FastClaw**，以清晰失败为准。

## 6. 实测记录（脱敏）

| 项 | 值 |
|---|---|
| 日期 | 2026-10-23（Asia/Shanghai） |
| 环境 | Linux box，`fastclaw` **v1.4.0**（`b5ad3dff`），`FASTCLAW_HOME` 隔离目录 |
| Agent | `heybe-deepseek-min`，provider DeepSeek，配置模型 `deepseek-v4-flash`（经 `agents init --api-key-env DEEPSEEK_API_KEY`） |
| `stream_ok` | `true` |
| `first_token_ms` | 2687 |
| `total_ms` | 2763 |
| `request_model` | `heybe-probe-model-echo` |
| `response_model` | `heybe-probe-model-echo` |
| `model_echo_matches_request` | `true` |
| 说明 | 密钥经 `source` 注入进程环境，未写入仓库 / 日志 / PR。回显一致**只**证明响应抄了请求 `model`。跑完后 `fastclaw agents doctor` 仍报 `model: deepseek/deepseek-v4-flash`（未变成探针字符串），作为**旁证**支持「不覆盖配置」；严格证明仍待更完整的对照实验。Mac 上仍建议按第 1–2 节再跑一遍作验收。 |
