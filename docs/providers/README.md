# 模型提供方配置与“测试连接”（#16）

核对日期：2026-11-02，FastClaw v1.4.0。

| 类型 | 默认接口地址 | 需要密钥 | 验收方式 | 文档 |
|---|---|---|---|---|
| deepseek（默认） | https://api.deepseek.com | 是 | 真实验收 | [deepseek.md](deepseek.md) |
| openai | https://api.openai.com/v1 | 是 | mock + 文档 | [openai.md](openai.md) |
| anthropic | https://api.anthropic.com | 是 | mock + 文档 | [anthropic.md](anthropic.md) |
| openrouter | https://openrouter.ai/api/v1 | 是 | mock + 文档 | [openrouter.md](openrouter.md) |
| ollama（高级） | http://127.0.0.1:11434/v1 | 否 | 真实验收（Mac） | [ollama.md](ollama.md) |
| openai_compatible（高级） | 自填 | 是 | mock + 文档 | [openai-compatible.md](openai-compatible.md) |

## 测试连接流程
1. `validateProviderConfig` 校验配置。
2. 从 SecretStore（Mac 钥匙串，service=`heybe`，account=`keyRef`）取密钥；没有就返回 `key_missing`。
3. `fastclaw agents init heybe-probe-<id>` 建或更新探测 Agent。密钥只通过子进程环境变量 `HEYBE_PROVIDER_KEY` 传入，不出现在 argv 上。stdout 只取 `Agent ID:` 这一行，其余内容（可能包含管理员密码）直接丢弃。
4. 通过 `/v1/chat/completions` 发送“只回复 OK”，超时 20 秒。
5. 对错误分类，结果见下表。所有日志都先经过 `redactSecrets`。

| code | 含义 |
|---|---|
| key_invalid | 上游返回 401 或 403 |
| model_not_found | 上游返回 404，或错误信息提到模型不存在 |
| rate_limited | 上游返回 429 或 402 |
| network_unreachable | DNS 解析失败或连接被拒 |
| timeout | 20 秒内没有回复 |
| ollama_not_running | `/api/tags` 无法访问 |
| context_too_small | Ollama 上下文小于 16384（结果为 warning，不算失败） |
| fastclaw_error | FastClaw 本身出错，比如 Heybe 的 token 被拒，或 CLI 执行失败 |
| provider_error | 其他上游错误，提示语为“可能是提供方接口有变化” |

FastClaw 会把上游错误转成 **HTTP 502 `agent_error`**，message 的格式为 `API error <上游状态>: <上游 body>`（2026-11-02 实测 DeepSeek 401）。DNS 失败或连接被拒时，FastClaw 内部会重试，Heybe 这边看到的是超时。所以 Ollama 先探测 `/api/tags`。

## 已确认的决定（Yang，2026-11-02）

### 决定 1：每种提供方只配一个密钥
- **规则**：deepseek、openai、anthropic、openrouter、ollama 这五种内置提供方，每种最多一份配置、一个密钥。自定义兼容接口（openai_compatible）按**配置 id** 命名，可以有多个。
- **原因**：FastClaw v1.4.0 的提供方配置（key + base）按**提供方名称全局共享**。所有用 `--provider deepseek` 的 Agent 共用最后一次 `agents init` 写进去的 key 和 base。如果允许配两份 DeepSeek，后写的会悄悄覆盖先写的，所有 Agent 都换了 key。同理，“测试连接”也会覆盖当前正在用的同名配置。
- **代码里怎么做**（`packages/shared-types/src/providers.ts`）：
  - `fastclawProviderName(cfg)`：内置类型取预设名（如 `deepseek`），openai_compatible 取配置 id。`initArgs` 的 `--provider` 也用它。
  - `upsertProviderConfig(list, cfg)`：id 相同 → **覆盖**（就地更新）；id 不同但提供方名称相同 → **拒绝**，抛 `DuplicateProviderError`，提示“已经配置过 deepseek（配置 “…”）。每种提供方只能配一个密钥：FastClaw 按提供方名称全局共享配置，再加一个会覆盖前一个。请修改已有配置；需要多个端点请用‘自定义兼容接口’。”
  - `validateProviderSet(list)`：整组校验，报告重复 id 和同名提供方。
  - `validateProviderConfig`：openai_compatible 的 id 不能用内置提供方的名字（`RESERVED_PROVIDER_NAMES`），否则会覆盖那个内置提供方的 key 和 base。
  - `providerKeyRef(cfg)`：约定的钥匙串条目名 `heybe.provider.<提供方名称>`，一种提供方一个条目。
  - 测试：`services/task-manager/test/provider-rules.test.ts`。
- 设置界面（16-f）保存前调用 `upsertProviderConfig`，把错误信息原样显示给用户。

