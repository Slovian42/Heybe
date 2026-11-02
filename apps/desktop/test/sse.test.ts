import { describe, expect, it } from "vitest";

import { parseServiceSse, StreamTruncatedError } from "../src/chat/sse";
import { streamOf } from "./helpers";

async function collect(s: ReadableStream<Uint8Array>) {
  const out = [];
  for await (const ev of parseServiceSse(s)) out.push(ev);
  return out;
}

describe("parseServiceSse", () => {
  it("reassembles events split across chunks, including multibyte text", async () => {
    const full = 'data: {"type":"delta","content":"你好"}\n\ndata: {"type":"done","finishReason":"stop"}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(full);
    const parts: string[] = [];
    // split inside the UTF-8 sequence of 你
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(bytes.slice(0, 33));
        c.enqueue(bytes.slice(33));
        c.close();
      },
    });
    void parts;
    expect(await collect(stream)).toEqual([
      { type: "delta", content: "你好" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("handles CRLF and comments and skips malformed/unknown blocks", async () => {
    const s = streamOf(': ping\r\n\r\n', 'data: {oops\r\n\r\n', 'data: {"type":"weird"}\r\n\r\n', 'data: {"type":"delta","content":"a"}\r\n\r\ndata: [DONE]\r\n\r\n');
    expect(await collect(s)).toEqual([{ type: "delta", content: "a" }]);
  });

  it("throws StreamTruncatedError when [DONE] never arrives", async () => {
    await expect(collect(streamOf('data: {"type":"delta","content":"a"}\n\n'))).rejects.toBeInstanceOf(StreamTruncatedError);
  });
});
