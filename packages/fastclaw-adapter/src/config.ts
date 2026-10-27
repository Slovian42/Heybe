import { FastClawConfigError } from "./errors.js";

export const HEYBE_FASTCLAW_BASE_URL = "HEYBE_FASTCLAW_BASE_URL";
/** Chat key: used for POST /v1/chat/completions and reads. Must not be the owner key. */
export const HEYBE_FASTCLAW_CHAT_TOKEN = "HEYBE_FASTCLAW_CHAT_TOKEN";
/** Owner key: only the task manager uses it, only to create/delete Agents via /v1/agents. */
export const HEYBE_FASTCLAW_ADMIN_TOKEN = "HEYBE_FASTCLAW_ADMIN_TOKEN";
/**
 * @deprecated Legacy single-key name. Read as the chat key when
 * HEYBE_FASTCLAW_CHAT_TOKEN is unset. Never used as the admin key.
 */
export const HEYBE_FASTCLAW_TOKEN = "HEYBE_FASTCLAW_TOKEN";
/** End-user id sent on every chat (`X-Fastclaw-End-User` + body `user`). Not an email. */
export const HEYBE_FASTCLAW_END_USER = "HEYBE_FASTCLAW_END_USER";

/** Default end-user when HEYBE_FASTCLAW_END_USER is unset. */
export const DEFAULT_FASTCLAW_END_USER = "heybe-local";

/**
 * Which key a client holds.
 * - `chat`: conversations and reads. Cannot create, change or delete Agents.
 * - `admin`: create/delete Agents and reads. Cannot chat.
 */
export type FastClawClientRole = "chat" | "admin";

export interface FastClawClientConfig {
  baseUrl: string;
  /** Bearer token. Callers must not log this value. */
  token: string;
  role: FastClawClientRole;
  /** Set for the chat role. */
  endUser?: string;
  /** Name of the variable the token came from (never the value). */
  tokenVariable: string;
}

const END_USER_RE = /^[A-Za-z0-9._:@-]{1,128}$/;

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

function readToken(env: Record<string, string | undefined>, name: string): string {
  return env[name]?.trim() ?? "";
}

function chatTokenSource(env: Record<string, string | undefined>): { name: string; token: string } {
  const chat = readToken(env, HEYBE_FASTCLAW_CHAT_TOKEN);
  if (chat) return { name: HEYBE_FASTCLAW_CHAT_TOKEN, token: chat };
  return { name: HEYBE_FASTCLAW_TOKEN, token: readToken(env, HEYBE_FASTCLAW_TOKEN) };
}

/**
 * Read base URL and one key from HEYBE_FASTCLAW_* variables. Never logs a token.
 *
 * `role: "chat"` (default) reads HEYBE_FASTCLAW_CHAT_TOKEN, falling back to the
 * legacy HEYBE_FASTCLAW_TOKEN. `role: "admin"` reads HEYBE_FASTCLAW_ADMIN_TOKEN only.
 * When both keys are set they must differ.
 */
export function loadFastClawClientConfig(
  env: Record<string, string | undefined> = process.env,
  opts: { role?: FastClawClientRole } = {},
): FastClawClientConfig {
  const role = opts.role ?? "chat";
  const baseUrlRaw = env[HEYBE_FASTCLAW_BASE_URL]?.trim() ?? "";
  const chat = chatTokenSource(env);
  const admin = readToken(env, HEYBE_FASTCLAW_ADMIN_TOKEN);
  const source = role === "admin" ? { name: HEYBE_FASTCLAW_ADMIN_TOKEN, token: admin } : chat;

  const missing: string[] = [];
  if (!baseUrlRaw) missing.push(HEYBE_FASTCLAW_BASE_URL);
  if (!source.token) {
    missing.push(role === "admin" ? HEYBE_FASTCLAW_ADMIN_TOKEN : HEYBE_FASTCLAW_CHAT_TOKEN);
  }
  if (missing.length > 0) throw new FastClawConfigError(missing);
  if (/[\r\n]/.test(source.token)) throw new FastClawConfigError([source.name]);
  for (const token of [chat.token, admin]) {
    if (token.length >= 8 && baseUrlRaw.includes(token)) {
      throw new FastClawConfigError([`${HEYBE_FASTCLAW_BASE_URL} must not contain a token`]);
    }
  }
  if (chat.token && admin && chat.token === admin) {
    throw new FastClawConfigError([
      `${HEYBE_FASTCLAW_ADMIN_TOKEN} must differ from ${chat.name} (use a separate non-owner key for chat)`,
    ]);
  }

  const config: FastClawClientConfig = {
    baseUrl: requireAbsoluteHttpUrl(baseUrlRaw),
    token: source.token,
    role,
    tokenVariable: source.name,
  };
  if (role === "chat") {
    const endUser = env[HEYBE_FASTCLAW_END_USER]?.trim() || DEFAULT_FASTCLAW_END_USER;
    if (!END_USER_RE.test(endUser)) {
      throw new FastClawConfigError([`${HEYBE_FASTCLAW_END_USER} must match ${END_USER_RE.source}`]);
    }
    config.endUser = endUser;
  }
  return config;
}
