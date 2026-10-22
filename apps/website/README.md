# heybe.dev website

Source of [heybe.dev](https://heybe.dev): a Cloudflare Worker that serves the static pages in `public/` and one API route.

| Path | What |
|---|---|
| `/` (`public/index.html`) | English landing page with waitlist form |
| `/zh` (`public/zh.html`) | Simplified Chinese landing page (`hreflang` pairs with `/`) |
| `/demo` (`public/demo.html`) | Clickable design prototype of the desktop app (sample content) |
| `/privacy` | Privacy note for the site and waitlist |
| `/robots.txt`, `/sitemap.xml`, `/og.png`, favicons | SEO and sharing assets |
| `POST /api/waitlist` | Stores `{email, created_at, lang, source, ip_hash}` in D1 (`schema.sql`) |

`www.heybe.dev` redirects to `heybe.dev` (301).

## Waitlist endpoint

- Accepts JSON (`fetch`) or a normal form post (no-JS fallback, answers 303 back to the page with `?joined=1`).
- Validation: email format and length, 4 KB body limit, `Origin` must be heybe.dev when present.
- Abuse protection: hidden honeypot field `website`; at most 5 attempts per IP per 10 minutes. Only a salted SHA-256 hash of the IP is stored.
- Same answer for new and already-registered emails, so it can't be used to look people up.
- **It never sends email.** Invites are sent by hand later.
- Without the `DB` binding it answers `503 waitlist_unavailable` and the page shows "opens in a few days".

Read signups:

```bash
npx wrangler d1 execute heybe-waitlist --remote \
  --command "SELECT email, created_at, lang, source FROM waitlist ORDER BY created_at DESC"
```

## Develop and deploy

```bash
cd apps/website
npx wrangler dev        # local preview at http://localhost:8787 (uses a local D1 if configured)
npx wrangler deploy     # needs a Cloudflare login with Workers Scripts Write + D1 Write on the heybe.dev account
```

No build step. Images in `public/images/` are WebP copies of `docs/images/` mockups. The Inter font (`public/fonts/`) is self-hosted under the SIL Open Font License (`public/fonts/OFL.txt`).
