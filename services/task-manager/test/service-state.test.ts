import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  ROLE_MARKER,
  STATE_JSON_FILE,
  STATE_PID_FILE,
  STATE_SANDBOX_LOG,
  openStateDir,
  sandboxPorts,
  serviceModeLine,
  startHeybeService,
  type SandboxHandle,
  type ServiceState,
} from "../src/index.js";

const TOKEN = "t".repeat(40);
const FAKE_GW = new URL("./fixtures/fake-gateway.mjs", import.meta.url).pathname;
const PKG = new URL("../package.json", import.meta.url).pathname;
const CLIENT_KEY = "client-key-must-not-leak-0123456789abcdef";

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
}
const mode = (f: string) => (statSync(f).mode & 0o777).toString(8);

describe("service mode line and state dir (#90 recheck)", () => {
  it("mode lines name the sandbox and the deploy mode", () => {
    expect(serviceModeLine({ sandbox: "boxlite", deploy: "hosted", gateway_port: 18963, proxy_port: 4001, serve_port: 4002 })).toBe(
      "heybe-service: 沙箱=boxlite（FastClaw 127.0.0.1:18963 → 代理 127.0.0.1:4001，强制 outbound=disabled → serve 127.0.0.1:4002）部署模式=hosted",
    );
    expect(serviceModeLine({ sandbox: "none", deploy: "self-hosted", gateway_port: 18963 })).toMatch(
      /^heybe-service: 沙箱=无（未设 HEYBE_BOXLITE_BIN.*部署模式=self-hosted（未设 FASTCLAW_DEPLOY）$/,
    );
    expect(serviceModeLine({ sandbox: "not_owned", deploy: "unknown" })).toMatch(/沙箱=未知.*部署模式=unknown/);
    expect(sandboxPorts({ proxyUrl: "http://127.0.0.1:4001", serveUrl: "http://127.0.0.1:4002" })).toEqual({ proxy_port: 4001, serve_port: 4002 });
    expect(sandboxPorts(undefined)).toEqual({ proxy_port: undefined, serve_port: undefined });
  });

  it("state dir: 700/600, pid + json, sandbox.log, remove() leaves only the log", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "heybe-state-")), "s");
    const sd = openStateDir(dir);
    const st: ServiceState = { pid: 4242, service_port: 1, sandbox: "boxlite", deploy: "hosted", started_at: "x" };
    sd.write(st);
    sd.sandboxLog("POST /v1/boxes: network override; outbound=disabled");
    expect(mode(dir)).toBe("700");
    expect(readFileSync(join(dir, STATE_PID_FILE), "utf8")).toBe("4242\n");
    expect(JSON.parse(readFileSync(join(dir, STATE_JSON_FILE), "utf8"))).toEqual(st);
    for (const f of [STATE_PID_FILE, STATE_JSON_FILE, STATE_SANDBOX_LOG]) expect(mode(join(dir, f))).toBe("600");
    expect(readFileSync(join(dir, STATE_SANDBOX_LOG), "utf8")).toMatch(/Z POST \/v1\/boxes: .*outbound=disabled\n$/);
    sd.remove();
    expect(existsSync(join(dir, STATE_PID_FILE))).toBe(false);
    expect(existsSync(join(dir, STATE_JSON_FILE))).toBe(false);
    expect(existsSync(join(dir, STATE_SANDBOX_LOG))).toBe(true);
  });

  it("startHeybeService with a (stub) sandbox: prints the mode line, writes state without keys, logs proxy lines", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "heybe-state-")), "s");
    const lines: string[] = [];
    const gwPort = await freePort();
    const svc = await startHeybeService(
      {
        HEYBE_SERVICE_TOKEN: TOKEN,
        HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW,
        HEYBE_BOXLITE_BIN: "/stub/boxlite",
        HEYBE_SERVICE_STATE_DIR: dir,
        FASTCLAW_PORT: String(gwPort),
        PATH: process.env.PATH,
        HOME: process.env.HOME,
      },
      {
        log: (l) => lines.push(l),
        ensureSkills: async () => undefined,
        startSandbox: async (o) => {
          o.log?.("listening 127.0.0.1:4001 -> 127.0.0.1:4002 (outbound network forced to disabled; auto_remove kept)");
          const h: SandboxHandle = {
            gatewayEnv: { extra: ["BOXLITE_API_KEY", "FASTCLAW_DEPLOY"], set: { BOXLITE_API_KEY: CLIENT_KEY, FASTCLAW_DEPLOY: "hosted" } },
            proxyUrl: "http://127.0.0.1:4001",
            serveUrl: "http://127.0.0.1:4002",
            compat: "ok",
            exited: new Promise(() => undefined),
            stop: async () => undefined,
          };
          return h;
        },
      },
    );
    try {
      expect(lines).toContain(
        `heybe-service: 沙箱=boxlite（FastClaw 127.0.0.1:${gwPort} → 代理 127.0.0.1:4001，强制 outbound=disabled → serve 127.0.0.1:4002）部署模式=hosted`,
      );
      expect(lines.some((l) => l.startsWith("heybe-sandbox: listening 127.0.0.1:4001"))).toBe(true);
      const json = readFileSync(join(dir, STATE_JSON_FILE), "utf8");
      expect(JSON.parse(json)).toMatchObject({ pid: process.pid, service_port: svc.port, sandbox: "boxlite", deploy: "hosted", gateway_port: gwPort, proxy_port: 4001, serve_port: 4002 });
      expect(readFileSync(join(dir, STATE_PID_FILE), "utf8")).toBe(`${process.pid}\n`);
      expect(readFileSync(join(dir, STATE_SANDBOX_LOG), "utf8")).toContain("outbound network forced to disabled");
      for (const f of [STATE_JSON_FILE, STATE_SANDBOX_LOG]) expect(readFileSync(join(dir, f), "utf8")).not.toContain(CLIENT_KEY);
      expect(lines.join("\n")).not.toContain(CLIENT_KEY);
      expect(lines.join("\n")).not.toContain(TOKEN);
    } finally {
      await svc.stop();
    }
    expect(existsSync(join(dir, STATE_PID_FILE))).toBe(false);
  });

  it("without the sandbox: says so (self-hosted)", async () => {
    const lines: string[] = [];
    const svc = await startHeybeService(
      { HEYBE_SERVICE_TOKEN: TOKEN, HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW, FASTCLAW_PORT: String(await freePort()), PATH: process.env.PATH, HOME: process.env.HOME },
      { log: (l) => lines.push(l), ensureSkills: async () => undefined },
    );
    await svc.stop();
    expect(lines.find((l) => l.includes("沙箱="))).toMatch(/沙箱=无.*部署模式=self-hosted/);
  });

  it("package start script carries the argv marker for pkill -f", () => {
    const pkg = JSON.parse(readFileSync(PKG, "utf8")) as { scripts: { start: string } };
    expect(pkg.scripts.start).toBe(`tsx src/main.ts ${ROLE_MARKER}`);
  });
});
