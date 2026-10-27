import { randomUUID } from "node:crypto";
import { inspect, type InspectOptions } from "node:util";
import type {
  FastClawFileDownload,
  FastClawSession,
  V1Agent,
  V1AgentList,
  V1ChatCompletion,
  V1ChatMessage,
  V1ChatRequest,
  V1StreamEvent,
} from "@heybe/shared-types";
import { loadFastClawClientConfig, type FastClawClientConfig } from "./config.js";
import { FastClawConfigError, FastClawError } from "./errors.js";
import {
  assertSegment,
  assertV1Path,
  fileNameFromDisposition,
  invalidRequest,
  sessionFilePath,
} from "./paths.js";
import { redactSecrets } from "./redact.js";
import {
  backoffDelayMs,
  isRetryableFastClawError,
  parseRetryAfter,
  resolveRetry,
  type ResolvedRetry,
  type RetryOptions,
} from "./retry.js";
import { parseChatSse, SseParseError, sseFailure } from "./sse.js";

export const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Routes this client calls. There is no /v1 health or cancel route in v1.4.0;
 * `health` probes GET /v1/agents, and cancellation is the caller's AbortSignal.
 */
export const FASTCLAW_V1_CLIENT_ROUTES = [
  "GET /v1/agents",
  "GET /v1/agents/{id}",
  "POST /v1/chat/completions",
  "GET /v1/agents/{id}/sessions/{session}/files/{path}",
] as const;

export interface FastClawClientOptions {
  baseUrl: string;
  /**
   * Bearer token from HEYBE_FASTCLAW_TOKEN (or the keychain).
   * Stored privately and redacted from errors. Never log it.
   */
  token: string;
  fetchImpl?: typeof fetch;
  /** Header timeout for every call, and body timeout for JSON/bytes. Default 30000. 0 disables. */
  timeoutMs?: number;
  retry?: RetryOptions;
  sleep?: (ms: number) => Promise<void>;
}

export interface CallOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export interface ListAgentsOptions extends CallOptions {
  /** 1–100. Omit to ask for every agent in one page. */
  limit?: number;
  cursor?: string;
  metadata?: Record<string, string>;
}

export interface SendMessageInput extends CallOptions {
  messages: V1ChatMessage[];
  /**
   * Passed through on the wire when set. Does not override the agent model.
   * See `V1ChatRequest.model`.
   */
  model?: string;
  params?: Record<string, unknown>;
  returnFiles?: "inline";
}

export interface CreateSessionInput {
  agentId: string;
  /** Stable conversation id. Defaults to `heybe:<uuid>`. */
  sessionKey?: string;
  endUser?: string;
  projectId?: string;
}

export interface GetSessionFileInput extends CallOptions {
  agentId: string;
  sessionKey: string;
  path: string;
  projectId?: string;
  endUser?: string;
}

interface SendOptions extends CallOptions {
  body?: unknown;
  /** Keep the caller's signal wired to the response body (SSE). */
  keepSignalForBody?: boolean;
}

function resolveTimeout(ms: number | undefined, fallback: number | undefined): number | undefined {
  const value = ms !== undefined ? ms : fallback;
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (value === 0) return undefined;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_TIMEOUT_MS;
  return value;
}

function asRecord(value: unknown, method: string, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FastClawError({
      kind: "5xx",
      status: 200,
      method,
      path,
      code: "invalid_response",
      message: `FastClaw ${method} ${path} returned an unexpected payload`,
    });
  }
  return value as Record<string, unknown>;
}

export class FastClawClient {
  readonly baseUrl: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number | undefined;
  readonly #retry: ResolvedRetry;
  readonly #sleepImpl?: (ms: number) => Promise<void>;

  constructor(opts: FastClawClientOptions) {
    const token = opts.token?.trim() ?? "";
    if (!token || /[\r\n]/.test(token)) throw new FastClawConfigError(["token"]);
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    if (!this.baseUrl) throw new FastClawConfigError(["baseUrl"]);
    this.#token = token;
    this.#fetch = opts.fetchImpl ?? fetch;
    this.#timeoutMs = resolveTimeout(opts.timeoutMs, DEFAULT_TIMEOUT_MS);
    this.#retry = resolveRetry(opts.retry);
    this.#sleepImpl = opts.sleep;
  }

  toJSON(): { baseUrl: string } {
    return { baseUrl: this.baseUrl };
  }

  [Symbol.for("nodejs.util.inspect.custom")](depth: number, options: InspectOptions): string {
    void depth;
    void options;
    return `FastClawClient { baseUrl: ${inspect(this.baseUrl)} }`;
  }

