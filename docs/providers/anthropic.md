# Anthropic（mock + 文档验收）
- 官方文档：https://docs.anthropic.com/en/api/messages （核对日期 2026-11-02）
- 接口地址 `https://api.anthropic.com`，FastClaw 预设为 `anthropic-messages` 接口类型。
- 获取密钥：https://console.anthropic.com/settings/keys
- 错误码：401 表示 authentication_error，403 表示 permission_error，404 表示 not_found_error（模型），429 表示 rate_limit_error，529 表示 overloaded（Heybe 归为 provider_error）。
