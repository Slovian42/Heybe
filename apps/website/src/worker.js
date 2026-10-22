// heybe.dev: static pages (served from ./public via the ASSETS binding) plus the waitlist endpoint.
// Waitlist rows live in the D1 database bound as DB (see schema.sql). No emails are ever sent from here.

const CANONICAL_HOST = "heybe.dev";
const ALLOWED_ORIGINS = new Set(["https://heybe.dev", "https://www.heybe.dev"]);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const MAX_BODY_BYTES = 4096;
const RATE_LIMIT = 5; // attempts per IP per window
const RATE_WINDOW = "-10 minutes";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Strict-Transport-Security": "max-age=31536000"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === `www.${CANONICAL_HOST}`) {
      url.hostname = CANONICAL_HOST;
      return Response.redirect(url.toString(), 301);
    }
    if (url.pathname === "/api/waitlist") return secure(await waitlist(request, env, ctx));
    if (url.pathname.startsWith("/api/")) return secure(json({ ok: false, error: "not_found" }, 404));
    return secure(await env.ASSETS.fetch(request));
  }
};

function secure(res) {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
  return out;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readInput(request) {
  const type = (request.headers.get("content-type") || "").toLowerCase();
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { tooLarge: true };
  if (type.includes("application/json")) {
    try {
      const data = JSON.parse(raw);
      return { data: data && typeof data === "object" ? data : {}, isForm: false };
    } catch {
      return { data: {}, isForm: false };
    }
  }
  return { data: Object.fromEntries(new URLSearchParams(raw)), isForm: true };
}

async function waitlist(request, env, ctx) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!env.DB) return json({ ok: false, error: "waitlist_unavailable" }, 503);
  const origin = request.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json({ ok: false, error: "forbidden" }, 403);

  const input = await readInput(request);
  if (input.tooLarge) return json({ ok: false, error: "too_large" }, 413);
  const { data, isForm } = input;
  const lang = data.lang === "zh-Hans" ? "zh-Hans" : "en";
  const done = () =>
    isForm
      ? Response.redirect(`https://${CANONICAL_HOST}${lang === "zh-Hans" ? "/zh" : "/"}?joined=1#join`, 303)
      : json({ ok: true });

  // Honeypot: bots fill the hidden "website" field. Pretend success, store nothing.
  if (typeof data.website === "string" && data.website.trim() !== "") return done();

  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL_RE.test(email)) return json({ ok: false, error: "invalid_email" }, 400);
  const source = data.source === "hero" || data.source === "footer" ? data.source : "other";

  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const ipHash = (await sha256Hex(`${env.IP_SALT || ""}:${ip}`)).slice(0, 32);

  const recent = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM waitlist_attempts WHERE ip_hash = ?1 AND created_at > datetime('now', ?2)"
  ).bind(ipHash, RATE_WINDOW).first();
  if (recent && recent.n >= RATE_LIMIT) return json({ ok: false, error: "rate_limited" }, 429);

  await env.DB.batch([
    env.DB.prepare("INSERT INTO waitlist_attempts (ip_hash, created_at) VALUES (?1, datetime('now'))").bind(ipHash),
    env.DB.prepare(
      "INSERT INTO waitlist (email, created_at, lang, source, ip_hash) VALUES (?1, datetime('now'), ?2, ?3, ?4) ON CONFLICT(email) DO NOTHING"
    ).bind(email, lang, source, ipHash)
  ]);
  ctx.waitUntil(
    env.DB.prepare("DELETE FROM waitlist_attempts WHERE created_at < datetime('now', '-1 day')").run().catch(() => {})
  );
  // Same answer for new and existing emails, so the endpoint can't be used to check who signed up.
  return done();
}
