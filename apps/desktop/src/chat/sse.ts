import type { ChatServiceEvent } from "@heybe/shared-types/chat";

/** Body ended before `data: [DONE]`: local service or gateway went away mid-turn. */
export class StreamTruncatedError extends Error {
  constructor() {
    super("chat stream ended before [DONE]");
    this.name = "StreamTruncatedError";
  }
}

const TYPES = new Set(["delta", "tool", "done", "error"]);

/** Parse the Heybe service SSE (one JSON event per `data:` block, ends with [DONE]). */
export async function* parseServiceSse(stream: ReadableStream<Uint8Array>): AsyncGenerator<ChatServiceEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const flushBlock = (): string | undefined => {
    if (data.length === 0) return undefined;
    const out = data.join("\n");
    data = [];
    return out;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = done ? "" : (lines.pop() ?? "");
      if (done) lines.push("");
      for (const line of lines) {
        if (line === "") {
          const block = flushBlock();
          if (block === undefined) continue;
          if (block === "[DONE]") return;
          let ev: unknown;
          try {
            ev = JSON.parse(block);
          } catch {
            continue; // ignore malformed block rather than crash the UI
          }
          if (ev && typeof ev === "object" && TYPES.has((ev as { type?: string }).type ?? "")) {
            yield ev as ChatServiceEvent;
          }
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) throw new StreamTruncatedError();
    }
  } finally {
    reader.releaseLock();
  }
}
