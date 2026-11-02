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

## 已知限制（需要 Yang 知悉）
- **provider 配置按名称全局共享**：所有用 `--provider deepseek` 的 Agent 共用最后一次 `agents init` 写入的 key 和 base。因此“测试连接”会**覆盖**正在使用的配置。v1 只允许每种类型配置一个；openai_compatible 用配置 id 作为 provider 名，彼此互不影响。
- **建 Agent 走 CLI**：FastClaw v1.4.0 的 `/v1/agents` 不接受 provider、key、base 这些字段，所以只有 provisioning 用 CLI，对话仍然只走 /v1。
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
- key 的传递路径：从文件读入 shell 变量，用 `printf`（shell 内建命令）经 stdin 交给 curl，任务服务再经 `security -i` 的 stdin 写入钥匙串。全程不出现在任何进程的 argv 上。
- 临时 FastClaw 运行在单独的 `FASTCLAW_HOME`（临时目录）里，不影响已有的 `~/.fastclaw`。
