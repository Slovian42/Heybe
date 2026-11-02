import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

import { describe, expect, it } from "vitest";

import { gatewayArgs, startGateway } from "../src/gateway.js";

const FAKE_GW = new URL("./fixtures/fake-gateway.mjs", import.meta.url).pathname;

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}

describe("FastClaw gateway spawn (no TTY needed)", () => {
  it("uses the explicit foreground `gateway --port` subcommand, never a bare fastclaw", () => {
    expect(gatewayArgs(18963)).toEqual(["gateway", "--port", "18963"]);
  });

  it("fixture mimics v1.4.0: bare `fastclaw` with /dev/null stdio fails without a TTY", () => {
    const r = spawnSync(process.execPath, [FAKE_GW], { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("could not open a new TTY");
  });

  it("starts with stdin ignored and stays up", async () => {
    const port = await freePort();
    const gw = await startGateway({
      bin: FAKE_GW,
      port,
      healthUrl: `http://127.0.0.1:${port}/healthz`,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, FASTCLAW_PORT: String(port) },
    });
    expect(gw.child.spawnargs.slice(1)).toEqual(["gateway", "--port", String(port)]);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).ok).toBe(true);
    await gw.stop();
  });
});
