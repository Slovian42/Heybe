import { timingSafeEqual } from "node:crypto";
import type { ProviderConfig, ProviderTestResult } from "@heybe/shared-types";
import { ValidationError } from "./errors.js";
import type { SecretStore } from "./provider-secrets.js";

/**
 * /providers/* routes (#16). Loopback only (same server as /tasks).
 * Responses never contain a key: at most `{ set, last4 }` or `{ match }`.
 *
 *   GET    /providers/keys/:ref          → ProviderKeyStatus
 *   PUT    /providers/keys/:ref          {value} → ProviderKeyStatus
 *   POST   /providers/keys/:ref/verify   {value} → {match}
 *   DELETE /providers/keys/:ref          → {deleted: true}
 *   POST   /providers/test               ProviderConfig → ProviderTestResult
 */
export interface ProviderHttpDeps {
  secrets: SecretStore;
  test: (cfg: ProviderConfig) => Promise<ProviderTestResult>;
}

const REF_RE = /^[\w.-]{1,128}$/;

function parse(body: string | undefined): Record<string, unknown> {
  const v = body ? (JSON.parse(body) as unknown) : {};
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new ValidationError("body must be an object");
  return v as Record<string, unknown>;
}

function value(body: string | undefined): string {
  const v = parse(body).value;
  if (typeof v !== "string" || v.length === 0 || v.length > 512) throw new ValidationError("value must be a non-empty string");
  return v;
}

export async function handleProviderRoute(
  deps: ProviderHttpDeps,
  method: string,
  path: string,
  body: string | undefined,
): Promise<{ status: number; body: unknown } | undefined> {
  if (path === "/providers/test") {
    if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
    return { status: 200, body: await deps.test(parse(body) as unknown as ProviderConfig) };
  }
  const m = /^\/providers\/keys\/([^/]+)(\/verify)?$/.exec(path);
  if (!m) return undefined;
  const ref = decodeURIComponent(m[1] ?? "");
  if (!REF_RE.test(ref)) throw new ValidationError("invalid key ref");
  if (m[2]) {
    if (method !== "POST") return { status: 405, body: { error: "method not allowed" } };
    const want = Buffer.from(value(body));
    const have = Buffer.from((await deps.secrets.get(ref)) ?? "");
    return { status: 200, body: { match: want.length === have.length && timingSafeEqual(want, have) } };
  }
  if (method === "GET") return { status: 200, body: await deps.secrets.status(ref) };
  if (method === "PUT") {
    try {
      await deps.secrets.set(ref, value(body));
    } catch (e) {
      // Store errors are written to never contain the value.
      return { status: 422, body: { error: e instanceof Error ? e.message : "写入失败" } };
    }
    return { status: 200, body: await deps.secrets.status(ref) };
  }
  if (method === "DELETE") {
    await deps.secrets.delete(ref);
    return { status: 200, body: { deleted: true } };
  }
  return { status: 405, body: { error: "method not allowed" } };
}
