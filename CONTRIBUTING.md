# Contributing / 贡献指南

Thanks for helping! 感谢参与。

## Setup / 环境
See [docs/phase0-dev-env.md](docs/phase0-dev-env.md). Then:

```bash
pnpm install
pnpm lint   # eslint + boundary check + tsc
pnpm test   # vitest
```

## Rules / 规则
1. **FastClaw /v1 only.** `packages/fastclaw-adapter` is the only place that knows FastClaw; it may call `/v1/*` only, never `/api/*`. Lint enforces this. 只能调 `/v1/*`。
2. **Community never depends on Pro.** No `@opengrok-pro/*` imports or deps. Pro-facing types live in `packages/shared-types/src/pro-interface.ts`, versioned (semver). 开源版绝不依赖 Pro。
3. **No secrets.** Never commit keys, tokens, `.env`, DBs or logs containing them. `.env.example` holds names only. 不提交任何密钥。
4. **Honest status.** Code must not report success without verifiable evidence (artifacts, tool results). 无证据不报成功。
5. Small PRs, conventional commits (`feat:`, `fix:`, `docs:` …), tests for logic.

## Sign-off / 签署
The project license is still being decided (see LICENSE). Contributions will require a
contributor agreement (DCO sign-off `git commit -s` at minimum; a CLA may be required once
the license is chosen). Please wait for that policy before sending large external PRs.
许可证确定前，外部贡献需至少 DCO 签署；可能另需 CLA。
