import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { afterEach, describe, expect, it } from "vitest";
import type { V1StreamEvent } from "@heybe/shared-types";

import {
  classifyChatError,
  openTaskDb,
  startTaskHttpServer,
  stopTaskHttpServer,
  type ChatStreamFn,
  type ChatStreamInput,
} from "../src/index.js";

let server: Server | undefined;
afterEach(async () => {
  if (server) await stopTaskHttpServer(server);
  server = undefined;
});

async function start(chat: ChatStreamFn): Promise<string> {
  server = await startTaskHttpServer(openTaskDb(":memory:"), { port: 0, chat });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function post(base: string, id: string, content: string, init: RequestInit = {}) {
  return fetch(`${base}/chat/sessions/${id}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "tauri://localhost" },
    body: JSON.stringify({ content }),
    ...init,
  });
}

function dataLines(text: string): string[] {
  return text.split("\n\n").filter(Boolean).map((b) => b.replace(/^data: /, ""));
}

describe("chat SSE API", () => {
  it("forwards delta/tool/done in order and ends with [DONE]", async () => {
    let seen: ChatStreamInput | undefined;
    const base = await start(async function* (input) {
      seen = input;
      yield { type: "delta", content: "你" } satisfies V1StreamEvent;
      yield { type: "tool", tool: { id: "t1", name: "web_fetch", status: "running" } };
      yield { type: "tool", tool: { id: "t1", name: "web_fetch", status: "completed" } };
      yield { type: "delta", content: "好" };
      yield { type: "done", finishReason: "stop" };
    });
    const res = await post(base, "abc", "hi");
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    expect(res.headers.get("access-control-allow-origin")).toBe("tauri://localhost");
    const lines = dataLines(await res.text());
    expect(lines.at(-1)).toBe("[DONE]");
    expect(lines.slice(0, -1).map((l) => JSON.parse(l))).toEqual([
      { type: "delta", content: "你" },
      { type: "tool", id: "t1", name: "web_fetch", status: "running" },
      { type: "tool", id: "t1", name: "web_fetch", status: "done" },
      { type: "delta", content: "好" },
      { type: "done", finishReason: "stop" },
    ]);
    expect(seen?.sessionKey).toBe("heybe:chat:abc");
    expect(seen?.content).toBe("hi");
  });

  it("reports a truncated upstream as interrupted (result unknown)", async () => {
    const base = await start(async function* () {
      yield { type: "delta", content: "部分" };
      throw Object.assign(new Error("secret upstream text"), { kind: "network", code: "stream_truncated" });
    });
    const text = await (await post(base, "s1", "hi")).text();
    expect(text).not.toContain("secret upstream text");
    const lines = dataLines(text);
    expect(JSON.parse(lines[1]!)).toEqual({ type: "error", kind: "interrupted", reason: "interrupted", message: "中断，结果未知" });
    expect(lines.at(-1)).toBe("[DONE]");
  });

  it("sends the specific reason for an upstream 401 (agent_error), without the upstream text", async () => {
    // eslint-disable-next-line require-yield -- fails before the first event, like an upstream 401
    const base = await start(async function* () {
      throw Object.assign(
        new Error(
          'FastClaw POST /v1/chat/completions failed (5xx): agent_error: API error 401: {"error": {"message": "Authentication Fails, Your api key: ****KEYZ is invalid", "type": "authentication_error"}}',
        ),
        { kind: "5xx", status: 200, code: "agent_error" },
      );
    });
    const text = await (await post(base, "s4", "hi")).text();
    expect(text).not.toContain("KEYZ");
    expect(text).not.toContain("Authentication Fails");
    expect(JSON.parse(dataLines(text)[0]!)).toEqual({
      type: "error",
      kind: "failed",
      reason: "key_invalid",
      code: "upstream_401",
      message: "模型密钥无效，请到设置里更换",
    });
  });

  it("aborts the upstream stream when the client disconnects (stop)", async () => {
    let upstreamSignal: AbortSignal | undefined;
    const base = await start(async function* ({ signal }) {
      upstreamSignal = signal;
      yield { type: "delta", content: "a" };
      await new Promise((r) => signal.addEventListener("abort", r));
    });
    const ctl = new AbortController();
    const res = await post(base, "s2", "hi", { signal: ctl.signal });
    const reader = res.body!.getReader();
    await reader.read();
    ctl.abort();
    await expect.poll(() => upstreamSignal?.aborted).toBe(true);
  });

  it("rejects empty content, bad ids and answers CORS preflight", async () => {
    const base = await start(async function* () {});
    expect((await post(base, "s3", "  ")).status).toBe(400);
    expect((await post(base, "bad%2Fid", "x")).status).toBe(404);
    const pre = await fetch(`${base}/chat/sessions/s3/messages`, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("classifies errors without upstream text", () => {
    expect(classifyChatError({ kind: "timeout" }).kind).toBe("unavailable");
    expect(classifyChatError({ kind: "5xx", code: "x" })).toEqual({ kind: "failed", reason: "unknown", code: "x", message: "没做成，请稍后再试（错误码 x）" });
  });
});
