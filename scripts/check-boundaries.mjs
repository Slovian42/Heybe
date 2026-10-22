// Guards two architecture rules:
// 1. Community must never depend on Pro (no "heybe-pro" / "@heybe-pro/*" anywhere).
// 2. fastclaw-adapter may only call FastClaw /v1/* (no "/api/" paths).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skip = new Set(["node_modules", ".git", "dist", "target", "gen", "docs", "scripts", ".github"]);
const errors = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|mjs|json|toml|rs)$/.test(name) && name !== "pnpm-lock.yaml") check(p);
  }
}
function check(p) {
  const src = readFileSync(p, "utf8");
  if (/@heybe-pro\/|["']heybe-pro["']/.test(src)) errors.push(`${p}: Community must not depend on Pro`);
  if (p.includes("packages/fastclaw-adapter/src") && /["'`][^"'`\n]*\/api\//.test(src))
    errors.push(`${p}: adapter must only use /v1/*`);
}
walk(root);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
console.log("boundary check: ok");
