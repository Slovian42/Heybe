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

## DCO sign-off / 签署（必需）
This project is licensed under Apache-2.0 and uses the [Developer Certificate of Origin](https://developercertificate.org/) (DCO 1.1).
By signing off you certify you wrote the change or otherwise have the right to submit it under the project license.

Every commit must carry a `Signed-off-by` trailer matching the author:

```bash
git commit -s -m "feat: ..."
# adds: Signed-off-by: Your Name <you@example.com>
git commit --amend -s --no-edit        # fix the last commit
git rebase --signoff main              # fix all commits on your branch
```

CI fails any PR containing a commit without `Signed-off-by`.
本项目采用 Apache-2.0 与 DCO：每个 commit 必须用 `git commit -s` 附 `Signed-off-by`，否则 CI 不通过。
