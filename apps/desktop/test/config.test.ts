import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { loadServiceInfo, loopbackUrl } from "../src/config";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const caps = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

describe("service info (19-b)", () => {
  it("only accepts loopback http", () => {
    expect(loopbackUrl("http://127.0.0.1:4000/")).toBe("http://127.0.0.1:4000");
    expect(loopbackUrl("https://evil.example")).toBeNull();
    expect(loopbackUrl("http://localhost:4000")).toBeNull();
  });
  it("reads url + token from the Tauri service_info command", async () => {
    const invoke = async (cmd: string) => {
      expect(cmd).toBe("service_info");
      return { status: "ready", url: "http://127.0.0.1:5555", token: "tok", restarts: 1 };
    };
    expect(await loadServiceInfo(invoke)).toEqual({ status: "ready", url: "http://127.0.0.1:5555", token: "tok", restarts: 1 });
  });
  it("hides the url while reconnecting and rejects non-loopback urls", async () => {
    expect((await loadServiceInfo(async () => ({ status: "reconnecting", url: "http://127.0.0.1:1", token: "t" }))).url).toBeNull();
    expect((await loadServiceInfo(async () => ({ status: "ready", url: "http://evil.example:80", token: "t" }))).url).toBeNull();
  });
  it("falls back to VITE_* env outside Tauri", async () => {
    const info = await loadServiceInfo(undefined, { VITE_HEYBE_SERVICE_URL: "http://127.0.0.1:7000", VITE_HEYBE_SERVICE_TOKEN: "x" });
    expect(info).toMatchObject({ status: "ready", url: "http://127.0.0.1:7000", token: "x" });
  });
});

describe("Tauri shell config (19-a)", () => {
  const csp: string = conf.app.security.csp;
  it("has a CSP that only allows self and loopback", () => {
    expect(csp).toContain("default-src 'self'");
    const sources = csp.split(";").flatMap((d) => d.trim().split(/\s+/).slice(1));
    for (const s of sources) {
      expect(s).toMatch(/^('self'|'none'|'unsafe-inline'|http:\/\/127\.0\.0\.1:\*|ipc:|http:\/\/ipc\.localhost|data:)$/);
    }
    expect(csp).toContain("object-src 'none'");
  });
  it("never loads FastClaw web/ or a remote page", () => {
    expect(conf.build.frontendDist).toBe("../dist");
    const raw = JSON.stringify({ build: conf.build, windows: conf.app.windows });
    expect(raw).not.toMatch(/fastclaw|\/web\b/i);
    expect(conf.build.devUrl).toBe("http://localhost:1420");
    expect(conf.app.windows.every((w: { url?: string }) => w.url === undefined)).toBe(true);
  });
  it("only grants minimal capabilities", () => {
    expect(caps.permissions.some((p: string) => /^(shell|fs|http):/.test(p))).toBe(false);
  });
  it("builds arm64 only", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts["tauri:build:mac"]).toBe("tauri build --target aarch64-apple-darwin");
  });
});