  /**
   * Authenticated connectivity probe.
   * v1.4.0 registers no /v1 health route. The integration guide checks the
   * key with GET /v1/agents, which is what this calls (`limit=1`).
   * Unauthenticated process probes exist outside /v1 and are not called.
   */
  async health(init?: CallOptions): Promise<{ ok: true; probe: "GET /v1/agents" }> {
    await this.listAgents({ limit: 1, signal: init?.signal, timeoutMs: init?.timeoutMs });
    return { ok: true, probe: "GET /v1/agents" };
  }

  async listAgents(options: ListAgentsOptions = {}): Promise<V1AgentList> {
    const path = agentListPath(options);
    const payload = await this.request<unknown>("GET", path, undefined, options);
    const record = asRecord(payload, "GET", path);
    if (!Array.isArray(record.agents) || typeof record.has_more !== "boolean") {
      throw new FastClawError({
        kind: "5xx",
        status: 200,
        method: "GET",
        path,
        code: "invalid_response",
        message: "FastClaw GET /v1/agents returned an unexpected payload",
      });
    }
    return record as unknown as V1AgentList;
  }

  async getAgent(id: string, init?: CallOptions): Promise<V1Agent> {
    const agentId = assertSegment(id, "agent id", "GET", "/v1/agents");
    const path = `/v1/agents/${encodeURIComponent(agentId)}`;
    const payload = await this.request<unknown>("GET", path, undefined, init);
    const record = asRecord(payload, "GET", path);
    const agent = record.agent;
    if (!agent || typeof agent !== "object" || typeof (agent as V1Agent).id !== "string") {
      throw new FastClawError({
        kind: "5xx",
        status: 200,
        method: "GET",
        path,
        code: "invalid_response",
        message: `FastClaw GET ${path} returned an unexpected payload`,
      });
    }
    return agent as V1Agent;
  }

  /**
   * Build a session key locally. No HTTP call: FastClaw opens the session
   * on the first chat that sends `X-Fastclaw-Session-Key`.
   */
  createSession(input: CreateSessionInput): FastClawSession {
    const agentId = assertSegment(input.agentId, "agent id", "POST", "/v1/chat/completions");
    let sessionKey = input.sessionKey?.trim() ?? "";
    if (!sessionKey) sessionKey = `heybe:${randomUUID()}`;
    if (/[\r\n]/.test(sessionKey) || sessionKey.length > 512) {
      throw invalidRequest("POST", "/v1/chat/completions", "Invalid session key");
    }
    const endUser = optionalHeader(input.endUser, "end user");
    const projectId = optionalHeader(input.projectId, "project id");
    return { agentId, sessionKey, endUser, projectId };
  }

  /** Non-streaming chat on an existing session handle. */
  async sendMessage(session: FastClawSession, input: SendMessageInput): Promise<V1ChatCompletion> {
    assertUserMessage(input.messages);
    const path = "/v1/chat/completions";
    const payload = await this.request<unknown>("POST", path, chatBody(session, input, false), {
      ...input,
      headers: sessionHeaders(session),
    });
    const record = asRecord(payload, "POST", path);
    if (!Array.isArray(record.choices)) {
      throw new FastClawError({
        kind: "5xx",
        status: 200,
        method: "POST",
        path,
        code: "invalid_response",
        message: "FastClaw POST /v1/chat/completions returned an unexpected payload",
      });
    }
    return record as unknown as V1ChatCompletion;
  }

