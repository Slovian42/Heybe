import { describe, expect, it, vi } from "vitest";

import { streamChat } from "../src/chat/client";
import { streamOf } from "./helpers";

async function collect(gen: AsyncGenerator<unknown>) {
  const out = [];
  for await (const ev of gen) out.push(ev);
  return out;
}

describe("streamChat", () => {
  it("posts to the local service chat route and yields events", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf('data: {"type":"delta","content":"hi"}\n\ndata: [DONE]\n\n')));
    const out = await collect(streamChat({ baseUrl: "http://127.0.0.1:9/", token: "tok", sessionId: "s 1", content: "q", fetchImpl }));
    expect(out).toEqual([{ type: "delta", content: "hi" }]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://127.0.0.1:9/chat/sessions/s%201/messages");
    expect(JSON.parse(init.body as string)).toEqual({ content: "q" });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("maps network failure to unavailable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "tok", sessionId: "s", content: "q", fetchImpl }))).toEqual([
      { type: "error", kind: "unavailable", reason: "runtime_unavailable", message: "连不上本地服务" },
    ]);
  });

  it("maps HTTP errors to failed", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));
    const out = await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "tok", sessionId: "s", content: "q", fetchImpl }));
    expect(out).toEqual([{ type: "error", kind: "failed", reason: "unknown", code: "service_500", message: "没做成，请稍后再试（错误码 service_500）" }]);
  });

  it("maps a truncated body to interrupted (never success)", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf('data: {"type":"delta","content":"x"}\n\n')));
    const out = await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "tok", sessionId: "s", content: "q", fetchImpl }));
    expect(out.at(-1)).toEqual({ type: "error", kind: "interrupted", reason: "interrupted", message: "中断，结果未知" });
  });

  it("ends quietly when aborted by stop", async () => {
    const ctl = new AbortController();
    ctl.abort();
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    });
    expect(await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "tok", sessionId: "s", content: "q", signal: ctl.signal, fetchImpl }))).toEqual([]);
  });
});
