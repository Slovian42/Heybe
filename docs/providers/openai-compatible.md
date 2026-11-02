# 自定义 OpenAI 兼容接口（高级，mock + 文档验收）
- 协议：OpenAI Chat Completions，https://platform.openai.com/docs/api-reference/chat （核对日期 2026-11-02）
- 接口地址需要填到 `/v1` 这一级，例如 `https://relay.example.com/v1`。地址里不能带用户名、密码或查询参数。
- 配置 id 同时作为 FastClaw provider 名，因此不同中转配置互不影响。
- 各家中转的错误格式不统一。无法识别的错误一律归为 provider_error，提示“可能是提供方接口有变化”。
