import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildChildEnv, isSecretEnvName, lockPrivateTree } from "../src/index.js";

const FAKE = "sk-test-not-a-real-key";

describe("buildChildEnv", () => {
  it("keeps allowlisted names and drops everything else", () => {
    const { env, dropped } = buildChildEnv({
      PATH: "/usr/bin",
      HOME: "/h",
      FASTCLAW_HOME: "/h/fc",
      DEEPSEEK_API_KEY: FAKE,
      OPENAI_API_KEY: FAKE,
      GITHUB_TOKEN: FAKE,
      AWS_SECRET_ACCESS_KEY: FAKE,
      DB_PASSWORD: FAKE,
      RANDOM_VAR: "x",
      FASTCLAW_ALLOW_HOST_EXEC: "1",
    });
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/h", FASTCLAW_HOME: "/h/fc" });
    expect(dropped).toContain("DEEPSEEK_API_KEY");
    expect(dropped).toContain("FASTCLAW_ALLOW_HOST_EXEC");
    expect(JSON.stringify(dropped)).not.toContain(FAKE);
  });

  it("forwards a secret only when named in extra", () => {
    const { env } = buildChildEnv({ PATH: "/b", DEEPSEEK_API_KEY: FAKE, OPENAI_API_KEY: FAKE }, { extra: ["DEEPSEEK_API_KEY"] });
    expect(env.DEEPSEEK_API_KEY).toBe(FAKE);
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });

  it("never forwards FASTCLAW_ALLOW_HOST_EXEC, even via extra or set", () => {
    const { env } = buildChildEnv({}, { extra: ["FASTCLAW_ALLOW_HOST_EXEC"], set: { FASTCLAW_ALLOW_HOST_EXEC: "1" } });
    expect(env.FASTCLAW_ALLOW_HOST_EXEC).toBeUndefined();
  });

  it("set overrides source values", () => {
    const { env } = buildChildEnv({ FASTCLAW_PORT: "1" }, { set: { FASTCLAW_PORT: "18983" } });
    expect(env.FASTCLAW_PORT).toBe("18983");
  });

  it("classifies secret-looking names", () => {
    for (const n of ["X_API_KEY", "APIKEY", "SLACK_TOKEN", "CLIENT_SECRET", "PASSWORD", "IP_SALT", "SENTRY_DSN", "DATABASE_URL"]) {
      expect(isSecretEnvName(n)).toBe(true);
    }
    for (const n of ["PATH", "HOME", "FASTCLAW_PORT", "LANG"]) expect(isSecretEnvName(n)).toBe(false);
  });
});

describe("lockPrivateTree", () => {
  it("sets dirs to 700 and files to 600", () => {
    const root = mkdtempSync(join(tmpdir(), "heybe-lock-"));
    try {
      mkdirSync(join(root, "a/b"), { recursive: true, mode: 0o755 });
      writeFileSync(join(root, "a/b/fastclaw.db"), "x", { mode: 0o644 });
      writeFileSync(join(root, "top.json"), "{}", { mode: 0o644 });
      lockPrivateTree(root);
      const mode = (p: string): number => statSync(p).mode & 0o777;
      expect(mode(root)).toBe(0o700);
      expect(mode(join(root, "a/b"))).toBe(0o700);
      expect(mode(join(root, "a/b/fastclaw.db"))).toBe(0o600);
      expect(mode(join(root, "top.json"))).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
