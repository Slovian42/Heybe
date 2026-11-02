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
- **钥匙串写入时 key 会出现在 argv 上**：`security add-generic-password -w <key>` 运行期间，同一用户的 `ps` 能看到 key，进程存在时间很短。v1 接受这一点，后续可改用原生 Keychain API。
