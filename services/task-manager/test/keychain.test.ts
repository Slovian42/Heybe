import { beforeEach, describe, expect, it, vi } from "vitest";

const KEY = "sk-test-SECRET-abcdef1234567890";
const calls: Array<{ file: string; args: string[]; stdin: string }> = [];
let stored: string | undefined;

// Capture the real spawn path of the default runner (no Mac needed).
vi.mock("node:child_process", async (orig) => {
  const actual = await orig<typeof import("node:child_process")>();
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (e: unknown, out: string) => void) => {
      const rec = { file, args: [...args], stdin: "" };
      calls.push(rec);
      return {
        stdin: {
          on: () => undefined,
          end: (data: string) => {
            rec.stdin = data;
            queueMicrotask(() => {
              if (args[0] === "-i") stored = /-w "([^"]*)"/.exec(data)?.[1];
              if (args[0] === "find-generic-password") return stored ? cb(null, `${stored}\n`) : cb(Object.assign(new Error("x"), { code: 44 }), "");
              cb(null, "");
            });
          },
        },
      };
    },
  };
});

const { MacKeychainSecretStore, keychainAddCommand } = await import("../src/provider-secrets.js");

describe("MacKeychainSecretStore spawn arguments", () => {
  beforeEach(() => {
    calls.length = 0;
    stored = undefined;
  });

  it("set/get/status/delete never put the key on argv", async () => {
    const store = new MacKeychainSecretStore();
    await store.set("heybe.provider.deepseek", KEY);
    expect(await store.get("heybe.provider.deepseek")).toBe(KEY);
    expect(await store.status("heybe.provider.deepseek")).toEqual({ set: true, last4: KEY.slice(-4) });
    await store.delete("heybe.provider.deepseek");
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) {
      expect(c.file).toBe("/usr/bin/security");
      expect(c.args.join("\u0000")).not.toContain(KEY);
      expect(c.args.join(" ")).not.toContain("SECRET");
    }
    const write = calls.find((c) => c.args[0] === "-i");
    expect(write?.args).toEqual(["-i"]);
    expect(write?.stdin).toContain(KEY);
  });

  it("write that does not read back is an error without the key in it", async () => {
    const store = new MacKeychainSecretStore("heybe", async () => ({ code: 0, stdout: "" }));
    await expect(store.set("r", KEY)).rejects.toThrow(/钥匙串写入失败/);
    await expect(store.set("r", KEY)).rejects.not.toThrow(new RegExp(KEY));
  });

  it("rejects values that would break security -i quoting", () => {
    for (const bad of ['a"b', "a\\b", "a\nb", "a\tb", ""]) expect(() => keychainAddCommand("heybe", "r", bad)).toThrow();
    expect(() => keychainAddCommand("heybe", "r x", "k")).toThrow();
    expect(keychainAddCommand("heybe", "r", "k-1")).toBe('add-generic-password -U -s "heybe" -a "r" -w "k-1"\n');
  });
});
