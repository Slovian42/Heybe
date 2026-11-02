import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEFAULT_SERVICE_URL, serviceUrl } from "../src/config";

const conf = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const caps = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));

describe("service URL", () => {
  it("only accepts loopback http", () => {
    expect(serviceUrl("http://127.0.0.1:4000/")).toBe("http://127.0.0.1:4000");
    expect(serviceUrl("https://evil.example")).toBe(DEFAULT_SERVICE_URL);
    expect(serviceUrl("http://localhost:4000")).toBe(DEFAULT_SERVICE_URL);
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
