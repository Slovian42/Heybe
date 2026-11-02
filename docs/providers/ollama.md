# Ollama（高级，Mac 真实验收）
- 官方文档：https://github.com/ollama/ollama/blob/main/docs/openai.md （核对日期 2026-11-02）
- 接口地址 `http://127.0.0.1:11434/v1`，不需要密钥（FastClaw 会填占位值）。
- **上下文必须 ≥ 16384**：FastClaw 每轮大约用 11k token。设置 `OLLAMA_CONTEXT_LENGTH=16384` 后重启 Ollama；Mac App 可以执行 `launchctl setenv OLLAMA_CONTEXT_LENGTH 16384`。
- “测试连接”会先探测 `/api/tags`，判断 Ollama 是否在运行；对话成功后，再从 `/api/ps` 或 `/api/show` 读取上下文长度。小于 16k 或读不到时返回 warning。参考 docs/t022-ollama-local.md。
