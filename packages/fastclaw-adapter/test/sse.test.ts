import { describe, expect, it } from "vitest";
import { parseChatSse, SseTruncatedError } from "../src/sse.js";

async function collect(stream: ReadableStream<Uint8Array>) {
  const events = [];
  for await (const event of parseChatSse(stream)) events.push(event);
  return events;
}

function streamFrom(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

describe("parseChatSse", () => {
  it("rejoins a multibyte character split across chunks", async () => {
    const text = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(text);
    const prefix = new TextEncoder().encode(text.slice(0, text.indexOf("你"))).length;
    const events = await collect(streamFrom([bytes.slice(0, prefix + 1), bytes.slice(prefix + 1)]));
    expect(events).toEqual([{ type: "delta", content: "你" }]);
  });

  it("flushes an event that does not end with a blank line", async () => {
    const events = await collect(streamFrom([
      new TextEncoder().encode('data: {"choices":[{"delta":{"content":"tail"}}]}\n\ndata: [DONE]'),
    ]));
    expect(events).toEqual([{ type: "delta", content: "tail" }]);
  });

  it("rejects a non-JSON data payload without echoing it", async () => {
    const secret = "fc_test_token_do_not_log";
    await expect(collect(streamFrom([
      new TextEncoder().encode(`data: ${secret}\n\n`),
    ]))).rejects.toThrow(/valid JSON/);
    try {
      await collect(streamFrom([new TextEncoder().encode(`data: ${secret}\n\n`)]));
    } catch (err) {
      expect(String(err)).not.toContain(secret);
    }
  });

  it("throws SseTruncatedError when the body ends without [DONE] (gateway stopped mid-turn, #9)", async () => {
    const seen: unknown[] = [];
    const stream = streamFrom([new TextEncoder().encode('data: {"choices":[{"delta":{"content":"半截"}}]}\n\n')]);
    await expect(
      (async () => {
        for await (const event of parseChatSse(stream)) seen.push(event);
      })(),
    ).rejects.toBeInstanceOf(SseTruncatedError);
    expect(seen).toEqual([{ type: "delta", content: "半截" }]);
  });
});
