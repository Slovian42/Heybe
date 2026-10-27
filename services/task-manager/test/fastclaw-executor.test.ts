import { describe, expect, it } from "vitest";
import { FastClawClient, FastClawConfigError } from "@heybe/fastclaw-adapter";

import {
  ABORT_NOTE,
  EventRepository,
  FastClawEventType,
  FastClawNodeExecutor,
  NodeRepository,
  TaskRepository,
  cancelTaskLive,
  dispatchOnce,
  fastClawExecutorFromEnv,
  openTaskDb,
  sessionKeyFor,
} from "../src/index.js";

const TOKEN = "fc_test_token_do_not_log";

function sse(chunks: unknown[], opts: { hang?: boolean } = {}): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      if (!opts.hang) {
        c.enqueue(enc.encode("data: [DONE]\n\n"));
        c.close();
      }
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

function setup(respond: (init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(init);
  }) as typeof fetch;
  const client = new FastClawClient({ baseUrl: "http://127.0.0.1:18953", token: TOKEN, fetchImpl, retry: { maxAttempts: 1 } });
  const db = openTaskDb(":memory:");
  const executor = new FastClawNodeExecutor(db, { client, defaultAgentId: "agent-1" });
  return { db, executor, calls };
}

const delta = (content: string) => ({ choices: [{ index: 0, delta: { content } }] });
const stop = { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };

describe("FastClawNodeExecutor", () => {
  it("streams via /v1, records tool events and lands in awaiting_review", async () => {
    const { db, executor, calls } = setup(() =>
      sse([delta("你"), { choices: [], tool: { id: "t1", name: "exec", status: "running" } }, delta("好"), stop]),
    );
    new TaskRepository(db).create({ goal: "写草稿", nodes: [{ id: "n1", acceptanceCriteria: "有标题" }] });
    const r = await dispatchOnce(db, executor, { owner: "sched", agentId: "agent-1" });
    if (!r.claimed) throw new Error("expected claim");
    expect(r.node.status).toBe("awaiting_review");
    expect(new NodeRepository(db).get("n1")?.status).toBe("awaiting_review");
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]!.url).pathname).toBe("/v1/chat/completions");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("x-fastclaw-session-key")).toBe(sessionKeyFor({ taskId: r.request.taskId, nodeId: "n1" }));
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.stream).toBe(true);
    expect(body.messages[0].content).toContain("写草稿");
    const types = new EventRepository(db).listByTask(r.request.taskId).map((e) => e.type);
    expect(types).toContain(FastClawEventType.DispatchStarted);
    expect(types).toContain(FastClawEventType.Tool);
    expect(types).toContain(FastClawEventType.StreamDone);
    db.close();
  });

  it("isolates session keys per task and node", () => {
    expect(sessionKeyFor({ taskId: "a", nodeId: "n1" })).not.toBe(sessionKeyFor({ taskId: "a", nodeId: "n2" }));
    expect(sessionKeyFor({ taskId: "a", nodeId: "n1" })).not.toBe(sessionKeyFor({ taskId: "b", nodeId: "n1" }));
  });

  it("writes the final in-band error chunk to events and fails the node", async () => {
    const { db, executor } = setup(() =>
      sse([delta("x"), { choices: [], error: { message: "upstream boom", type: "server_error", code: "provider_error" } }]),
    );
    new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
    const r = await dispatchOnce(db, executor, { owner: "sched", agentId: "agent-1" });
    if (!r.claimed) throw new Error("expected claim");
    expect(r.node.status).toBe("failed");
    const err = new EventRepository(db).listByTask(r.request.taskId).find((e) => e.type === FastClawEventType.StreamError);
    expect(err?.data).toMatchObject({ code: "provider_error" });
    expect(JSON.stringify(new EventRepository(db).listByTask(r.request.taskId))).not.toContain(TOKEN);
    db.close();
  });

  it("cancel stops new dispatch and aborts the in-flight request without claiming a server stop", async () => {
    let seenSignal: AbortSignal | undefined;
    const { db, executor } = setup((init) => {
      seenSignal = init?.signal ?? undefined;
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(enc.encode(`data: ${JSON.stringify(delta("working"))}\n\n`));
          init?.signal?.addEventListener("abort", () => c.error(new DOMException("aborted", "AbortError")));
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    });
    const created = new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }, { id: "n2" }] });
    const taskId = created.task.id;
    const running = dispatchOnce(db, executor, { owner: "sched", agentId: "agent-1" });
    for (let i = 0; i < 50 && executor.inflightCount === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(executor.inflightCount).toBe(1);
    const { aborted } = cancelTaskLive(db, executor, taskId, { reason: "user" });
    expect(aborted).toBe(1);
    expect(seenSignal?.aborted).toBe(true);
    const r = await running;
    if (!r.claimed) throw new Error("expected claim");
    expect(r.result.outcome).toBe("needs_check");
    expect(r.result.error).toBe(ABORT_NOTE);
    const ev = new EventRepository(db).listByTask(taskId).find((e) => e.type === FastClawEventType.ConnectionAborted);
    expect(ev?.data).toMatchObject({ note: ABORT_NOTE, serverStopped: "unknown" });
    const next = await dispatchOnce(db, executor, { owner: "sched", agentId: "agent-1" });
    expect(next.claimed).toBe(false);
    db.close();
  });

  it("fails clearly when no agent is known", async () => {
    const { db } = setup(() => sse([stop]));
    const client = new FastClawClient({ baseUrl: "http://127.0.0.1:1", token: TOKEN, fetchImpl: (async () => sse([stop])) as typeof fetch });
    const ex = new FastClawNodeExecutor(db, { client });
    const { task } = new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
    const r = await ex.execute({ taskId: task.id, nodeId: "n1", attemptId: "a1", agentId: null, executionVersion: 1, goal: "g", acceptanceCriteria: "" });
    expect(r.outcome).toBe("failed");
    expect(r.error).toMatch(/HEYBE_FASTCLAW_AGENT_ID/);
    db.close();
  });

  it("refuses to build from env when HEYBE_FASTCLAW_* is missing", () => {
    const db = openTaskDb(":memory:");
    expect(() => fastClawExecutorFromEnv(db, {})).toThrow(FastClawConfigError);
    expect(() =>
      fastClawExecutorFromEnv(db, { HEYBE_FASTCLAW_BASE_URL: "http://127.0.0.1:18953", HEYBE_FASTCLAW_TOKEN: TOKEN, HEYBE_FASTCLAW_TIMEOUT_MS: "x" }),
    ).toThrow(FastClawConfigError);
    db.close();
  });
});
