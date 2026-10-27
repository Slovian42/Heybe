import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FASTCLAW_END_USER,
  FastClawClient,
  FastClawConfigError,
  fastClawAdminClientFromEnv,
  fastClawClientFromEnv,
  loadFastClawClientConfig,
} from "../src/index.js";

const CHAT = "fc_chat_token_do_not_log";
const ADMIN = "fc_admin_token_do_not_log";
const BASE = "http://127.0.0.1:18953";

const agent = {
  id: "agt_1",
  display_name: "Researcher",
  name: "agt_1",
  description: "",
  model: "",
  metadata: {},
  created_at: "2026-10-27T00:00:00Z",
  updated_at: "2026-10-27T00:00:00Z",
};

function recorder(respond: (url: string, init?: RequestInit) => Response) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function sseOk(): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("key split configuration", () => {
  it("chat role prefers HEYBE_FASTCLAW_CHAT_TOKEN and defaults the end-user", () => {
    const cfg = loadFastClawClientConfig({
      HEYBE_FASTCLAW_BASE_URL: BASE,
      HEYBE_FASTCLAW_CHAT_TOKEN: CHAT,
      HEYBE_FASTCLAW_TOKEN: "fc_legacy_token_ignored",
      HEYBE_FASTCLAW_ADMIN_TOKEN: ADMIN,
    });
    expect(cfg).toMatchObject({ role: "chat", token: CHAT, tokenVariable: "HEYBE_FASTCLAW_CHAT_TOKEN", endUser: DEFAULT_FASTCLAW_END_USER });
  });

  it("chat role falls back to the legacy HEYBE_FASTCLAW_TOKEN", () => {
    const cfg = loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_TOKEN: CHAT, HEYBE_FASTCLAW_END_USER: "heybe-u1" });
    expect(cfg).toMatchObject({ token: CHAT, tokenVariable: "HEYBE_FASTCLAW_TOKEN", endUser: "heybe-u1" });
  });

  it("admin role reads HEYBE_FASTCLAW_ADMIN_TOKEN only, never the chat key", () => {
    expect(() => loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_CHAT_TOKEN: CHAT }, { role: "admin" })).toThrow(
      /HEYBE_FASTCLAW_ADMIN_TOKEN/,
    );
    const cfg = loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_ADMIN_TOKEN: ADMIN }, { role: "admin" });
    expect(cfg).toMatchObject({ role: "admin", token: ADMIN });
    expect(cfg.endUser).toBeUndefined();
  });

  it("refuses the same key for chat and admin without echoing it", () => {
    try {
      loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_CHAT_TOKEN: ADMIN, HEYBE_FASTCLAW_ADMIN_TOKEN: ADMIN });
      throw new Error("expected config failure");
    } catch (err) {
      expect(err).toBeInstanceOf(FastClawConfigError);
      expect(String(err)).toMatch(/must differ/);
      expect(inspect(err)).not.toContain(ADMIN);
    }
  });

  it("rejects a malformed end-user id", () => {
    expect(() =>
      loadFastClawClientConfig({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_CHAT_TOKEN: CHAT, HEYBE_FASTCLAW_END_USER: "a b" }),
    ).toThrow(/HEYBE_FASTCLAW_END_USER/);
  });
});

describe("chat client", () => {
  it("sends the end-user on chat and file download by default", async () => {
    const { calls, fetchImpl } = recorder((url) => (url.includes("/files/") ? new Response("x") : sseOk()));
    const c = fastClawClientFromEnv({ HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_CHAT_TOKEN: CHAT }, { fetchImpl });
    expect(c.role).toBe("chat");
    const session = c.createSession({ agentId: "agt_1", sessionKey: "heybe:s1" });
    expect(session.endUser).toBe(DEFAULT_FASTCLAW_END_USER);
    for await (const _ of c.streamMessage(session, { messages: [{ role: "user", content: "hi" }] })) void _;
    await c.getSessionFile({ agentId: "agt_1", sessionKey: "heybe:s1", path: "a.txt" });
    const chatHeaders = calls[0]!.init!.headers as Record<string, string>;
    expect(chatHeaders["X-Fastclaw-End-User"]).toBe(DEFAULT_FASTCLAW_END_USER);
    expect(JSON.parse(String(calls[0]!.init!.body)).user).toBe(DEFAULT_FASTCLAW_END_USER);
    expect((calls[1]!.init!.headers as Record<string, string>)["X-Fastclaw-End-User"]).toBe(DEFAULT_FASTCLAW_END_USER);
  });

  it("refuses Agent mutations locally before any request", async () => {
    const { calls, fetchImpl } = recorder(() => json({ agent }));
    const c = new FastClawClient({ baseUrl: BASE, token: CHAT, fetchImpl, role: "chat" });
    await expect(c.createAgent({ name: "x" })).rejects.toMatchObject({ code: "role_forbidden", status: 403 });
    await expect(c.deleteAgent("agt_1")).rejects.toMatchObject({ code: "role_forbidden" });
    await expect(c.request("PATCH", "/v1/agents/agt_1", { model: "x" })).rejects.toMatchObject({ code: "role_forbidden" });
    await expect(c.request("PUT", "/v1/agents/agt_1/system-files/SOUL.md", {})).rejects.toMatchObject({ code: "role_forbidden" });
    await expect(c.request("POST", "/v1/users", { external_id: "x" })).rejects.toMatchObject({ code: "role_forbidden" });
    expect(calls).toHaveLength(0);
    await c.getAgent("agt_1");
    expect(calls).toHaveLength(1);
  });
});

describe("admin client", () => {
  it("creates and deletes Agents with the admin key", async () => {
    const { calls, fetchImpl } = recorder((_url, init) =>
      init?.method === "DELETE" ? json({ id: "agt_1", deleted: true }) : json({ agent }),
    );
    const c = fastClawAdminClientFromEnv(
      { HEYBE_FASTCLAW_BASE_URL: BASE, HEYBE_FASTCLAW_ADMIN_TOKEN: ADMIN, HEYBE_FASTCLAW_CHAT_TOKEN: CHAT },
      { fetchImpl },
    );
    expect(c.role).toBe("admin");
    await expect(c.createAgent({ name: "Researcher", instructions: "be brief" })).resolves.toMatchObject({ id: "agt_1" });
    await expect(c.deleteAgent("agt_1")).resolves.toEqual({ id: "agt_1", deleted: true });
    expect(calls.map((x) => `${x.init?.method} ${new URL(x.url).pathname}`)).toEqual(["POST /v1/agents", "DELETE /v1/agents/agt_1"]);
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe(`Bearer ${ADMIN}`);
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ name: "Researcher", instructions: "be brief" });
    expect(JSON.stringify(c)).not.toContain(ADMIN);
    expect(inspect(c, { showHidden: true, depth: 8 })).not.toContain(ADMIN);
  });

  it("cannot chat or patch Agents", async () => {
    const { calls, fetchImpl } = recorder(() => sseOk());
    const c = new FastClawClient({ baseUrl: BASE, token: ADMIN, fetchImpl, role: "admin" });
    const session = c.createSession({ agentId: "agt_1" });
    await expect(c.sendMessage(session, { messages: [{ role: "user", content: "hi" }] })).rejects.toMatchObject({ code: "role_forbidden" });
    await expect(c.request("PATCH", "/v1/agents/agt_1", {})).rejects.toMatchObject({ code: "role_forbidden" });
    await expect(c.request("DELETE", "/v1/agents/agt_1/system-files/x", undefined)).rejects.toMatchObject({ code: "role_forbidden" });
    expect(calls).toHaveLength(0);
  });
});
