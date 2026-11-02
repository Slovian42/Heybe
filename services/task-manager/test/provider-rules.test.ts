import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  DuplicateProviderError,
  PROVIDER_PRESETS,
  RESERVED_PROVIDER_NAMES,
  fastclawProviderName,
  providerKeyRef,
  upsertProviderConfig,
  validateProviderConfig,
  validateProviderSet,
  type ProviderConfig,
} from "@heybe/shared-types";
import { FastClawCliProvisioner, PROVIDER_KEY_ENV, initArgs } from "../src/index.js";

// Fake test value, not a real key.
const KEY = "sk-test-SECRET-rules-0123456789abcd";

const deepseek: ProviderConfig = { id: "deepseek", kind: "deepseek", baseUrl: PROVIDER_PRESETS.deepseek.baseUrl, model: "deepseek-chat", keyRef: "heybe.provider.deepseek" };
const relay = (id: string): ProviderConfig => ({ id, kind: "openai_compatible", baseUrl: `https://${id}.example.com/v1`, model: "m-1", keyRef: `heybe.provider.${id}` });

describe("rule 1 (2026-11-02): one key per provider", () => {
  it("preset kinds map to the FastClaw provider name; openai_compatible to its config id", () => {
    expect(fastclawProviderName(deepseek)).toBe("deepseek");
    expect(fastclawProviderName({ id: "deepseek-work", kind: "deepseek" })).toBe("deepseek");
    expect(fastclawProviderName(relay("my-relay"))).toBe("my-relay");
    expect(providerKeyRef({ id: "deepseek-work", kind: "deepseek" })).toBe("heybe.provider.deepseek");
    expect(providerKeyRef(relay("my-relay"))).toBe("heybe.provider.my-relay");
  });

  it("second config of the same preset kind is rejected with a clear message", () => {
    const second = { ...deepseek, id: "deepseek-work", keyRef: "heybe.provider.deepseek-work" };
    expect(() => upsertProviderConfig([deepseek], second)).toThrow(DuplicateProviderError);
    try {
      upsertProviderConfig([deepseek], second);
    } catch (e) {
      expect((e as DuplicateProviderError).existingId).toBe("deepseek");
      expect((e as Error).message).toContain("每种提供方只能配一个密钥");
      expect((e as Error).message).toContain("全局共享");
    }
    expect(validateProviderSet([deepseek, second]).join()).toContain("已经配置过 deepseek");
  });

  it("same id → overwrite (update in place), list not mutated", () => {
    const list = [deepseek, relay("a")];
    const updated = upsertProviderConfig(list, { ...deepseek, model: "deepseek-reasoner" });
    expect(updated).toHaveLength(2);
    expect(updated[0]?.model).toBe("deepseek-reasoner");
    expect(list[0]?.model).toBe("deepseek-chat");
  });

  it("several openai_compatible configs are allowed (named by config id)", () => {
    let list: ProviderConfig[] = [deepseek];
    list = upsertProviderConfig(list, relay("relay-a"));
    list = upsertProviderConfig(list, relay("relay-b"));
    expect(list.map((c) => c.id)).toEqual(["deepseek", "relay-a", "relay-b"]);
    expect(validateProviderSet(list)).toEqual([]);
  });

  it("openai_compatible may not take a preset's provider name (would overwrite it)", () => {
    for (const name of RESERVED_PROVIDER_NAMES) {
      expect(validateProviderConfig(relay(name)).join()).toContain("内置提供方");
      expect(() => upsertProviderConfig([], relay(name))).toThrow(/内置提供方/);
      expect(validateProviderSet([relay(name)]).length).toBeGreaterThan(0);
    }
    expect(() => upsertProviderConfig([deepseek], relay("deepseek"))).toThrow(/内置提供方/);
  });

  it("duplicate ids in a set are reported", () => {
    expect(validateProviderSet([relay("x"), relay("x")]).join()).toContain("重复");
  });
});

describe("rule 2 (2026-11-02): `fastclaw agents init` gets the key only via child env", () => {
  const dir = mkdtempSync(join(tmpdir(), "heybe-fc-argv-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("initArgs never contains the key, only the env var name", () => {
    for (const cfg of [deepseek, relay("my-relay")]) {
      const args = initArgs(cfg, true);
      expect(args.join("\u0000")).not.toContain(KEY);
      expect(args).toEqual(expect.arrayContaining(["--api-key-env", PROVIDER_KEY_ENV]));
      expect(args.some((a) => a.startsWith("--api-key") && a !== "--api-key-env")).toBe(false);
    }
  });

  it("real spawn: key absent from the child's argv (as ps would see it), present in its env, absent from errors", async () => {
    // Fake `fastclaw`: records its argv (and /proc cmdline on Linux) and the env var.
    const bin = join(dir, "fastclaw");
    writeFileSync(
      bin,
      `#!/bin/sh
printf '%s\\n' "$0" "$@" > "${dir}/argv.txt"
[ -r /proc/$$/cmdline ] && tr '\\0' '\\n' < /proc/$$/cmdline > "${dir}/cmdline.txt"
printf '%s' "$${PROVIDER_KEY_ENV}" > "${dir}/env.txt"
echo "Created user \\"admin\\" with password: hunter2hunter2"
if [ "$FAKE_FAIL" = 1 ]; then echo "boom" >&2; exit 3; fi
echo "Agent ID: agt_spawned1"
`,
    );
    chmodSync(bin, 0o755);
    const p = new FastClawCliProvisioner({ bin, env: { PATH: process.env.PATH ?? "/usr/bin:/bin", DEEPSEEK_API_KEY: "should-not-be-forwarded" } });
    expect(await p.provision(deepseek, KEY)).toBe("agt_spawned1");

    const argv = readFileSync(join(dir, "argv.txt"), "utf8");
    expect(argv).toContain("agents\ninit\n");
    expect(argv).not.toContain(KEY);
    if (process.platform === "linux") expect(readFileSync(join(dir, "cmdline.txt"), "utf8")).not.toContain(KEY);
    expect(readFileSync(join(dir, "env.txt"), "utf8")).toBe(KEY);

    // Failure path: error message carries neither key nor CLI output.
    // FAKE_FAIL is not on the child-env allowlist, so set it in a wrapper script.
    const wrap = join(dir, "fastclaw-fail");
    writeFileSync(wrap, `#!/bin/sh\nFAKE_FAIL=1 exec "${bin}" "$@"\n`);
    chmodSync(wrap, 0o755);
    const f = new FastClawCliProvisioner({ bin: wrap, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } });
    const err = await f.provision(deepseek, KEY).then(() => undefined, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).not.toContain(KEY);
    expect(err?.message).not.toContain("hunter2");
  });
});
