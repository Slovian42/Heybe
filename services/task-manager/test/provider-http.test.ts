import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { MemorySecretStore, startTaskHttpServer, stopTaskHttpServer } from "../src/index.js";
import { migrate } from "../src/migrate.js";

const KEY = "sk-test-SECRET-abcdef1234567890";
let server: Server;
let base = "";
const tested: unknown[] = [];

beforeAll(async () => {
  const db = new Database(":memory:");
  migrate(db);
  server = await startTaskHttpServer(db, {
    providers: {
      secrets: new MemorySecretStore(),
      test: async (cfg) => (tested.push(cfg), { providerId: cfg.id, kind: cfg.kind, status: "ok", code: "ok", message: "连接正常", testedAt: "t" }),
    },
  });
  const a = server.address();
  base = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}`;
});
afterAll(() => stopTaskHttpServer(server));

const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(base + path, { method, ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
  return { status: r.status, text: await r.text() };
};

describe("/providers routes", () => {
  it("key lifecycle never returns the key", async () => {
    const put = await call("PUT", "/providers/keys/heybe.provider.x", { value: KEY });
    expect(put.status).toBe(200);
    expect(JSON.parse(put.text)).toEqual({ set: true, last4: KEY.slice(-4) });
    expect((await call("POST", "/providers/keys/heybe.provider.x/verify", { value: KEY })).text).toBe('{"match":true}');
    expect((await call("POST", "/providers/keys/heybe.provider.x/verify", { value: KEY + "x" })).text).toBe('{"match":false}');
    expect(JSON.parse((await call("GET", "/providers/keys/heybe.provider.x")).text)).toEqual({ set: true, last4: KEY.slice(-4) });
    expect((await call("DELETE", "/providers/keys/heybe.provider.x")).status).toBe(200);
    const after = await call("GET", "/providers/keys/heybe.provider.x");
    expect(JSON.parse(after.text)).toEqual({ set: false });
    for (const r of [put, after]) expect(r.text).not.toContain(KEY);
  });
  it("bad ref → 400; test route passes config", async () => {
    expect((await call("GET", "/providers/keys/bad%20ref")).status).toBe(400);
    const r = await call("POST", "/providers/test", { id: "deepseek", kind: "deepseek" });
    expect(JSON.parse(r.text).code).toBe("ok");
    expect(tested).toHaveLength(1);
  });
});

describe("/providers routes behind the 19-b startup token", () => {
  it("401 without/with wrong Bearer, 200 with the right one", async () => {
    const TOKEN = "t".repeat(40);
    const db = new Database(":memory:");
    migrate(db);
    const s = await startTaskHttpServer(db, {
      token: TOKEN,
      providers: { secrets: new MemorySecretStore(), test: async () => { throw new Error("unused"); } },
    });
    const a = s.address();
    const url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/providers/keys/heybe.provider.x`;
    try {
      expect((await fetch(url)).status).toBe(401);
      expect((await fetch(url, { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      const put = await fetch(url, { method: "PUT", body: JSON.stringify({ value: KEY }) });
      expect(put.status).toBe(401);
      const ok = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}` } });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual({ set: false });
    } finally {
      await stopTaskHttpServer(s);
    }
  });
});

describe("scripts/dev/providers-mac-check.sh --mock", () => {
  it("dry run passes and prints no key", () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const out = execFileSync("bash", [resolve(root, "scripts/dev/providers-mac-check.sh"), "--mock", "--yes"], { encoding: "utf8", timeout: 60_000 });
    expect(out).toContain("全部通过");
    expect(out).toMatch(/通过 \d+，失败 0/);
    expect(out).not.toMatch(/sk-mock[0-9a-f]{24}/);
  }, 90_000);
});
