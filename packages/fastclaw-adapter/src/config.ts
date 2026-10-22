import { FastClawConfigError } from "./errors.js";

export const HEYBE_FASTCLAW_BASE_URL = "HEYBE_FASTCLAW_BASE_URL";
export const HEYBE_FASTCLAW_TOKEN = "HEYBE_FASTCLAW_TOKEN";

export interface FastClawClientConfig {
  baseUrl: string;
  /** Bearer token. Callers must not log this value. */
  token: string;
}

function requireAbsoluteHttpUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FastClawConfigError([`${HEYBE_FASTCLAW_BASE_URL} must be an absolute http(s) URL`]);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new FastClawConfigError([`${HEYBE_FASTCLAW_BASE_URL} must use http or https`]);
  }
  if (url.username || url.password || url.href.includes("@")) {
    throw new FastClawConfigError([`${HEYBE_FASTCLAW_BASE_URL} must not include credentials`]);
  }
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Read base URL and token from HEYBE_FASTCLAW_* variables. Never logs the token. */
export function loadFastClawClientConfig(
  env: Record<string, string | undefined> = process.env,
): FastClawClientConfig {
  const baseUrlRaw = env[HEYBE_FASTCLAW_BASE_URL]?.trim() ?? "";
  const token = env[HEYBE_FASTCLAW_TOKEN]?.trim() ?? "";
  const missing: string[] = [];
  if (!baseUrlRaw) missing.push(HEYBE_FASTCLAW_BASE_URL);
  if (!token) missing.push(HEYBE_FASTCLAW_TOKEN);
  if (missing.length > 0) throw new FastClawConfigError(missing);
  if (/[\r\n]/.test(token)) throw new FastClawConfigError([HEYBE_FASTCLAW_TOKEN]);
  if (token.length >= 8 && baseUrlRaw.includes(token)) {
    throw new FastClawConfigError([`${HEYBE_FASTCLAW_BASE_URL} must not contain the token`]);
  }
  return { baseUrl: requireAbsoluteHttpUrl(baseUrlRaw), token };
}
