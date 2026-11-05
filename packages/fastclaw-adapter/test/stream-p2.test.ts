// #19 part 2: idle timeout on a hung stream, and the model FastClaw actually used.
import { describe, expect, it } from "vitest";

import { FastClawClient } from "../src/index.js";

const TOKEN = "fc-test-token-0123456789abcdef";
const enc = new TextEncoder();

function clientWith(body: () => ReadableStream<Uint8Array>) {
  const fetchImpl = (async () => new Response(body(), { status: 200, headers: { "Content-Type": "text/event-stream" } })) as typeof fetch;
  return new FastClawClient({ baseUrl: "http://127.0.0.1:18953", token: TOKEN, fetchImpl, retry: { maxAttempts: 1 } });
}

async function drain(c: FastClawClient, extra: { idleTimeoutMs?: number; onModel?: (m: string) => void } = {}) {
  const session = c.createSession({ agentId: "agt_1", sessionKey: "s" });
  const seen: string[] = [];
  try {
    for await (const ev of c.streamMessage(session, { messages: [{ role: "user", content: "go" }], ...extra })) seen.push(ev.type);
  } catch (err) {
    return { seen, err };
  }
  return { seen, err: undefined };
}

const chunk = (o: object) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);

describe("streamMessage idle timeout", () => {
  it("fails with timeout/stream_idle_timeout when the body goes silent", async () => {
    let cancelled = false;
    const c = clientWith(() => new ReadableStream({
      start(ctl) {
        ctl.enqueue(chunk({ model: "deepseek/deepseek-chat", choices: [{ delta: { content: "半" } }] }));
      },
      cancel() {
        cancelled = true;
      },
    }));
    const t0 = Date.now();
    const { seen, err } = await drain(c, { idleTimeoutMs: 80 });
    expect(seen).toEqual(["delta"]);
    expect(err).toMatchObject({ kind: "timeout", code: "stream_idle_timeout" });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(cancelled).toBe(true);
  });

  it("keeps going while FastClaw sends `: ping` heartbeats", async () => {
    const c = clientWith(() => {
      let n = 0;
      return new ReadableStream({
        async pull(ctl) {
          await new Promise((r) => setTimeout(r, 30));
          n += 1;
          if (n < 5) ctl.enqueue(enc.encode(": ping\n\n"));
          else {
            ctl.enqueue(chunk({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] }));
            ctl.enqueue(enc.encode("data: [DONE]\n\n"));
            ctl.close();
          }
        },
      });
    });
    const { seen, err } = await drain(c, { idleTimeoutMs: 80 });
    expect(err).toBeUndefined();
    expect(seen).toEqual(["delta", "done"]);
  });
});

describe("streamMessage onModel", () => {
  it("reports the chunk model once, also when the turn then fails in-band", async () => {
    const models: string[] = [];
    const c = clientWith(() => new ReadableStream({
      start(ctl) {
        ctl.enqueue(chunk({ model: "ollama/qwen2.5:3b", choices: [{ delta: { role: "assistant" } }] }));
        ctl.enqueue(chunk({ model: "ollama/qwen2.5:3b", choices: [{ delta: {}, finish_reason: "stop" }], error: { type: "server_error", code: "agent_error", message: "API error 401: x" } }));
        ctl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctl.close();
      },
    }));
    const { err } = await drain(c, { onModel: (m) => models.push(m) });
    expect(models).toEqual(["ollama/qwen2.5:3b"]);
    expect(err).toMatchObject({ code: "agent_error" });
  });

  it("does not put idleTimeoutMs / onModel on the wire", async () => {
    let body = "";
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = String(init?.body);
      return new Response(new ReadableStream({ start: (ctl) => { ctl.enqueue(enc.encode("data: [DONE]\n\n")); ctl.close(); } }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const c = new FastClawClient({ baseUrl: "http://127.0.0.1:18953", token: TOKEN, fetchImpl });
    await drain(c, { idleTimeoutMs: 1000, onModel: () => undefined });
    expect(Object.keys(JSON.parse(body)).sort()).toEqual(["agent_id", "messages", "stream"]);
  });
});
