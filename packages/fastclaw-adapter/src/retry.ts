import type { FastClawErrorKind } from "./errors.js";

/** Total tries include the first attempt. Hard-capped so backoff cannot run away. */
export const RETRY_HARD_MAX_ATTEMPTS = 5;
export const RETRY_HARD_MAX_DELAY_MS = 8_000;

export interface RetryOptions {
  /** Total tries including the first. Clamped to 1..5. Default 3. */
  maxAttempts?: number;
  /** Delay before the second try, in ms. Doubles each failure. Default 200. */
  baseDelayMs?: number;
  /** Cap on one sleep, in ms. Clamped to at most 8000. Default 2000. */
  maxDelayMs?: number;
}

export interface ResolvedRetry {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryableFailure {
  kind: FastClawErrorKind;
  status?: number;
  code?: string;
}

const NO_RETRY_CODES = new Set([
  "invalid_request",
  "unauthorized",
  "forbidden",
  "agent_not_found",
  "project_not_found",
  "file_not_found",
  "quota_not_found",
  "agent_quota_exceeded",
  "not_configured",
  "payment_required",
  "agent_error",
  "aborted",
  "invalid_response",
  "redirect_blocked",
]);

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function resolveRetry(options?: RetryOptions): ResolvedRetry {
  const maxAttempts = clampInt(options?.maxAttempts ?? 3, 1, RETRY_HARD_MAX_ATTEMPTS);
  const maxDelayMs = clampInt(options?.maxDelayMs ?? 2_000, 0, RETRY_HARD_MAX_DELAY_MS);
  const baseDelayMs = clampInt(options?.baseDelayMs ?? 200, 0, maxDelayMs);
  return { maxAttempts, baseDelayMs, maxDelayMs };
}

/**
 * Delay after a failed attempt. `failedAttemptIndex` is 0 for the first failure.
 * `Retry-After` is honored but never above `maxDelayMs`.
 */
export function backoffDelayMs(
  failedAttemptIndex: number,
  retry: ResolvedRetry,
  retryAfterMs?: number,
): number {
  const shift = Math.min(Math.max(0, failedAttemptIndex), 10);
  const exponential = Math.min(retry.maxDelayMs, retry.baseDelayMs * 2 ** shift);
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    return exponential;
  }
  return Math.min(retry.maxDelayMs, Math.max(exponential, retryAfterMs));
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const when = Date.parse(trimmed);
  if (Number.isNaN(when)) return undefined;
  return Math.max(0, when - now);
}

/**
 * Network and timeout retries are limited to idempotent methods so a chat
 * turn is not started twice. HTTP 429 is retried for every method: FastClaw
 * rejects it in rate-limit middleware before the handler runs.
 * POST 5xx (including 502 agent_error) is not retried.
 */
export function isRetryableFastClawError(method: string, error: RetryableFailure): boolean {
  if (error.code && NO_RETRY_CODES.has(error.code)) return false;
  if (error.status === 429 || error.code === "rate_limited") return true;
  const idempotent = IDEMPOTENT.has(method.toUpperCase());
  if (error.kind === "timeout" || error.kind === "network") return idempotent;
  if (!idempotent) return false;
  return error.kind === "5xx";
}