### 决定 2：建 Agent 走本机 `fastclaw agents init`（“只通过 /v1 调用”的例外）
- **例外内容**：Heybe 对 FastClaw 的调用原则上只走 `/v1`。唯一例外是用本机命令行 `fastclaw agents init` 建或更新绑定提供方的 Agent（`services/task-manager/src/provider-provisioner.ts` 的 `FastClawCliProvisioner`）。对话、查询等其他操作仍然只走 `/v1`；不调用 `/api/*`（`scripts/check-boundaries.mjs` 仍然检查适配层）。
- **原因**：FastClaw v1.4.0 的 `/v1` 没有设置提供方的接口，`/v1/agents` 不接受 provider、key、base 字段。
- **硬性要求**（已实现并有测试）：
  - 密钥**只放在子进程的环境变量** `HEYBE_PROVIDER_KEY` 里，命令参数只带变量名（`--api-key-env HEYBE_PROVIDER_KEY`），`ps` / argv 里看不到密钥。
  - 子进程环境走 `buildChildEnv` 白名单，父进程里其他像密钥的变量（如 `DEEPSEEK_API_KEY`）不会传下去。
  - 密钥不写进日志：CLI 的 stdout 只取 `Agent ID:` 一行，其余（可能含管理员密码）丢弃；失败时的错误信息只含退出码，不含 CLI 输出；诊断日志先经 `redactSecrets`。
  - 测试：`provider-rules.test.ts` 用一个假的 `fastclaw` 脚本真实 spawn，断言它收到的 argv（Linux 上还读 `/proc/<pid>/cmdline`）里没有密钥、环境变量里有；失败路径的错误信息里没有密钥和管理员密码。`providers.test.ts` 另有 mock runner 的同类断言。
- 架构文档的例外清单：[architecture.md §3.10](../architecture.md#310-只通过-v1-调用的例外)。

## 已知限制（需要 Yang 知悉）
- **fastclaw.db 中的 key 是明文**：用 700/600 权限缓解（`lockPrivateTree`），不对其加密。
- **钥匙串写入（2026-11-02 改）**：执行 `/usr/bin/security -i`（交互模式），把 `add-generic-password -U -s "heybe" -a "<keyRef>" -w "<key>"` 这一行从 **stdin** 写入。key 不出现在任何进程的 argv 上，`ps` 看不到。读取用 `find-generic-password -w`，值只从 stdout 返回。
  - key 里不能有引号、反斜杠或控制字符，否则会拒绝写入。所有主流提供方的 key 都不含这些字符。
  - `security -i` 里的命令即使失败，进程也是 0 退出，所以写入后会回读校验，不一致就报错。
  - 单测 mock 了 `node:child_process.execFile`，断言每次调用的参数里都不含 key。
  - 没选 Rust keyring / security-framework 的原因：task-manager 是 Node 进程，用 Rust 还要加 Tauri↔Node 的 IPC 传 key；而且 Linux CI 上测不了 Mac API。等 16-f 接入设置界面时可以再评估。
  - 需要在 Mac 上验收：确认写入的条目能在“钥匙串访问”里看到；确认首次读取时没有 ACL 弹窗（条目由 `security` 创建，默认信任 `security`）。

## Mac 验收脚本：`scripts/dev/providers-mac-check.sh`
设置界面（16-f）完成之前，用这个脚本验收。它会在 loopback 上起一个任务服务（`services/task-manager/dev/providers-server.ts`），通过 `/providers/*` 接口完成全部步骤。

| 接口 | 作用 |
|---|---|
| `GET/PUT/DELETE /providers/keys/:ref` | 查询、写入、删除 key，只返回 `{set,last4}` |
| `POST /providers/keys/:ref/verify` | 回读比对，只返回 `{match}` |
| `POST /providers/test` | 测试连接 |

```bash
pnpm install
chmod 600 ~/.heybe-poc.env              # 内容：DEEPSEEK_API_KEY=...
OLLAMA_CONTEXT_LENGTH=16384 ollama serve  # 或在 Ollama.app 里设置后重启
scripts/dev/providers-mac-check.sh       # 可加 --skip-ollama、--yes
scripts/dev/providers-mac-check.sh --mock  # box/CI 干跑（vitest 也会跑一遍）
```

| 步骤 | 成功标准 |
|---|---|
| 预检 | macOS，`~/.heybe-poc.env` 权限为 600 且含 `DEEPSEEK_API_KEY`，fastclaw 可执行 |
| ① 钥匙串 | PUT 返回 `set=true`，last4 与本地一致；verify 返回 `match=true`；`security find-generic-password -s heybe -a heybe.provider.deepseek.mac-check` 能找到；人工在“钥匙串访问”里看到该条目后按 y |
| ② DeepSeek | `/providers/test` 返回 `code=ok` |
| ③ Ollama | `code=ok`（Ollama 在运行、能回复、上下文 ≥ 16384）；`context_too_small` 算失败 |
| ④ 清理 | 接口回读 `set=false`，`security` 找不到条目；临时 FastClaw 停止，数据目录删除 |

- 报告路径：`~/heybe-reports/providers-mac-check-<时间>.md`（权限 600，可用 `HEYBE_REPORT_DIR` 改）。报告只含 key 后 4 位，写完会自检，发现完整 key 就删除报告并判为失败。
- key 的传递路径：从文件读入 shell 变量，用 `printf`（shell 内建命令）经 stdin 交给 curl，任务服务再经 `security -i` 的 stdin 写入钥匙串。报告自检用 bash 自己的字符串匹配（`$(<报告)` + `case`），不调用 `grep`。全程不出现在任何进程的 argv 上。
- 临时 FastClaw 的令牌 `HEYBE_FASTCLAW_CHAT_TOKEN` 只经环境继承交给任务服务：在子 shell 里用 `fc_env_only_kv`（内建 `export` / `export -n`）设好环境后 `exec`。2026-11-02 之前这里用的是 `env -i K=V …`、自检用的是 `grep -F "$KEY"`，令牌和 key 会短暂出现在 `env` / `grep` 进程的 argv 里，已改正。
- 临时 FastClaw 运行在单独的 `FASTCLAW_HOME`（临时目录）里，不影响已有的 `~/.fastclaw`。
