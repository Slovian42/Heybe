import { describe, expect, it } from "vitest";
import {
  RETRY_HARD_MAX_ATTEMPTS,
  RETRY_HARD_MAX_DELAY_MS,
  backoffDelayMs,
  isRetryableFastClawError,
  resolveRetry,
} from "../src/retry.js";

describe("bounded backoff", () => {
  it("clamps attempts and delay", () => {
    const retry = resolveRetry({ maxAttempts: 99, baseDelayMs: 50_000, maxDelayMs: 90_000 });
    expect(retry.maxAttempts).toBe(RETRY_HARD_MAX_ATTEMPTS);
    expect(retry.maxDelayMs).toBe(RETRY_HARD_MAX_DELAY_MS);
    expect(retry.baseDelayMs).toBe(RETRY_HARD_MAX_DELAY_MS);
    expect(backoffDelayMs(0, retry)).toBe(RETRY_HARD_MAX_DELAY_MS);
    expect(backoffDelayMs(8, resolveRetry({ baseDelayMs: 200, maxDelayMs: 2_000 }))).toBe(2_000);
  });

  it("doubles until the cap and honors Retry-After inside that cap", () => {
    const retry = resolveRetry({ baseDelayMs: 200, maxDelayMs: 2_000 });
    expect(backoffDelayMs(0, retry)).toBe(200);
    expect(backoffDelayMs(1, retry)).toBe(400);
    expect(backoffDelayMs(2, retry)).toBe(800);
    expect(backoffDelayMs(0, retry, 1_000)).toBe(1_000);
    expect(backoffDelayMs(0, retry, 30_000)).toBe(2_000);
  });

  it("retries transport errors only for idempotent methods, and 429 for every method", () => {
    expect(isRetryableFastClawError("GET", { kind: "network" })).toBe(true);
    expect(isRetryableFastClawError("POST", { kind: "network" })).toBe(false);
    expect(isRetryableFastClawError("GET", { kind: "timeout" })).toBe(true);
    expect(isRetryableFastClawError("POST", { kind: "timeout" })).toBe(false);
    expect(isRetryableFastClawError("POST", { kind: "4xx", status: 429, code: "rate_limited" })).toBe(true);
    expect(isRetryableFastClawError("POST", { kind: "5xx", status: 502, code: "agent_error" })).toBe(false);
    expect(isRetryableFastClawError("GET", { kind: "4xx", status: 404, code: "file_not_found" })).toBe(false);
    expect(isRetryableFastClawError("GET", { kind: "5xx", status: 503, code: "not_configured" })).toBe(false);
    expect(isRetryableFastClawError("GET", { kind: "5xx", status: 503 })).toBe(true);
    expect(isRetryableFastClawError("GET", { kind: "network", code: "aborted" })).toBe(false);
  });
});