  /**
   * Streaming chat. Parses FastClaw's OpenAI SSE chunks, including tool
   * steps and the final `files` / `usage` chunk.
   *
   * v1.4.0 has no /v1 cancel or stop route. Pass `signal` to abort this
   * HTTP request. That only drops the client connection; it is not a
   * verified server-side stop.
   */
  async *streamMessage(session: FastClawSession, input: SendMessageInput): AsyncGenerator<V1StreamEvent> {
    assertUserMessage(input.messages);
    const path = "/v1/chat/completions";
    const res = await this.#send("POST", path, {
      ...input,
      headers: { ...sessionHeaders(session), Accept: "text/event-stream" },
      body: chatBody(session, input, true),
      keepSignalForBody: true,
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      throw await this.#errorFromResponse(res, "POST", path);
    }
    if (!res.body) {
      throw new FastClawError({
        kind: "network",
        method: "POST",
        path,
        code: "invalid_response",
        message: "FastClaw POST /v1/chat/completions returned an empty stream",
      });
    }
    try {
      for await (const event of parseChatSse(res.body)) {
        if (event.type === "error") {
          throw sseFailure({
            ...event.error,
            message: redactSecrets(event.error.message, [this.#token]),
          });
        }
        yield event;
      }
    } catch (err) {
      if (err instanceof FastClawError) throw err;
      if (err instanceof SseParseError) {
        throw new FastClawError({
          kind: "5xx",
          status: 200,
          method: "POST",
          path,
          code: "invalid_response",
          message: "FastClaw POST /v1/chat/completions failed (5xx): invalid_response",
        });
      }
      throw err;
    }
  }

  /** Download a file produced in a session. Same end-user header as the conversation. */
  async getSessionFile(input: GetSessionFileInput): Promise<FastClawFileDownload> {
    const path = sessionFilePath(input.agentId, input.sessionKey, input.path, input.projectId);
    const headers: Record<string, string> = {};
    const endUser = optionalHeader(input.endUser, "end user");
    if (endUser) headers["X-Fastclaw-End-User"] = endUser;
    const res = await this.#send("GET", path, { ...input, headers });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      bytes,
      contentType: res.headers.get("content-type"),
      fileName: fileNameFromDisposition(res.headers.get("content-disposition")),
    };
  }

  async request<T>(method: string, path: string, body?: unknown, init?: CallOptions): Promise<T> {
    const res = await this.#send(method, path, { ...init, body });
    const text = await res.text();
    if (!text) {
      throw new FastClawError({
        kind: "5xx",
        status: res.status,
        method: method.toUpperCase(),
        path,
        code: "invalid_response",
        message: `FastClaw ${method.toUpperCase()} ${path} returned an empty body`,
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new FastClawError({
        kind: "5xx",
        status: res.status,
        method: method.toUpperCase(),
        path,
        code: "invalid_response",
        message: `FastClaw ${method.toUpperCase()} ${path} returned invalid JSON`,
      });
    }
  }

  async #send(method: string, path: string, init: SendOptions = {}): Promise<Response> {
    const verb = method.toUpperCase();
    assertV1Path(path);
    const headers = this.#headers(verb, init.headers, init.body !== undefined);
    const timeoutMs = resolveTimeout(init.timeoutMs, this.#timeoutMs);
    let lastError: FastClawError | undefined;
    for (let attempt = 0; attempt < this.#retry.maxAttempts; attempt++) {
      if (init.signal?.aborted) {
        throw aborted(verb, path);
      }
      let error: FastClawError | undefined;
      try {
        const res = await this.#fetchOnce(verb, path, headers, init.body, timeoutMs, init.signal, init.keepSignalForBody);
        if (res.status >= 300 && res.status < 400) {
          await drain(res);
          error = new FastClawError({
            kind: "4xx",
            status: res.status,
            method: verb,
            path,
            code: "redirect_blocked",
            message: `FastClaw ${verb} ${path} was redirected; only a direct /v1 response is accepted`,
          });
        } else if (!res.ok) {
          error = await this.#errorFromResponse(res, verb, path);
        } else {
          return res;
        }
      } catch (err) {
        error = err instanceof FastClawError ? err : this.#networkError(err, verb, path);
      }
      if (!error) throw aborted(verb, path);
      lastError = error;
      const canRetry =
        attempt < this.#retry.maxAttempts - 1 && isRetryableFastClawError(verb, error);
      if (!canRetry) throw error;
      await this.#sleep(backoffDelayMs(attempt, this.#retry, error.retryAfterMs));
    }
    throw lastError ?? aborted(verb, path);
  }

  async #fetchOnce(
    method: string,
    path: string,
    headers: Record<string, string>,
    body: unknown,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
    keepSignalForBody = false,
  ): Promise<Response> {
    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs);
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let keepListener = false;
    try {
      const res = await this.#fetch(this.baseUrl + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        redirect: "manual",
        cache: "no-store",
      });
      // Streaming: the caller's abort must still drop the connection while the body is read.
      keepListener = keepSignalForBody && !!signal && !signal.aborted;
      return res;
    } catch (err) {
      if (timedOut) {
        throw new FastClawError({
          kind: "timeout",
          method,
          path,
          message: `FastClaw ${method} ${path} timed out after ${timeoutMs}ms`,
        });
      }
      if (signal?.aborted || controller.signal.aborted) throw aborted(method, path);
      throw this.#networkError(err, method, path);
    } finally {
      if (timer) clearTimeout(timer);
      if (!keepListener) signal?.removeEventListener("abort", onAbort);
    }
  }

  #headers(method: string, extra: Record<string, string> | undefined, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: extra?.Accept ?? "application/json",
    };
    if (hasBody && method !== "GET" && method !== "HEAD") headers["Content-Type"] = "application/json";
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        if (/[\r\n]/.test(key) || /[\r\n]/.test(value)) {
          throw invalidRequest(method, "/v1/agents", "Invalid header value");
        }
        if (key.toLowerCase() === "authorization") continue;
        headers[key] = value;
      }
    }
    return headers;
  }

  async #errorFromResponse(res: Response, method: string, path: string): Promise<FastClawError> {
    let code: string | undefined;
    let errorType: string | undefined;
    let detail = "";
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { error?: { type?: unknown; code?: unknown; message?: unknown } };
      const body = parsed?.error;
      if (body && typeof body === "object") {
        if (typeof body.type === "string") errorType = body.type;
        if (typeof body.code === "string") code = body.code;
        if (typeof body.message === "string") detail = redactSecrets(body.message, [this.#token]);
      }
    } catch {
      detail = "";
    }
    const kind: FastClawError["kind"] = res.status >= 500 ? "5xx" : "4xx";
    const summary = detail ? `${code ?? "error"}: ${detail}` : String(res.status);
    return new FastClawError({
      kind,
      status: res.status,
      method,
      path,
      code,
      errorType,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      message: `FastClaw ${method} ${path} failed (${kind}): ${summary}`,
    });
  }

  #networkError(err: unknown, method: string, path: string): FastClawError {
    const raw = err instanceof Error ? err.message : "network failure";
    return new FastClawError({
      kind: "network",
      method,
      path,
      message: `FastClaw ${method} ${path} failed (network): ${redactSecrets(raw, [this.#token])}`,
    });
  }

  async #sleep(ms: number): Promise<void> {
    if (ms <= 0) return;
    if (this.#sleepImpl) {
      await this.#sleepImpl(ms);
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

function aborted(method: string, path: string): FastClawError {
  return new FastClawError({
    kind: "network",
    method,
    path,
    code: "aborted",
    message: `FastClaw ${method} ${path} was aborted`,
  });
}

async function drain(res: Response): Promise<void> {
  try {
    await res.arrayBuffer();
  } catch {
    /* ignore */
  }
}

function optionalHeader(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[\r\n]/.test(trimmed)) throw invalidRequest("POST", "/v1/chat/completions", `Invalid ${label}`);
  return trimmed;
}

