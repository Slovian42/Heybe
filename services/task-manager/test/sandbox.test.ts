import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildChildEnv } from "../src/child-env.js";
import { startGateway } from "../src/gateway.js";
import { boxliteServeArgs, freeLoopbackPort, generateKey, sandboxGatewayEnv, SandboxError, startSandbox, type SandboxHandle } from "../src/sandbox.js";
import { startHeybeService } from "../src/service.js";

const FAKE_BOXLITE = new URL("./fixtures/fake-boxlite.mjs", import.meta.url).pathname;
const FAKE_GW = new URL("./fixtures/fake-gateway.mjs", import.meta.url).pathname;
const FAKE_SECRET = "sk-test-not-a-real-key";

function boxliteHome(mode = ""): string {
  const dir = mkdtempSync(join(tmpdir(), "heybe-fakebl-"));
  if (mode) writeFileSync(join(dir, "mode"), mode);
  return dir;
}
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const parentEnv = (home: string) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  BOXLITE_HOME: home,
  DEEPSEEK_API_KEY: FAKE_SECRET,
  BOXLITE_SERVE_API_KEY: "parent-value-must-not-win",
  FASTCLAW_SANDBOX_BOXLITE_URL: "http://127.0.0.1:1/parent",
});

const handles: SandboxHandle[] = [];
afterEach(async () => {
  await Promise.all(handles.splice(0).map((h) => h.stop()));
});

