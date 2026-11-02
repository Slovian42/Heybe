import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GatewayError, gatewayArgs, knownVersion, parseCliVersion, startGateway, versionsConflict } from "../src/gateway.js";
import { ERROR_PREFIX } from "../src/service.js";

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

/** A FastClaw home for the fake with behaviour knobs (see fixtures/fake-gateway.mjs). */
function fakeHome(knobs: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "heybe-fakefc-"));
  writeFileSync(join(dir, "fake.json"), JSON.stringify(knobs));
  return dir;
}

const baseEnv = (port: number, home?: string) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  FASTCLAW_PORT: String(port),
  ...(home ? { FASTCLAW_HOME: home } : {}),
});

const servers: Array<Server | http.Server> = [];
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const c of sockets) c.destroy();
  sockets.clear();
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(() => r(undefined)))));
});

/** Something already on the port: a "FastClaw" reporting `version`, or a plain TCP listener. */
async function occupy(port: number, version?: string): Promise<void> {
  const s =
    version === undefined
      ? createServer((c) => c.end())
      : http.createServer((q, r) => {
          if (q.url === "/api/status") r.end(JSON.stringify({ version }));
          else r.end("ok");
        });
  servers.push(s);
  s.on("connection", (c: Socket) => {
    sockets.add(c);
    c.once("close", () => sockets.delete(c));
  });
  await new Promise<void>((r) => s.listen(port, "127.0.0.1", () => r()));
}

async function expectGatewayError(p: Promise<unknown>, code: string): Promise<GatewayError> {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GatewayError);
  expect((err as GatewayError).code).toBe(code);
  return err as GatewayError;
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
    const gw = await startGateway({ bin: FAKE_GW, port, env: baseEnv(port) });
    expect(gw.child.spawnargs.slice(1)).toEqual(["gateway", "--port", String(port)]);
    expect((await fetch(`http://127.0.0.1:${port}/healthz`)).ok).toBe(true);
    await gw.stop();
  });
});

describe("versions", () => {
  it("treats dev/unknown as not comparable (official v1.4.0 gateways report dev)", () => {
    expect(knownVersion("dev")).toBeUndefined();
    expect(knownVersion("v1.4.0")).toBe("1.4.0");
    expect(versionsConflict("dev", "v1.4.0")).toBe(false);
    expect(versionsConflict("1.4.0", "v1.4.0")).toBe(false);
    expect(versionsConflict("v1.3.2", "v1.4.0")).toBe(true);
    expect(parseCliVersion("FastClaw v1.4.0\n  commit: b5ad3df\n")).toBe("v1.4.0");
    expect(parseCliVersion("garbage")).toBeUndefined();
  });
});

describe("startup checks (mock)", () => {
  it("port occupied by a non-FastClaw program → E_FC_PORT_BUSY, nothing spawned", async () => {
    const port = await freePort();
    await occupy(port);
    const err = await expectGatewayError(startGateway({ bin: FAKE_GW, port, env: baseEnv(port) }), "E_FC_PORT_BUSY");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain(`端口 ${port}`);
    expect(err.message).toContain("lsof");
  });

  it("foreign FastClaw gateway with another version → E_FC_VERSION_MISMATCH, never attaches", async () => {
    const port = await freePort();
    await occupy(port, "v1.3.2");
    const err = await expectGatewayError(startGateway({ bin: FAKE_GW, port, env: baseEnv(port) }), "E_FC_VERSION_MISMATCH");
    expect(err.retryable).toBe(false);
    expect(err.message).toContain("v1.3.2");
    expect(err.message).toContain("v1.4.0");
    expect(err.message).toContain("fastclaw daemon stop");
  });

  it("foreign FastClaw gateway reporting dev (the Mac case) → E_FC_FOREIGN_GATEWAY", async () => {
    const port = await freePort();
    await occupy(port, "dev");
    const err = await expectGatewayError(startGateway({ bin: FAKE_GW, port, env: baseEnv(port) }), "E_FC_FOREIGN_GATEWAY");
    expect(err.message).toContain("不是 Heybe 这次启动的");
  });

  it("our own gateway reports a different version than the CLI → E_FC_VERSION_MISMATCH and it is stopped", async () => {
    const port = await freePort();
    const home = fakeHome({ cliVersion: "v1.4.0", statusVersion: "v1.5.0" });
    await expectGatewayError(startGateway({ bin: FAKE_GW, port, env: baseEnv(port, home) }), "E_FC_VERSION_MISMATCH");
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow();
  });

  it("own gateway reporting dev with CLI v1.4.0 is accepted (v1.4.0 release quirk)", async () => {
    const port = await freePort();
    const gw = await startGateway({ bin: FAKE_GW, port, env: baseEnv(port, fakeHome({ statusVersion: "dev" })) });
    expect(gw.version).toBe("dev");
    await gw.stop();
  });

  it("READY timeout → E_FC_READY_TIMEOUT, child killed, retryable", async () => {
    const port = await freePort();
    const t0 = Date.now();
    const p = startGateway({ bin: FAKE_GW, port, env: baseEnv(port, fakeHome({ neverReady: true })), readyTimeoutMs: 800 });
    const err = await expectGatewayError(p, "E_FC_READY_TIMEOUT");
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("秒内没有就绪");
  });

  it("slow gateway inside the timeout is fine (backoff keeps polling)", async () => {
    const port = await freePort();
    const gw = await startGateway({
      bin: FAKE_GW,
      port,
      env: baseEnv(port, fakeHome({ readyAfterMs: 1200 })),
      readyTimeoutMs: 5000,
      maxDelayMs: 400,
    });
    await gw.stop();
  });

  it("bind failure in the child (port grabbed after our check) → E_FC_PORT_BUSY", async () => {
    const port = await freePort();
    const p = startGateway({ bin: FAKE_GW, port, env: baseEnv(port, fakeHome({ bindError: true })), readyTimeoutMs: 3000 });
    await expectGatewayError(p, "E_FC_PORT_BUSY");
  });

  it("child that exits during startup → E_FC_EXITED with its last output", async () => {
    const port = await freePort();
    const err = await expectGatewayError(
      startGateway({ bin: FAKE_GW, port, env: baseEnv(port, fakeHome({ exitWith: 2 })) }),
      "E_FC_EXITED",
    );
    expect(err.retryable).toBe(true);
    expect(err.message).toContain("退出码 2");
    expect(err.message).toContain("fake: config broken");
  });

  it("main.ts prints a HEYBE_SERVICE_ERROR line and exits 3 when the port is taken", async () => {
    const port = await freePort();
    await occupy(port, "dev");
    const child = spawn(TSX, [MAIN], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HEYBE_SERVICE_TOKEN: "t".repeat(40),
        HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW,
        FASTCLAW_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    const code = await new Promise<number | null>((r) => child.once("exit", r));
    expect(code).toBe(3);
    const line = out.split("\n").find((l) => l.startsWith(ERROR_PREFIX));
    expect(line).toBeDefined();
    const body = JSON.parse(line!.slice(ERROR_PREFIX.length)) as { code: string; retryable: boolean; message: string };
    expect(body).toMatchObject({ code: "E_FC_FOREIGN_GATEWAY", retryable: false });
    expect(out).not.toContain("t".repeat(40));
  }, 30_000);
});
