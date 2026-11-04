import { describe, expect, it, vi } from "vitest";

import { loadSession, resumeTurn, stopTurn, streamChat } from "../src/chat/client";
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

  it("reports a dropped local connection as cut (the turn may still run; the UI resumes it)", async () => {
    const fetchImpl = vi.fn(async () => new Response(streamOf('data: {"type":"delta","content":"x","seq":2}\n\n')));
    const out = await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "tok", sessionId: "s", content: "q", fetchImpl }));
    expect(out).toEqual([{ type: "delta", content: "x", seq: 2 }, { type: "cut" }]);
  });

  it("says why the local service refused: bad token (401), busy session (409)", async () => {
    const r401 = await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "x", sessionId: "s", content: "q", fetchImpl: vi.fn(async () => new Response("{}", { status: 401 })) }));
    expect(r401[0]).toMatchObject({ kind: "unavailable", code: "service_401", message: "本地服务拒绝了这次请求（启动令牌不对），请退出后重开 Heybe" });
    const r409 = await collect(streamChat({ baseUrl: "http://127.0.0.1:9", token: "x", sessionId: "s", content: "q", fetchImpl: vi.fn(async () => new Response('{"turnId":"T"}', { status: 409 })) }));
    expect(r409[0]).toMatchObject({ code: "service_409", message: "这个会话上一轮还没结束，请等它结束或先停止" });
  });

  it("resumes a turn after a seq, loads the session and stops a turn", async () => {
    const calls: Array<[string, RequestInit | undefined]> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push([url, init]);
      if (url.endsWith("/stop")) return new Response('{"serverStopped":"unknown"}');
      if (url.includes("/events")) return new Response(streamOf('data: {"type":"done","seq":7}\n\ndata: [DONE]\n\n'));
      return new Response(JSON.stringify({ sessionId: "s", turns: [{ id: "T" }], activeTurnId: "T" }));
    }) as unknown as typeof fetch;
    const conn = { baseUrl: "http://127.0.0.1:9", token: "tok", fetchImpl };
    expect(await collect(resumeTurn({ ...conn, turnId: "T", after: 6 }))).toEqual([{ type: "done", seq: 7 }]);
    expect(await loadSession({ ...conn, sessionId: "s" })).toMatchObject({ activeTurnId: "T", turns: [{ id: "T" }] });
    await stopTurn({ ...conn, turnId: "T" });
    expect(calls.map(([u, i]) => `${i?.method ?? "GET"} ${u}`)).toEqual([
      "GET http://127.0.0.1:9/chat/turns/T/events?after=6",
      "GET http://127.0.0.1:9/chat/sessions/s",
      "POST http://127.0.0.1:9/chat/turns/T/stop",
    ]);
    for (const [, i] of calls) expect((i?.headers as Record<string, string>).authorization).toBe("Bearer tok");
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
