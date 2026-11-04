import type { V1ApiError, V1ChatChunk, V1StreamEvent } from "@heybe/shared-types";
import { FastClawError } from "./errors.js";

export class SseParseError extends Error {
  constructor() {
    super("FastClaw SSE payload was not valid JSON");
    this.name = "SseParseError";
  }
}

/**
 * The body ended (or the connection dropped) before `data: [DONE]`.
 * FastClaw v1.4.0 sends `[DONE]` after every finished turn, so a missing one means
 * the gateway stopped / restarted or the connection broke mid-turn (#9).
 */
export class SseTruncatedError extends Error {
  constructor() {
    super("FastClaw SSE stream ended before [DONE]");
    this.name = "SseTruncatedError";
  }
}

/** No bytes at all (not even FastClaw's 15 s `: ping`) for the idle limit: the connection hung. */
export class SseIdleTimeoutError extends Error {
  constructor(readonly idleMs: number) {
    super(`FastClaw SSE stream was silent for ${idleMs}ms`);
    this.name = "SseIdleTimeoutError";
  }
}

/**
 * Wrap a body so it errors with SseIdleTimeoutError when no chunk arrives for `idleMs`.
 * FastClaw v1.4.0 writes `: ping` every 15 s while a tool runs, so silence means a hung
 * connection, not a slow model. The source is cancelled on timeout.
 */
export function withIdleTimeout(stream: ReadableStream<Uint8Array>, idleMs: number): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const idle = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SseIdleTimeoutError(idleMs)), idleMs);
      });
      try {
        const r = await Promise.race([reader.read(), idle]);
        if (r.done) controller.close();
        else controller.enqueue(r.value);
      } catch (err) {
        if (err instanceof SseIdleTimeoutError) void reader.cancel(err).catch(() => undefined);
        controller.error(err);
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

export async function* iterateSseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let dataLines: string[] = [];

  const consume = function* (text: string, flush: boolean): Generator<string> {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = flush ? "" : (lines.pop() ?? "");
    for (const line of lines) {
      if (line === "") {
        if (dataLines.length > 0) {
          yield dataLines.join("\n");
          dataLines = [];
        }
        continue;
      }
      if (line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (flush && dataLines.length > 0) {
      yield dataLines.join("\n");
      dataLines = [];
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        yield* consume(decoder.decode(), true);
        return;
      }
      yield* consume(decoder.decode(value, { stream: true }), false);
    }
  } finally {
    reader.releaseLock();
  }
}

function eventsFromChunk(raw: V1ChatChunk): Array<V1StreamEvent | { type: "error"; error: V1ApiError }> {
  if (raw.error) return [{ type: "error", error: raw.error }];
  const out: V1StreamEvent[] = [];
  const choice = raw.choices?.[0];
  const content = choice?.delta?.content;
  if (content) out.push({ type: "delta", content });
  if (raw.tool) out.push({ type: "tool", tool: raw.tool });
  const finish = choice?.finish_reason;
  if (finish || raw.usage || raw.files) {
    out.push({
      type: "done",
      finishReason: finish ?? null,
      usage: raw.usage,
      files: raw.files,
    });
  }
  return out;
}

/**
 * Parse a FastClaw chat SSE body. Yields `error` for an in-band turn failure; the client throws.
 * Throws SseTruncatedError when the body ends without `[DONE]`.
 */
export async function* parseChatSse(
  stream: ReadableStream<Uint8Array>,
  opts: { onModel?: (model: string) => void } = {},
): AsyncGenerator<V1StreamEvent | { type: "error"; error: V1ApiError }> {
  let modelSeen = false;
  for await (const data of iterateSseData(stream)) {
    if (data === "[DONE]") return;
    let raw: V1ChatChunk;
    try {
      raw = JSON.parse(data) as V1ChatChunk;
    } catch {
      throw new SseParseError();
    }
    if (!raw || typeof raw !== "object") throw new SseParseError();
    // Every FastClaw chunk carries the agent's configured `<provider>/<model>`; report it once.
    if (!modelSeen && typeof raw.model === "string" && raw.model) {
      modelSeen = true;
      opts.onModel?.(raw.model);
    }
    for (const event of eventsFromChunk(raw)) yield event;
  }
  throw new SseTruncatedError();
}

export function sseFailure(error: V1ApiError): FastClawError {
  return new FastClawError({
    kind: "5xx",
    status: 200,
    method: "POST",
    path: "/v1/chat/completions",
    code: error.code,
    errorType: error.type,
    message: `FastClaw POST /v1/chat/completions failed (5xx): ${error.code}: ${error.message}`,
  });
}
