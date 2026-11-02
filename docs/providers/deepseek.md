# DeepSeek（默认）
- 官方文档：https://api-docs.deepseek.com/ （核对日期 2026-11-02）
- 接口地址 `https://api.deepseek.com`，模型 `deepseek-chat` / `deepseek-reasoner`。
- 获取密钥：https://platform.deepseek.com/api_keys
- 错误码：401 表示密钥错误，402 表示余额不足（Heybe 归为 rate_limited），429 表示限流。
- 2026-11-02 实测：FastClaw 返回 502 `API error 401: …Authentication Fails, Your api key: ****xxxx is invalid…`。上游只回显 key 的后 4 位。
