import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { READY_PREFIX, startHeybeService, tokenMatches } from "../src/index.js";

const TOKEN = "t".repeat(40);
const FAKE_GW = new URL("./fixtures/fake-gateway.mjs", import.meta.url).pathname;
const MAIN = new URL("../src/main.ts", import.meta.url).pathname;
const TSX = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

describe("heybe service (19-b)", () => {
  it("refuses a missing/short token", async () => {
    await expect(startHeybeService({})).rejects.toThrow(/HEYBE_SERVICE_TOKEN/);
    await expect(startHeybeService({ HEYBE_SERVICE_TOKEN: "short" })).rejects.toThrow(/HEYBE_SERVICE_TOKEN/);
  });

  it("random port, open /health, chat on by default and behind the token", async () => {
    const svc = await startHeybeService(
      { HEYBE_SERVICE_TOKEN: TOKEN },
      { chat: async function* () { yield { type: "done", finishReason: "stop" }; } },
    );
    const base = `http://127.0.0.1:${svc.port}`;
    try {
      expect(svc.port).toBeGreaterThan(0);
      expect((await fetch(`${base}/health`)).status).toBe(200);
      const body = JSON.stringify({ content: "hi" });
      const url = `${base}/chat/sessions/s/messages`;
      expect((await fetch(url, { method: "POST", body })).status).toBe(401);
      expect((await fetch(url, { method: "POST", body, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
      expect((await fetch(`${base}/tasks/x`)).status).toBe(401);
      const ok = await fetch(url, { method: "POST", body, headers: { authorization: `Bearer ${TOKEN}` } });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain("[DONE]");
    } finally {
      await svc.stop();
    }
  });

  it("tokenMatches is exact", () => {
    expect(tokenMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(tokenMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(tokenMatches(undefined, TOKEN)).toBe(false);
  });

  it("owns the gateway: starts it, stops it on stop()", async () => {
    const svc = await startHeybeService({
      HEYBE_SERVICE_TOKEN: TOKEN,
      HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW,
      FASTCLAW_PORT: String(await freePort()),
      PATH: process.env.PATH,
      HOME: process.env.HOME,
    });
    expect(svc.gatewayExited).toBeDefined();
    await svc.stop();
    await expect(svc.gatewayExited).resolves.not.toBe(undefined);
  });

  it("main.ts prints READY, exits on SIGTERM and stops its gateway (no leftovers)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "heybe-main-"));
    const pidfile = join(dir, "gw.pid");
    const child = spawn(TSX, [MAIN], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HEYBE_SERVICE_TOKEN: TOKEN,
        HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW,
        FASTCLAW_PORT: String(await freePort()),
        FASTCLAW_HOME: pidfile, // whitelisted name reused to tell the fake where to write its pid
      },
      stdio: ["pipe", "pipe", "inherit"],
    });
    const line = await new Promise<string>((resolve, reject) => {
      let buf = "";
      child.stdout.on("data", (d: Buffer) => {
        buf += d.toString();
        const l = buf.split("\n").find((x) => x.startsWith(READY_PREFIX));
        if (l) resolve(l);
      });
      child.once("exit", () => reject(new Error("exited early")));
    });
    const { port } = JSON.parse(line.slice(READY_PREFIX.length)) as { port: number };
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    const gwPid = Number(readFileSync(pidfile, "utf8"));
    expect(alive(gwPid)).toBe(true);
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    await exited;
    await expect.poll(() => alive(gwPid), { timeout: 5000 }).toBe(false);
  }, 30_000);
});
