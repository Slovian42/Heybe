// Map chat failures to a specific Chinese reason (#19 Mac 复验问题 2).
//
// What FastClaw v1.4.0 actually sends (checked 2026-11-02 with the real gateway, a fake key and a
// mock OpenAI-compatible upstream; full list in docs/t19-desktop-chat.md):
//   stream (what the UI uses): HTTP 200, last chunk carries
//     "error": {"type":"server_error","code":"agent_error","message":"API error 401: {…upstream JSON…}"}
//   non-stream: HTTP 502 {"error":{"code":"agent_error","type":"server_error","message":<same text>}}
//   upstream unreachable: message `send request: Post "<url>": dial tcp …: connect: connection refused`
//     or `…: EOF`, after FastClaw's own retries (~60s; 429 and 5xx are retried too).
// The upstream body can echo part of the key (DeepSeek: "Your api key: ****abcd is invalid"), so
// nothing from it reaches the UI: only a fixed Chinese text plus a short code built from digits and
// a strictly matched `[a-z_]` token.
import type { ChatErrorKind, ChatErrorReason } from "@heybe/shared-types/chat";
import { chatErrorMessage } from "@heybe/shared-types/chat";

export interface ClassifiedChatError {
  kind: ChatErrorKind;
  reason: ChatErrorReason;
  code?: string;
  message: string;
}

interface ErrLike {
  kind?: string;
  status?: number;
  code?: string;
  message?: string;
}

const SAFE_CODE = /^[a-z0-9_]{1,40}$/i;

function safe(code: string | undefined): string | undefined {
  return code && SAFE_CODE.test(code) ? code.toLowerCase() : undefined;
}

/** Upstream `"type"` / `"code"` token from the relayed JSON (escaped or not). Only `[a-z_]`. */
function upstreamToken(text: string, field: "type" | "code"): string | undefined {
  const m = new RegExp(`\\\\?"${field}\\\\?"\\s*:\\s*\\\\?"([a-z_]{1,40})\\\\?"`).exec(text);
  return m?.[1];
}

function make(kind: ChatErrorKind, reason: ChatErrorReason, code?: string): ClassifiedChatError {
  return { kind, reason, ...(code ? { code } : {}), message: chatErrorMessage(reason, code) };
}

/** Classify an upstream model error by FastClaw's `API error <status>: <body>` text. */
export function classifyUpstreamStatus(status: number, text: string): ClassifiedChatError {
  const type = upstreamToken(text, "type");
  const ucode = upstreamToken(text, "code");
  const code = `upstream_${status}`;
  if (status === 402 || /insufficient.?balance|insufficient_quota|余额不足/i.test(text)) return make("failed", "insufficient_balance", code);
  if (status === 401 || status === 403 || type === "authentication_error") return make("failed", "key_invalid", code);
  if (status === 429) return make("failed", "rate_limited", code);
  if (status === 404 || ucode === "model_not_found" || /model.{0,20}not.?exist|model.{0,40}does not exist|model.{0,20}not.?found/i.test(text)) {
    return make("failed", "model_not_found", code);
  }
  if (status === 408 || status === 504) return make("failed", "timeout", code);
  return make("failed", "unknown", type && type !== "server_error" ? `${code}/${type}` : code);
}

/** Map FastClaw adapter errors to a UI reason without leaking upstream text or keys. */
export function classifyChatError(err: unknown): ClassifiedChatError {
  const e = (err ?? {}) as ErrLike;
  const text = typeof e.message === "string" ? e.message : "";
  if (e.code === "stream_truncated") return make("interrupted", "interrupted");
  const api = /API error (\d{3})\b/.exec(text);
  if (api) return classifyUpstreamStatus(Number(api[1]), text);
  // FastClaw could not reach the model API (after its own retries).
  if (/send request:|dial tcp|no such host|connection refused|connection reset|broken pipe|\bEOF\b|tls: |x509: /i.test(text)) {
    if (/timeout awaiting response headers|Client\.Timeout|context deadline exceeded/i.test(text)) return make("failed", "timeout", "upstream_timeout");
    return make("failed", "network", "upstream_unreachable");
  }
  if (/timeout awaiting response headers|Client\.Timeout|context deadline exceeded|i\/o timeout/i.test(text)) {
    return make("failed", "timeout", "upstream_timeout");
  }
  if (/model.{0,20}not.?(found|exist)/i.test(text)) return make("failed", "model_not_found", safe(e.code));
  // The local gateway itself: unreachable, timed out, or refused Heybe's own token.
  if (e.kind === "network" || e.kind === "timeout") return make("unavailable", "runtime_unavailable", safe(e.code));
  if (e.status === 401 || e.status === 403) return make("unavailable", "runtime_unavailable", `fastclaw_${e.status}`);
  const code = safe(e.code) ?? (typeof e.status === "number" && e.status !== 200 ? `http_${e.status}` : undefined);
  return make("failed", "unknown", code ?? "unknown");
}
