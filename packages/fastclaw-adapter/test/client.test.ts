import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { describe, expect, it, vi } from "vitest";
import {
  FastClawClient,
  assertV1Path,
  fastClawClientFromEnv,
  loadFastClawClientConfig,
  sessionFilePath,
} from "../src/index.js";

const TOKEN = "fc_test_token_do_not_log";
const BASE = "http://127.0.0.1:18953/";

function client(overrides: Partial<ConstructorParameters<typeof FastClawClient>[0]> = {}) {
  return new FastClawClient({
    baseUrl: BASE,
    token: TOKEN,
    sleep: async () => {},
    ...overrides,
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function scripted(steps: Array<(url: string, init?: RequestInit) => Response | Promise<Response>>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    calls.push({ url: href, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (!step) throw new Error("no scripted response");
    return step(href, init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function headersOf(init?: RequestInit): Record<string, string> {
  return init?.headers as Record<string, string>;
}

const agent = {
  id: "agt_1",
  display_name: "Researcher",
  name: "agt_1",
  description: "",
  model: "ollama/qwen2.5:7b",
  metadata: {},
  created_at: "2026-10-14T00:00:00Z",
  updated_at: "2026-10-14T00:00:00Z",
};

describe("FastClawClient paths and auth", () => {
  it("rejects non-/v1 paths, including encoded traversal", () => {
    expect(() => assertV1Path("/api/agents")).toThrow(/v1/);
    expect(() => assertV1Path("/v1/agents")).not.toThrow();
    expect(() => assertV1Path("/v1/agents?limit=1")).not.toThrow();
    expect(() => assertV1Path("/v1/foo/../../api/agents")).toThrow(/v1/);
    expect(() => assertV1Path("/v1/%2e%2e/%61pi/agents")).toThrow(/v1/);
  });

  it("calls GET /v1/agents with bearer auth and the v1.4.0 list shape", async () => {
    const { calls, fetchImpl } = scripted([() => json({ agents: [agent], has_more: false })]);
    const listed = await client({ fetchImpl }).listAgents();
    expect(listed.agents[0]?.display_name).toBe("Researcher");
    expect(calls[0]?.url).toBe("http://127.0.0.1:18953/v1/agents");
    expect(headersOf(calls[0]?.init).Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it("refuses console paths even through request()", async () => {
    const { calls, fetchImpl } = scripted([() => json({})]);
    const c = client({ fetchImpl });
    await expect(c.request("GET", "/api/skills")).rejects.toThrow(/v1/);
    expect(calls).toHaveLength(0);
  });

  it("probes connectivity with GET /v1/agents?limit=1", async () => {
    const { calls, fetchImpl } = scripted([() => json({ agents: [agent], has_more: false })]);
    const health = await client({ fetchImpl }).health();
    expect(health).toEqual({ ok: true, probe: "GET /v1/agents" });
    expect(calls[0]?.url).toBe("http://127.0.0.1:18953/v1/agents?limit=1");
    expect(calls[0]?.url.includes("healthz")).toBe(false);
  });

  it("unwraps GET /v1/agents/{id}", async () => {
    const { calls, fetchImpl } = scripted([() => json({ agent })]);
    const got = await client({ fetchImpl }).getAgent("agt_1");
    expect(got.display_name).toBe("Researcher");
    expect(calls[0]?.url).toBe("http://127.0.0.1:18953/v1/agents/agt_1");
  });

  it("does not follow redirects", async () => {
    const { calls, fetchImpl } = scripted([
      () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1:18953/somewhere" } }),
    ]);
    await expect(client({ fetchImpl }).listAgents()).rejects.toMatchObject({ code: "redirect_blocked" });
    expect(calls).toHaveLength(1);
  });
});

describe("sessions, chat, and files", () => {
  it("creates a session locally and sends it with the agent id", async () => {
    const { calls, fetchImpl } = scripted([
      () => json({ id: "chatcmpl-1", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
    ]);
    const c = client({ fetchImpl });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv", endUser: "user-123" });
    expect(calls).toHaveLength(0);
    const reply = await c.sendMessage(session, { messages: [{ role: "user", content: "hello" }] });
    expect(reply.choices[0]?.message.content).toBe("ok");
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.agent_id).toBe("agt_1");
    expect(body.user).toBe("user-123");
    expect(body.stream).toBe(false);
    expect(body).not.toHaveProperty("model");
    const headers = headersOf(calls[0]?.init);
    expect(headers["X-Fastclaw-Session-Key"]).toBe("heybe:conv");
    expect(headers["X-Fastclaw-End-User"]).toBe("user-123");
    expect(headers["X-Fastclaw-Agent-ID"]).toBe("agt_1");
  });

  it("passes model through without treating it as an agent-config override", async () => {
    const { calls, fetchImpl } = scripted([
      () => json({ id: "chatcmpl-1", model: "openai/gpt-4o", choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }] }),
    ]);
    const c = client({ fetchImpl });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv" });
    await c.sendMessage(session, { messages: [{ role: "user", content: "hello" }], model: "openai/gpt-4o" });
    const body = JSON.parse(String(calls[0]?.init?.body));
    expect(body.model).toBe("openai/gpt-4o");
    const src = readFileSync(fileURLToPath(new URL("../../shared-types/src/fastclaw.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/does not override the Agent's model configuration/);
    expect(src).toMatch(/不会覆盖 Agent 自身的模型配置/);
  });

  it("parses an SSE chat, including tool steps and produced files", async () => {
    const events = [
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      ": ping\n\n",
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
      'data: {"choices":[{"delta":{}}],"tool":{"id":"call_1","name":"exec","status":"running"}}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4},"files":[{"name":"edited.png","path":"edited.png","size":4,"content_type":"image/png","url":"http://127.0.0.1:18953/v1/agents/agt_1/sessions/heybe%3Aconv/files/edited.png"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const { calls, fetchImpl } = scripted([
      () => new Response(sseStream(events), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    ]);
    const c = client({ fetchImpl });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv" });
    const seen = [];
    for await (const event of c.streamMessage(session, { messages: [{ role: "user", content: "go" }] })) {
      seen.push(event);
    }
    expect(JSON.parse(String(calls[0]?.init?.body)).stream).toBe(true);
    expect(seen).toEqual([
      { type: "delta", content: "Hel" },
      { type: "delta", content: "lo" },
      { type: "tool", tool: { id: "call_1", name: "exec", status: "running" } },
      {
        type: "done",
        finishReason: "stop",
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
        files: [{
          name: "edited.png",
          path: "edited.png",
          size: 4,
          content_type: "image/png",
          url: "http://127.0.0.1:18953/v1/agents/agt_1/sessions/heybe%3Aconv/files/edited.png",
        }],
      },
    ]);
  });

  it("turns an in-band stream error into a 5xx failure", async () => {
    const { calls, fetchImpl } = scripted([
      () => new Response(sseStream([
        'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
        `data: {"choices":[{"finish_reason":"stop"}],"error":{"type":"server_error","code":"agent_error","message":"upstream ${TOKEN}"}}\n\n`,
        "data: [DONE]\n\n",
      ]), { status: 200, headers: { "Content-Type": "text/event-stream" } }),
    ]);
    const c = client({ fetchImpl });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv" });
    const seen: string[] = [];
    const failure = await (async () => {
      try {
        for await (const event of c.streamMessage(session, { messages: [{ role: "user", content: "go" }] })) {
          if (event.type === "delta") seen.push(event.content);
        }
      } catch (err) {
        return err;
      }
      throw new Error("expected stream failure");
    })();
    expect(failure).toMatchObject({ kind: "5xx", code: "agent_error", status: 200 });
    expect(inspect(failure)).not.toContain(TOKEN);
    expect(seen).toEqual(["partial"]);
    expect(calls).toHaveLength(1);
  });

  it("downloads a session file with the end-user header", async () => {
    const { calls, fetchImpl } = scripted([
      () => new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: { "Content-Type": "image/png", "Content-Disposition": 'inline; filename="edited.png"' },
      }),
    ]);
    const file = await client({ fetchImpl }).getSessionFile({
      agentId: "agt_1",
      sessionKey: "heybe:conv",
      path: "out/edited.png",
      projectId: "proj 1",
      endUser: "user-123",
    });
    expect(Array.from(file.bytes)).toEqual([9, 8, 7]);
    expect(file.contentType).toBe("image/png");
    expect(file.fileName).toBe("edited.png");
    expect(calls[0]?.url).toBe(
      "http://127.0.0.1:18953/v1/agents/agt_1/sessions/heybe%3Aconv/files/out/edited.png?project_id=proj%201",
    );
    expect(headersOf(calls[0]?.init)["X-Fastclaw-End-User"]).toBe("user-123");
  });

  it("rejects file traversal before any request", async () => {
    const { calls, fetchImpl } = scripted([() => json({})]);
    await expect(client({ fetchImpl }).getSessionFile({
      agentId: "agt_1",
      sessionKey: "heybe:conv",
      path: "../secret.txt",
    })).rejects.toMatchObject({ code: "invalid_request" });
    expect(sessionFilePath("agt_1", "heybe:conv", "edited.png")).toBe(
      "/v1/agents/agt_1/sessions/heybe%3Aconv/files/edited.png",
    );
    expect(calls).toHaveLength(0);
  });
});

describe("errors and bounded retry", () => {
  it("classifies 4xx, 5xx, network, and timeout", async () => {
    const four = scripted([() => json({ error: { type: "not_found_error", code: "agent_not_found", message: "agent not found" } }, 404)]);
    await expect(client({ fetchImpl: four.fetchImpl }).getAgent("agt_missing")).rejects.toMatchObject({
      kind: "4xx",
      status: 404,
      code: "agent_not_found",
    });

    const five = scripted([() => json({ error: { type: "server_error", code: "agent_error", message: `down ${TOKEN}` } }, 502)]);
    const c = client({ fetchImpl: five.fetchImpl });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv" });
    const failure = await c.sendMessage(session, { messages: [{ role: "user", content: "hi" }] }).then(() => {
      throw new Error("expected failure");
    }, (err: unknown) => err);
    expect(failure).toMatchObject({ kind: "5xx", status: 502, code: "agent_error" });
    expect(inspect(failure)).not.toContain(TOKEN);
    expect(five.calls).toHaveLength(1);

    const broken = scripted([() => { throw new Error(`connect failed ${TOKEN}`); }]);
    await expect(client({ fetchImpl: broken.fetchImpl }).sendMessage(session, {
      messages: [{ role: "user", content: "hi" }],
    })).rejects.toMatchObject({ kind: "network" });
    expect(broken.calls).toHaveLength(1);

    let timedOutCalls = 0;
    const hanging = (async (_url: string, init?: RequestInit) => {
      timedOutCalls += 1;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    }) as typeof fetch;
    await expect(client({
      fetchImpl: hanging,
      timeoutMs: 20,
      retry: { maxAttempts: 1 },
    }).listAgents()).rejects.toMatchObject({ kind: "timeout" });
    expect(timedOutCalls).toBe(1);
  });

  it("retries idempotent failures with capped exponential backoff and stops", async () => {
    const delays: number[] = [];
    const { calls, fetchImpl } = scripted([
      () => json({ error: { type: "server_error", code: "internal_error", message: "nope" } }, 503),
      () => json({ error: { type: "server_error", code: "internal_error", message: "nope" } }, 503),
      () => json({ agents: [], has_more: false }),
    ]);
    await client({
      fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      sleep: async (ms) => { delays.push(ms); },
    }).listAgents();
    expect(calls).toHaveLength(3);
    expect(delays).toEqual([200, 400]);
  });

  it("retries 429 using Retry-After but never above the delay cap", async () => {
    const delays: number[] = [];
    const { calls, fetchImpl } = scripted([
      () => json({ error: { type: "rate_limit_error", code: "rate_limited", message: "slow down" } }, 429, { "Retry-After": "30" }),
      () => json({ agents: [], has_more: false }),
    ]);
    await client({
      fetchImpl,
      retry: { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2_000 },
      sleep: async (ms) => { delays.push(ms); },
    }).listAgents();
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([2_000]);
  });

  it("does not retry a failed chat turn", async () => {
    const { calls, fetchImpl } = scripted([
      () => json({ error: { type: "server_error", code: "agent_error", message: "nope" } }, 502),
    ]);
    const c = client({ fetchImpl, retry: { maxAttempts: 5 } });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:conv" });
    await expect(c.sendMessage(session, { messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ code: "agent_error" });
    expect(calls).toHaveLength(1);
  });

  it("clamps the retry budget", async () => {
    const { calls, fetchImpl } = scripted([
      () => json({ error: { type: "server_error", code: "internal_error", message: "nope" } }, 500),
    ]);
    await expect(client({
      fetchImpl,
      retry: { maxAttempts: 100, baseDelayMs: 1, maxDelayMs: 99_000 },
      sleep: async () => {},
    }).listAgents()).rejects.toMatchObject({ kind: "5xx" });
    expect(calls).toHaveLength(5);
  });

  it("does not retry a caller abort", async () => {
    const { calls, fetchImpl } = scripted([() => json({ agents: [], has_more: false })]);
    await expect(client({ fetchImpl }).listAgents({ signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "aborted" });
    expect(calls).toHaveLength(0);
  });
});

describe("configuration and token handling", () => {
  it("reads HEYBE_FASTCLAW_BASE_URL and HEYBE_FASTCLAW_TOKEN", () => {
    const config = loadFastClawClientConfig({
      HEYBE_FASTCLAW_BASE_URL: "http://127.0.0.1:18953/",
      HEYBE_FASTCLAW_TOKEN: TOKEN,
    });
    expect(config.baseUrl).toBe("http://127.0.0.1:18953");
    expect(config.token).toBe(TOKEN);
    const built = fastClawClientFromEnv({
      HEYBE_FASTCLAW_BASE_URL: "http://127.0.0.1:18953/",
      HEYBE_FASTCLAW_TOKEN: TOKEN,
    });
    expect(built.baseUrl).toBe("http://127.0.0.1:18953");
  });

  it("names missing variables and never echoes the token", () => {
    expect(() => loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: "http://127.0.0.1:18953" })).toThrow(/HEYBE_FASTCLAW_CHAT_TOKEN/);
    const embedded = `http://127.0.0.1/${TOKEN}`;
    try {
      loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: embedded, HEYBE_FASTCLAW_TOKEN: TOKEN });
      throw new Error("expected config failure");
    } catch (err) {
      expect(inspect(err)).not.toContain(TOKEN);
    }
    try {
      loadFastClawClientConfig({
        HEYBE_FASTCLAW_BASE_URL: "http://user:s3cret@127.0.0.1:18953",
        HEYBE_FASTCLAW_TOKEN: TOKEN,
      });
      throw new Error("expected config failure");
    } catch (err) {
      expect(String(err)).not.toContain("s3cret");
    }
  });

  it("does not log or inspect the token", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const { fetchImpl } = scripted([() => { throw new Error(`boom ${TOKEN}`); }]);
    const c = client({ fetchImpl });
    await expect(c.listAgents()).rejects.toMatchObject({ kind: "network" });
    expect(JSON.stringify(c)).not.toContain(TOKEN);
    expect(inspect(c, { showHidden: true, depth: 8 })).not.toContain(TOKEN);
    for (const spy of [log, info, warn, error, debug]) expect(spy).not.toHaveBeenCalled();
    log.mockRestore();
    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
    debug.mockRestore();
  });

  it("keeps console calls and console-api paths out of the adapter source", () => {
    const dir = fileURLToPath(new URL("../src/", import.meta.url));
    const src = readdirSync(dir).filter((name) => name.endsWith(".ts")).map((name) => readFileSync(join(dir, name), "utf8")).join("\n");
    expect(src).not.toMatch(/console\./);
    expect(src).not.toMatch(/["'`][^"'`\n]*\/api\//);
  });
});

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("streamMessage abort during body", () => {
  it("drops the connection when the caller aborts after headers arrived", async () => {
    const enc = new TextEncoder();
    let bodySignal: AbortSignal | undefined;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodySignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "a" } }] })}\n\n`));
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as typeof fetch;
    const c = client({ fetchImpl, retry: { maxAttempts: 1 } });
    const session = c.createSession({ agentId: "agt_1", sessionKey: "s" });
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const event of c.streamMessage(session, { messages: [{ role: "user", content: "go" }], signal: controller.signal })) {
          seen.push(event.type);
          controller.abort();
        }
      })(),
    ).rejects.toBeTruthy();
    expect(seen).toEqual(["delta"]);
    expect(bodySignal?.aborted).toBe(true);
  });
});