function assertUserMessage(messages: V1ChatMessage[]): void {
  const ok = messages.some((message) => message.role === "user" && message.content.trim() !== "");
  if (!ok) throw invalidRequest("POST", "/v1/chat/completions", "A non-empty user message is required");
}

function sessionHeaders(session: FastClawSession): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Fastclaw-Session-Key": session.sessionKey,
    "X-Fastclaw-Agent-ID": session.agentId,
  };
  if (session.endUser) headers["X-Fastclaw-End-User"] = session.endUser;
  return headers;
}

function chatBody(session: FastClawSession, input: SendMessageInput, stream: boolean): V1ChatRequest {
  const body: V1ChatRequest = {
    agent_id: session.agentId,
    messages: input.messages,
    stream,
  };
  if (input.model !== undefined) body.model = input.model;
  if (session.endUser) body.user = session.endUser;
  if (session.projectId) body.project_id = session.projectId;
  if (input.params) body.params = input.params;
  if (input.returnFiles) body.return_files = input.returnFiles;
  return body;
}

function agentListPath(options: ListAgentsOptions): string {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
      throw invalidRequest("GET", "/v1/agents", "limit must be an integer from 1 to 100");
    }
    params.set("limit", String(options.limit));
  }
  if (options.cursor) {
    if (/[\r\n]/.test(options.cursor)) throw invalidRequest("GET", "/v1/agents", "Invalid cursor");
    params.set("cursor", options.cursor);
  }
  if (options.metadata) {
    for (const [key, value] of Object.entries(options.metadata)) {
      if (!key || /[\r\n&=]/.test(key) || /[\r\n]/.test(value)) {
        throw invalidRequest("GET", "/v1/agents", "Invalid metadata filter");
      }
      params.append(`metadata[${key}]`, value);
    }
  }
  const query = params.toString();
  return query ? `/v1/agents?${query}` : "/v1/agents";
}

export function fastClawClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<Omit<FastClawClientOptions, "baseUrl" | "token">> = {},
): FastClawClient {
  const config: FastClawClientConfig = loadFastClawClientConfig(env);
  return new FastClawClient({ ...overrides, baseUrl: config.baseUrl, token: config.token });
}
