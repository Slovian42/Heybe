import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import type { V1StreamEvent } from "@heybe/shared-types";
import type { ChatTurnSnapshot, ChatWireEvent } from "@heybe/shared-types/chat";

import { classifyChatError } from "../src/chat-errors.js";
import { ChatTurnStore } from "../src/chat-store.js";
import type { ChatStreamFn, ChatStreamInput } from "../src/chat.js";
import { stopTaskHttpServer, startTaskHttpServer } from "../src/http.js";
import { openTaskDb } from "../src/db.js";
import { tempDb } from "./helpers.js";

let server: Server | undefined;
const cleanups: Array<() => void> = [];
afterEach(async () => {
  if (server) await stopTaskHttpServer(server);
  server = undefined;
  for (const c of cleanups.splice(0)) c();
});

async function start(chat: ChatStreamFn, dbPath = ":memory:"): Promise<string> {
  server = await startTaskHttpServer(openTaskDb(dbPath), { port: 0, chat });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ORIGIN = { origin: "tauri://localhost" };

function post(base: string, id: string, content: string, init: RequestInit = {}) {
  return fetch(`${base}/chat/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", ...ORIGIN },
    body: JSON.stringify({ content }),
    ...init,
  });
}

function dataLines(text: string): string[] {
  return text.split("\n\n").filter(Boolean).map((b) => b.replace(/^data: /, ""));
}

function events(text: string): ChatWireEvent[] {
  const lines = dataLines(text);
  expect(lines.at(-1)).toBe("[DONE]");
  return lines.slice(0, -1).map((l) => JSON.parse(l) as ChatWireEvent);
}

const strip = (evs: ChatWireEvent[]) =>
  evs.filter((e) => e.type !== "turn").map((e) => {
    const rest: Partial<ChatWireEvent> = { ...e };
    delete rest.seq;
    return rest;
  });

async function session(base: string, id: string): Promise<{ turns: ChatTurnSnapshot[]; activeTurnId: string | null }> {
  return (await (await fetch(`${base}/chat/sessions/${id}`, { headers: ORIGIN })).json()) as {
    turns: ChatTurnSnapshot[];
    activeTurnId: string | null;
  };
}

/** A stream whose next step is released by the test. */
function gate() {
  let open!: () => void;
  const p = new Promise<void>((r) => (open = r));
  return { open, wait: p };
}

describe("chat SSE API (#19 part 2: resumable turns)", () => {
  it("sends turn first, numbers every event, keeps delta order and ends with [DONE]", async () => {
    let seen: ChatStreamInput | undefined;
    const base = await start(async function* (input) {
      seen = input;
      input.onModel?.("deepseek/deepseek-chat");
      yield { type: "delta", content: "你" } satisfies V1StreamEvent;
      yield { type: "tool", tool: { id: "t1", name: "web_fetch", status: "running" } };
      yield { type: "tool", tool: { id: "t1", name: "web_fetch", status: "completed" } };
      yield { type: "delta", content: "好" };
      yield { type: "done", finishReason: "stop" };
    });
    const res = await post(base, "abc", "hi");
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    const evs = events(await res.text());
    expect(evs[0]).toMatchObject({ type: "turn", seq: 1 });
    expect(evs.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(strip(evs)).toEqual([
      { type: "source", source: { provider: "deepseek", model: "deepseek-chat", label: "DeepSeek", locality: "cloud" } },
      { type: "delta", content: "你" },
      { type: "tool", id: "t1", name: "web_fetch", status: "running" },
      { type: "tool", id: "t1", name: "web_fetch", status: "done" },
      { type: "delta", content: "好" },
      { type: "done", finishReason: "stop" },
    ]);
    expect(seen?.sessionKey).toBe("heybe:chat:abc");
    expect(seen?.content).toBe("hi");
    const s = await session(base, "abc");
    expect(s.activeTurnId).toBeNull();
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]).toMatchObject({ status: "done", text: "你好", userContent: "hi", lastSeq: 7 });
    expect(s.turns[0]!.source?.label).toBe("DeepSeek");
    expect(s.turns[0]!.tools).toEqual([{ id: "t1", name: "web_fetch", status: "done" }]);
  });

  it("local Ollama source comes from the model the gateway used", async () => {
    const base = await start(async function* (input) {
      input.onModel?.("ollama/qwen2.5:3b");
      yield { type: "delta", content: "x" };
      yield { type: "done", finishReason: "stop" };
    });
    const evs = events(await (await post(base, "o1", "hi")).text());
    expect(evs.find((e) => e.type === "source")).toMatchObject({
      source: { provider: "ollama", model: "qwen2.5:3b", label: "本地 Ollama", locality: "local" },
    });
  });

  it("a truncated upstream ends as interrupted (result unknown), never as done", async () => {
    const base = await start(async function* () {
      yield { type: "delta", content: "部分" };
      throw Object.assign(new Error("secret upstream text"), { kind: "network", code: "stream_truncated" });
    });
    const text = await (await post(base, "s1", "hi")).text();
    expect(text).not.toContain("secret upstream text");
    const evs = strip(events(text));
    expect(evs).toEqual([
      { type: "delta", content: "部分" },
      { type: "error", kind: "interrupted", reason: "interrupted", message: "中断，结果未知" },
    ]);
    expect((await session(base, "s1")).turns[0]).toMatchObject({ status: "interrupted", text: "部分" });
  });

  it("[DONE] without a finish chunk is also interrupted", async () => {
    const base = await start(async function* () {
      yield { type: "delta", content: "a" };
    });
    const evs = strip(events(await (await post(base, "s5", "hi")).text()));
    expect(evs.at(-1)).toMatchObject({ type: "error", kind: "interrupted" });
  });

  it("a final in-band error chunk mid-stream ends the turn with its reason, no upstream text", async () => {
    const base = await start(async function* () {
      yield { type: "delta", content: "先说" };
      throw Object.assign(
        new Error('FastClaw POST /v1/chat/completions failed (5xx): agent_error: API error 401: {"error": {"message": "Your api key: ****KEYZ is invalid"}}'),
        { kind: "5xx", status: 200, code: "agent_error" },
      );
    });
    const text = await (await post(base, "s4", "hi")).text();
    expect(text).not.toContain("KEYZ");
    const evs = strip(events(text));
    expect(evs).toEqual([
      { type: "delta", content: "先说" },
      { type: "error", kind: "failed", reason: "key_invalid", code: "upstream_401", message: "模型密钥无效，请到设置里更换" },
    ]);
    expect((await session(base, "s4")).turns[0]).toMatchObject({ status: "failed", error: { reason: "key_invalid" } });
  });

  it("ignores anything after a terminal event (no duplicate render)", async () => {
    const base = await start(async function* () {
      yield { type: "delta", content: "a" };
      yield { type: "done", finishReason: "stop" };
      yield { type: "delta", content: "late" };
      yield { type: "done", finishReason: "stop" };
    });
    const evs = strip(events(await (await post(base, "s6", "hi")).text()));
    expect(evs).toEqual([{ type: "delta", content: "a" }, { type: "done", finishReason: "stop" }]);
  });

  it("closing the window (client disconnect) does not abort the turn; it resumes with after=n", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const g = gate();
    const base = await start(async function* ({ signal }) {
      upstreamSignal = signal;
      yield { type: "delta", content: "a" };
      await g.wait;
      yield { type: "delta", content: "b" };
      yield { type: "done", finishReason: "stop" };
    });
    const ctl = new AbortController();
    const res = await post(base, "s2", "hi", { signal: ctl.signal });
    const reader = res.body!.getReader();
    let got = "";
    while (!got.includes('"content":"a"')) got += new TextDecoder().decode((await reader.read()).value);
    ctl.abort();
    const turnId = (JSON.parse(dataLines(got)[0]!) as { turnId: string }).turnId;
    await new Promise((r) => setTimeout(r, 50));
    expect(upstreamSignal?.aborted).toBe(false);

    const s = await session(base, "s2");
    expect(s.activeTurnId).toBe(turnId);
    expect(s.turns[0]).toMatchObject({ status: "streaming", text: "a" });

    const resumed = fetch(`${base}/chat/turns/${turnId}/events?after=2`, { headers: ORIGIN }).then((r) => r.text());
    await new Promise((r) => setTimeout(r, 20));
    g.open();
    const evs = events(await resumed);
    expect(evs.map((e) => e.seq)).toEqual([3, 4]);
    expect(strip(evs)).toEqual([{ type: "delta", content: "b" }, { type: "done", finishReason: "stop" }]);

    // Reloading after the end: one snapshot with the full text.
    const after = events(await (await fetch(`${base}/chat/turns/${turnId}/events?after=0`, { headers: ORIGIN })).text());
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ type: "snapshot", turn: { status: "done", text: "ab" } });
  });

  it("stop marks the turn stopped at once and aborts upstream; server state stays unknown", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const base = await start(async function* ({ signal }) {
      upstreamSignal = signal;
      yield { type: "delta", content: "a" };
      await new Promise((r) => signal.addEventListener("abort", r));
      yield { type: "delta", content: "after stop" };
    });
    const live = post(base, "s7", "hi").then((r) => r.text());
    await expect.poll(async () => (await session(base, "s7")).activeTurnId).not.toBeNull();
    const turnId = (await session(base, "s7")).activeTurnId!;
    const t0 = Date.now();
    const res = await fetch(`${base}/chat/turns/${turnId}/stop`, { method: "POST", headers: ORIGIN });
    expect(Date.now() - t0).toBeLessThan(300);
    expect(await res.json()).toMatchObject({ serverStopped: "unknown", turn: { status: "stopped" } });
    expect(upstreamSignal?.aborted).toBe(true);
    const evs = strip(events(await live));
    expect(evs.at(-1)).toEqual({ type: "stopped" });
    expect(JSON.stringify(evs)).not.toContain("after stop");
    expect((await session(base, "s7")).turns[0]).toMatchObject({ status: "stopped", text: "a" });
  });

  it("one running turn per session: a second send gets 409 with the running turn id", async () => {
    const g = gate();
    const base = await start(async function* () {
      await g.wait;
      yield { type: "done", finishReason: "stop" };
    });
    const first = post(base, "s8", "one").then((r) => r.text());
    await expect.poll(async () => (await session(base, "s8")).activeTurnId).not.toBeNull();
    const second = await post(base, "s8", "two");
    expect(second.status).toBe(409);
    expect(((await second.json()) as { turnId: string }).turnId).toBe((await session(base, "s8")).activeTurnId);
    g.open();
    await first;
  });

  it("a service restart marks the old running turn interrupted (service_restarted)", async () => {
    const file = tempDb();
    cleanups.push(file.cleanup);
    const db = openTaskDb(file.path);
    new ChatTurnStore(db).create({ id: "old-turn", sessionId: "s9", userContent: "hi" });
    db.close();
    const base = await start(async function* () {}, file.path);
    const s = await session(base, "s9");
    expect(s.activeTurnId).toBeNull();
    expect(s.turns[0]).toMatchObject({
      id: "old-turn",
      status: "interrupted",
      error: { reason: "service_restarted", message: "本地服务重启过，这一轮中断了，结果未知" },
    });
  });

  it("stopping the service ends running turns as interrupted in SQLite", async () => {
    const file = tempDb();
    cleanups.push(file.cleanup);
    const base = await start(async function* ({ signal }) {
      yield { type: "delta", content: "a" };
      await new Promise((r) => signal.addEventListener("abort", r));
    }, file.path);
    void post(base, "s10", "hi").then((r) => r.text()).catch(() => undefined);
    await expect.poll(async () => (await session(base, "s10")).turns[0]?.text).toBe("a");
    await stopTaskHttpServer(server!);
    server = undefined;
    const db = openTaskDb(file.path);
    expect(new ChatTurnStore(db).listBySession("s10")[0]).toMatchObject({ status: "interrupted", text: "a" });
    db.close();
  });

  it("rejects empty content, bad ids, unknown turns, wrong methods; CORS only for the app", async () => {
    const base = await start(async function* () {});
    expect((await post(base, "s3", "  ")).status).toBe(400);
    expect((await post(base, "bad%2Fid", "x")).status).toBe(404);
    expect((await fetch(`${base}/chat/turns/nope/events`, { headers: ORIGIN })).status).toBe(404);
    expect((await fetch(`${base}/chat/turns/nope/stop`, { method: "POST", headers: ORIGIN })).status).toBe(404);
    expect((await fetch(`${base}/chat/sessions/s3`, { method: "DELETE", headers: ORIGIN })).status).toBe(405);
    const pre = await fetch(`${base}/chat/sessions/s3/messages`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
    const ok = await fetch(`${base}/chat/turns/x/stop`, { method: "OPTIONS", headers: ORIGIN });
    expect(ok.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("classifies errors without upstream text", () => {
    expect(classifyChatError({ kind: "timeout" }).kind).toBe("unavailable");
    expect(classifyChatError({ kind: "5xx", code: "x" })).toEqual({ kind: "failed", reason: "unknown", code: "x", message: "没做成，请稍后再试（错误码 x）" });
  });
});
