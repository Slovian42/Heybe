// Unified client errors. The bearer token must never appear in message,
// path, code, or any other field.

export type FastClawErrorKind = "network" | "4xx" | "5xx" | "timeout";

export interface FastClawErrorInit {
  kind: FastClawErrorKind;
  message: string;
  method: string;
  path: string;
  status?: number;
  code?: string;
  errorType?: string;
  retryAfterMs?: number;
}

export class FastClawError extends Error {
  readonly kind: FastClawErrorKind;
  readonly method: string;
  readonly path: string;
  readonly status?: number;
  readonly code?: string;
  readonly errorType?: string;
  readonly retryAfterMs?: number;

  constructor(init: FastClawErrorInit) {
    super(init.message);
    this.name = "FastClawError";
    this.kind = init.kind;
    this.method = init.method;
    this.path = init.path;
    this.status = init.status;
    this.code = init.code;
    this.errorType = init.errorType;
    this.retryAfterMs = init.retryAfterMs;
  }
}

export class FastClawConfigError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `Missing or invalid FastClaw client configuration: ${missing.join(", ")}. ` +
        "Set HEYBE_FASTCLAW_BASE_URL and HEYBE_FASTCLAW_TOKEN. Values are never logged.",
    );
    this.name = "FastClawConfigError";
    this.missing = missing;
  }
}