describe("sandbox keys and env", () => {
  it("generates distinct 256-bit base64url keys", () => {
    const a = generateKey();
    const b = generateKey();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it("serve listens on loopback only; no key in argv", () => {
    expect(boxliteServeArgs(8100)).toEqual(["serve", "--host", "127.0.0.1", "--port", "8100"]);
  });

  it("gateway env: sandbox on, URL = proxy, BOXLITE_API_KEY passes the /KEY/i filter only as an explicit extra", () => {
    const opts = sandboxGatewayEnv("http://127.0.0.1:5555", "client-key-x");
    const { env } = buildChildEnv({ PATH: "/b", BOXLITE_API_KEY: "parent", OPENAI_API_KEY: FAKE_SECRET }, opts);
    expect(env).toMatchObject({
      FASTCLAW_SANDBOX_ENABLED: "1",
      FASTCLAW_SANDBOX_ENFORCE: "1",
      FASTCLAW_SANDBOX_BACKEND: "boxlite",
      FASTCLAW_SANDBOX_BOXLITE_URL: "http://127.0.0.1:5555",
      FASTCLAW_SANDBOX_BOXLITE_PREFIX: "v1",
      BOXLITE_API_KEY: "client-key-x",
    });
    expect(env.OPENAI_API_KEY).toBeUndefined();
    // Without the sandbox options a parent BOXLITE_API_KEY is dropped like any other secret.
    expect(buildChildEnv({ BOXLITE_API_KEY: "parent" }).env.BOXLITE_API_KEY).toBeUndefined();
  });
});

describe("startSandbox (fake boxlite serve)", () => {
  it("passes the serve key by env only, requires it (401), and proxies with the client key", async () => {
    const home = boxliteHome();
    const sb = await startSandbox({ bin: FAKE_BOXLITE, env: parentEnv(home), log: () => undefined });
    handles.push(sb);
    const rec = JSON.parse(readFileSync(join(home, "record.json"), "utf8")) as { argv: string[]; envNames: string[]; keySha: string };
    // argv carries no key; env has the generated one (not the parent's), and no other secrets.
    expect(rec.argv).toEqual(boxliteServeArgs(Number(new URL(sb.serveUrl).port)));
    expect(rec.keySha).not.toBe(sha("parent-value-must-not-win"));
    expect(rec.envNames).toContain("BOXLITE_SERVE_API_KEY");
    expect(rec.envNames).not.toContain("DEEPSEEK_API_KEY");

    // serve itself: 401 without a key (except /v1/config).
    expect((await fetch(`${sb.serveUrl}/v1/boxes`)).status).toBe(401);
    expect((await fetch(`${sb.serveUrl}/v1/config`)).status).toBe(200);

    const clientKey = sb.gatewayEnv.set?.BOXLITE_API_KEY ?? "";
    expect(clientKey).toHaveLength(43);
    expect(sha(clientKey)).not.toBe(rec.keySha); // two different keys
    expect(sb.gatewayEnv.set?.FASTCLAW_SANDBOX_BOXLITE_URL).toBe(sb.proxyUrl);
    expect(sb.compat).toBe("reject_auto_remove");

    // proxy: 401 without the client key; serve key is not accepted by the proxy either.
    expect((await fetch(`${sb.proxyUrl}/v1/boxes`)).status).toBe(401);
    // FastClaw's create body: auto_remove stripped, network forced to disabled.
    const res = await fetch(`${sb.proxyUrl}/v1/boxes`, {
      method: "POST",
      headers: { authorization: `Bearer ${clientKey}`, "content-type": "application/json" },
      body: JSON.stringify({ image: "alpine:latest", auto_remove: false, network: { outbound: { mode: "enabled" } } }),
    });
    expect(res.status).toBe(201);
    const bodies = readFileSync(join(home, "boxes.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(bodies.at(-1)).toEqual({
      image: "alpine:latest",
      network: { outbound: { mode: "disabled" }, inbound: { mode: "disabled" } },
    });
    // No key material on disk besides the hash the fake wrote.
    expect(readFileSync(join(home, "boxes.jsonl"), "utf8")).not.toContain(clientKey);
  });

  it("refuses a serve that does not enforce the key", async () => {
    const err = await startSandbox({ bin: FAKE_BOXLITE, env: parentEnv(boxliteHome("nokey")), log: () => undefined }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SandboxError);
    expect((err as SandboxError).code).toBe("E_BOXLITE_NO_AUTH");
  });

  it("reports a serve that exits during startup", async () => {
    const err = await startSandbox({ bin: FAKE_BOXLITE, env: parentEnv(boxliteHome("exit")), log: () => undefined }).catch((e: unknown) => e);
    expect((err as SandboxError).code).toBe("E_BOXLITE_EXITED");
    expect((err as Error).message).toContain("refusing to start");
  });

  it("stop() ends serve and the proxy", async () => {
    const sb = await startSandbox({ bin: FAKE_BOXLITE, env: parentEnv(boxliteHome()), log: () => undefined });
    await sb.stop();
    expect(await sb.exited).not.toBeUndefined();
    await expect(fetch(`${sb.proxyUrl}/v1/config`)).rejects.toThrow();
  });
});

describe("gateway gets the sandbox env (env only)", () => {
  it("startGateway childEnv reaches the gateway child; parent FASTCLAW_SANDBOX_* cannot override it", async () => {
    const fcHome = mkdtempSync(join(tmpdir(), "heybe-fakefc-"));
    writeFileSync(join(fcHome, "fake.json"), JSON.stringify({ recordEnv: true }));
    const port = await freeLoopbackPort();
    const gw = await startGateway({
      bin: FAKE_GW,
      port,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, FASTCLAW_HOME: fcHome, FASTCLAW_SANDBOX_BOXLITE_URL: "http://evil", DEEPSEEK_API_KEY: FAKE_SECRET },
      childEnv: sandboxGatewayEnv("http://127.0.0.1:5555", "c".repeat(43)),
    });
    try {
      const rec = JSON.parse(readFileSync(join(fcHome, "env.json"), "utf8")) as { names: string[]; sandbox: Record<string, string>; apiKeyLength: number };
      expect(rec.sandbox.FASTCLAW_SANDBOX_BOXLITE_URL).toBe("http://127.0.0.1:5555");
      expect(rec.sandbox.FASTCLAW_SANDBOX_BACKEND).toBe("boxlite");
      expect(rec.apiKeyLength).toBe(43);
      expect(rec.names).not.toContain("DEEPSEEK_API_KEY");
      expect(gw.child.spawnargs.join(" ")).not.toContain("c".repeat(43));
    } finally {
      await gw.stop();
    }
  });

  it("service: HEYBE_BOXLITE_BIN starts the sandbox first and hands its env to the gateway", async () => {
    const home = boxliteHome();
    let seen: Parameters<typeof startGateway>[0] | undefined;
    const svc = await startHeybeService(
      { HEYBE_SERVICE_TOKEN: "t".repeat(40), HEYBE_FASTCLAW_GATEWAY_BIN: "/nonexistent/fastclaw", HEYBE_BOXLITE_BIN: FAKE_BOXLITE, ...parentEnv(home) },
      {
        chat: async function* () {
          yield { type: "done", finishReason: "stop" };
        },
        startGateway: async (o) => {
          seen = o;
          return { child: undefined as never, exited: new Promise(() => undefined), stop: async () => undefined };
        },
      },
    );
    try {
      expect(existsSync(join(home, "record.json"))).toBe(true);
      const set = seen?.childEnv?.set ?? {};
      expect(set.FASTCLAW_SANDBOX_BOXLITE_URL).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      expect((await fetch(`${set.FASTCLAW_SANDBOX_BOXLITE_URL}/v1/boxes`)).status).toBe(401);
      expect((await fetch(`${set.FASTCLAW_SANDBOX_BOXLITE_URL}/v1/boxes`, { headers: { authorization: `Bearer ${set.BOXLITE_API_KEY}` } })).status).toBe(200);
    } finally {
      await svc.stop();
    }
    await expect(fetch(`${seen?.childEnv?.set?.FASTCLAW_SANDBOX_BOXLITE_URL}/v1/config`)).rejects.toThrow();
  });
});
