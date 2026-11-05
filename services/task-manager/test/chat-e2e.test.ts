// #19 part 2 end to end: desktop-facing chat API → ChatRunner → real FastClaw adapter → fake /v1.
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import { FastClawClient } from "@heybe/fastclaw-adapter";
import type { ChatTurnSnapshot, ChatWireEvent } from "@heybe/shared-types/chat";

import { fastClawChatStream } from "../src/chat.js";
import { openTaskDb } from "../src/db.js";
import { startTaskHttpServer, stopTaskHttpServer } from "../src/http.js";
import { startFakeV1, type FakeV1 } from "./fixtures/fake-v1-chat.js";

const TOKEN = "heybe-e2e-token-0123456789abcdef";
let server: Server | undefined;
let fake: FakeV1 | undefined;
afterEach(async () => {
  if (server) await stopTaskHttpServer(server);
  if (fake) await fake.close();
  server = undefined;
  fake = undefined;
});

async function setup(model?: string): Promise<string> {
  fake = await startFakeV1(model);
  const client = new FastClawClient({ baseUrl: fake.baseUrl, token: TOKEN, retry: { maxAttempts: 1 } });
  server = await startTaskHttpServer(openTaskDb(":memory:"), { port: 0, chat: fastClawChatStream(client, "agt_e2e") });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const H = { "content-type": "application/json", origin: "tauri://localhost" };
async function send(base: string, sid: string, content: string): Promise<ChatWireEvent[]> {
  const text = await (await fetch(`${base}/chat/sessions/${sid}/messages`, { method: "POST", headers: H, body: JSON.stringify({ content }) })).text();
  const lines = text.split("\n\n").filter(Boolean).map((l) => l.replace(/^data: /, ""));
  expect(lines.at(-1)).toBe("[DONE]");
  return lines.slice(0, -1).map((l) => JSON.parse(l) as ChatWireEvent);
}
async function turns(base: string, sid: string): Promise<ChatTurnSnapshot[]> {
  return ((await (await fetch(`${base}/chat/sessions/${sid}`, { headers: H })).json()) as { turns: ChatTurnSnapshot[] }).turns;
}

describe("chat end to end over the FastClaw adapter", () => {
  it("joins deltas in order, labels the cloud model source and ends done", async () => {
    const base = await setup();
    const evs = await send(base, "e1", "ok");
    expect(evs.filter((e) => e.type === "delta").map((e) => (e as { content: string }).content).join("")).toBe("# 标题\n\n第一段，第二段");
    expect(evs.find((e) => e.type === "source")).toMatchObject({ source: { label: "DeepSeek", model: "deepseek-chat", locality: "cloud" } });
    expect(evs.at(-1)).toMatchObject({ type: "done" });
    expect((await turns(base, "e1"))[0]).toMatchObject({ status: "done", text: "# 标题\n\n第一段，第二段" });
  });

  it("local model source for ollama", async () => {
    const base = await setup("ollama/qwen2.5:3b");
    const evs = await send(base, "e2", "ok");
    expect(evs.find((e) => e.type === "source")).toMatchObject({ source: { label: "本地 Ollama", model: "qwen2.5:3b", locality: "local" } });
  });

  it("HTTP 200 stream with a final error chunk ends failed with the specific reason", async () => {
    const base = await setup();
    const evs = await send(base, "e3", "error");
    expect(evs.filter((e) => e.type === "error")).toEqual([
      expect.objectContaining({ type: "error", kind: "failed", reason: "insufficient_balance" }),
    ]);
    expect(JSON.stringify(evs)).not.toContain("Insufficient Balance");
    expect((await turns(base, "e3"))[0]).toMatchObject({ status: "failed", text: "写到一半" });
  });

  it("a dropped gateway connection ends interrupted (result unknown), not done", async () => {
    const base = await setup();
    const evs = await send(base, "e4", "cut");
    expect(evs.at(-1)).toMatchObject({ type: "error", kind: "interrupted" });
    expect(evs.some((e) => e.type === "done")).toBe(false);
  });

  it("stop drops the gateway connection within 300 ms and says the server state is unknown", async () => {
    const base = await setup();
    const live = fetch(`${base}/chat/sessions/e5/messages`, { method: "POST", headers: H, body: JSON.stringify({ content: "slow" }) }).then((r) => r.text());
    await expect.poll(async () => (await turns(base, "e5"))[0]?.text).toBe("慢");
    const id = (await turns(base, "e5"))[0]!.id;
    const t0 = Date.now();
    const res = (await (await fetch(`${base}/chat/turns/${id}/stop`, { method: "POST", headers: H })).json()) as { serverStopped: string };
    expect(Date.now() - t0).toBeLessThan(300);
    expect(res.serverStopped).toBe("unknown");
    expect(await live).toContain('"type":"stopped"');
    await expect.poll(() => fake!.aborted).toBe(1);
  });
});
