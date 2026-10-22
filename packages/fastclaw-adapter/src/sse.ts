import type { V1ApiError, V1ChatChunk, V1StreamEvent } from "@heybe/shared-types";
import { FastClawError } from "./errors.js";

export class SseParseError extends Error {
  constructor() {
    super("FastClaw SSE payload was not valid JSON");
    this.name = "SseParseError";
  }
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

/** Parse a FastClaw chat SSE body. Yields `error` for an in-band turn failure; the client throws. */
export async function* parseChatSse(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<V1StreamEvent | { type: "error"; error: V1ApiError }> {
  for await (const data of iterateSseData(stream)) {
    if (data === "[DONE]") return;
    let raw: V1ChatChunk;
    try {
      raw = JSON.parse(data) as V1ChatChunk;
    } catch {
      throw new SseParseError();
    }
    if (!raw || typeof raw !== "object") throw new SseParseError();
    for (const event of eventsFromChunk(raw)) yield event;
  }
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
