// camoufox-cli is turned off through the second approved CLI exception (docs/architecture.md §3.10):
// `fastclaw agents config <agent> get|set skills.entries.camoufox-cli.enabled [false]`.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMOUFOX_ENABLED_KEY,
  ERROR_PREFIX,
  FastClawCliProvisioner,
  MemorySecretStore,
  READY_PREFIX,
  SkillGuardError,
  camoufoxGetArgs,
  camoufoxSetArgs,
  ensureCamoufoxDisabled,
  ensureSkillsAtStartup,
  startHeybeService,
  testProviderConnection,
  type CliRunner,
} from "../src/index.js";

const FAKE_GW = new URL("./fixtures/fake-gateway.mjs", import.meta.url).pathname;
const MAIN = new URL("../src/main.ts", import.meta.url).pathname;
const TSX = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
// Fake test values, not real keys.
const SECRET = "sk-test-SECRET-skills-0123456789abcd";
const TOKEN = "t".repeat(40);

/** Parent env full of secret-looking values: none may reach the child (argv or env). */
const dirtyEnv = (home: string) => ({
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  FASTCLAW_HOME: home,
  DEEPSEEK_API_KEY: SECRET,
  HEYBE_PROVIDER_KEY: SECRET,
  HEYBE_FASTCLAW_CHAT_TOKEN: SECRET,
  BOXLITE_API_KEY: SECRET,
});

function fakeHome(knobs: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "heybe-fcskills-"));
  writeFileSync(join(dir, "fake.json"), JSON.stringify(knobs));
  return dir;
}
const calls = (home: string): Array<{ argv: string[]; envNames: string[] }> =>
  existsSync(join(home, "config-calls.jsonl"))
    ? readFileSync(join(home, "config-calls.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l))
    : [];
const freePort = () =>
  new Promise<number>((resolve) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });

describe("argv builders", () => {
  it("only the fixed words, the agent id and the literal false", () => {
    expect(camoufoxGetArgs("agt_a1")).toEqual(["agents", "config", "agt_a1", "get", "skills.entries.camoufox-cli.enabled"]);
    expect(camoufoxSetArgs("agt_a1")).toEqual(["agents", "config", "agt_a1", "set", "skills.entries.camoufox-cli.enabled", "false"]);
    expect(CAMOUFOX_ENABLED_KEY).toBe("skills.entries.camoufox-cli.enabled");
  });
});

describe("ensureCamoufoxDisabled (mock runner)", () => {
  const runner = (replies: Record<string, Array<{ code: number; stdout: string }>>) => {
    const seen: string[] = [];
    const run: CliRunner = async (args) => {
      seen.push(`${args[3]}`);
      const r = replies[args[3]!]!.shift()!;
      return { ...r, stderr: "" };
    };
    return { run, seen };
  };

  it("not yet off → set false, read back false → disabled", async () => {
    const { run, seen } = runner({ get: [{ code: 0, stdout: "null\n" }, { code: 0, stdout: "false\n" }], set: [{ code: 0, stdout: "Set x\n" }] });
    await expect(ensureCamoufoxDisabled("agt_a1", { run, env: {} })).resolves.toBe("disabled");
    expect(seen).toEqual(["get", "set", "get"]);
  });

  it("idempotent: already false → no write", async () => {
    const { run, seen } = runner({ get: [{ code: 0, stdout: " false \n" }], set: [] });
    await expect(ensureCamoufoxDisabled("agt_a1", { run, env: {} })).resolves.toBe("already_disabled");
    expect(seen).toEqual(["get"]);
  });

  it("set fails → E_FC_SKILL_DISABLE_FAILED", async () => {
    const { run } = runner({ get: [{ code: 0, stdout: "true\n" }], set: [{ code: 1, stdout: "" }] });
    const err = await ensureCamoufoxDisabled("agt_a1", { run, env: {} }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SkillGuardError);
    expect((err as SkillGuardError).code).toBe("E_FC_SKILL_DISABLE_FAILED");
    expect((err as Error).message).toContain("camoufox-cli");
    expect((err as Error).message).toContain("set 退出码 1");
  });

  it("read-back not false (true / null / get error) → E_FC_SKILL_DISABLE_FAILED", async () => {
    for (const after of [{ code: 0, stdout: "true\n" }, { code: 0, stdout: "null\n" }, { code: 2, stdout: "" }]) {
      const { run } = runner({ get: [{ code: 0, stdout: "null\n" }, after], set: [{ code: 0, stdout: "Set x\n" }] });
      const err = await ensureCamoufoxDisabled("agt_a1", { run, env: {} }).catch((e: unknown) => e);
      expect((err as SkillGuardError).code).toBe("E_FC_SKILL_DISABLE_FAILED");
    }
  });

  it("odd agent refs never reach argv", async () => {
    const { run, seen } = runner({});
    for (const bad of ["", "--help", "a b", "agt_1;rm"]) {
      await expect(ensureCamoufoxDisabled(bad, { run, env: {} })).rejects.toBeInstanceOf(SkillGuardError);
    }
    expect(seen).toEqual([]);
  });
});

describe("ensureCamoufoxDisabled (real spawn, mock fastclaw binary)", () => {
  it("success: state ends false; no secret in argv or child env", async () => {
    const home = fakeHome();
    await expect(ensureCamoufoxDisabled("agt_real1", { bin: FAKE_GW, env: dirtyEnv(home) })).resolves.toBe("disabled");
    expect(JSON.parse(readFileSync(join(home, "config.json"), "utf8"))).toEqual({ [CAMOUFOX_ENABLED_KEY]: false });
    const c = calls(home);
    expect(c.map((x) => x.argv[3])).toEqual(["get", "set", "get"]);
    const all = JSON.stringify(c);
    expect(all).not.toContain(SECRET);
    for (const x of c) {
      for (const n of ["DEEPSEEK_API_KEY", "HEYBE_PROVIDER_KEY", "HEYBE_FASTCLAW_CHAT_TOKEN", "BOXLITE_API_KEY"]) expect(x.envNames).not.toContain(n);
      expect(x.envNames).toContain("FASTCLAW_HOME");
    }
    // second run (next startup): read only
    await expect(ensureCamoufoxDisabled("agt_real1", { bin: FAKE_GW, env: dirtyEnv(home) })).resolves.toBe("already_disabled");
    expect(calls(home)).toHaveLength(4);
  });

  it("set fails → E_FC_SKILL_DISABLE_FAILED, message carries no CLI output", async () => {
    const home = fakeHome({ configSetExit: 4 });
    const err = (await ensureCamoufoxDisabled("agt_real1", { bin: FAKE_GW, env: dirtyEnv(home) }).catch((e: unknown) => e)) as SkillGuardError;
    expect(err.code).toBe("E_FC_SKILL_DISABLE_FAILED");
    expect(err.message).toContain("退出码 4");
    expect(err.message).not.toContain("database is locked");
  });

  it("read-back not false → E_FC_SKILL_DISABLE_FAILED", async () => {
    const home = fakeHome({ configReadback: "true" });
    const err = (await ensureCamoufoxDisabled("agt_real1", { bin: FAKE_GW, env: dirtyEnv(home) }).catch((e: unknown) => e)) as SkillGuardError;
    expect(err.code).toBe("E_FC_SKILL_DISABLE_FAILED");
    expect(err.message).toContain("读回 true");
  });

  it("unknown agent → E_FC_SKILL_DISABLE_FAILED", async () => {
    const home = fakeHome({ configAgents: ["agt_other"] });
    await expect(ensureCamoufoxDisabled("agt_real1", { bin: FAKE_GW, env: dirtyEnv(home) })).rejects.toBeInstanceOf(SkillGuardError);
  });
});

describe("provision path: new agent gets camoufox-cli off", () => {
  it("testProviderConnection maps a failed check to skill_disable_failed (Chinese, code in detail)", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("heybe.provider.deepseek", SECRET);
    let chatted = false;
    const run: CliRunner = async (args) =>
      args[1] === "init"
        ? { code: 0, stdout: "Agent ID: agt_new1\n", stderr: "" }
        : args[3] === "set"
          ? { code: 1, stdout: "", stderr: "boom" }
          : { code: 0, stdout: "true\n", stderr: "" };
    const logs: string[] = [];
    const res = await testProviderConnection(
      { id: "deepseek", kind: "deepseek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat", keyRef: "heybe.provider.deepseek" },
      {
        secrets,
        chat: { sendMessage: async () => ((chatted = true), {}) as never },
        provisioner: new FastClawCliProvisioner({ run, env: {} }),
        log: (l) => logs.push(l),
      },
    );
    expect(res).toMatchObject({ status: "failed", code: "skill_disable_failed", detail: { code: "E_FC_SKILL_DISABLE_FAILED" } });
    expect(res.message).toMatch(/camoufox-cli/);
    expect(chatted).toBe(false);
    expect(JSON.stringify(res) + logs.join("\n")).not.toContain(SECRET);
  });
});

describe("startup check (every start)", () => {
  it("uses HEYBE_FASTCLAW_AGENT_ID, logs the read-back line", async () => {
    const home = fakeHome();
    const logs: string[] = [];
    await ensureSkillsAtStartup({ bin: FAKE_GW, env: { ...dirtyEnv(home), HEYBE_FASTCLAW_AGENT_ID: "agt_env1" }, log: (l) => logs.push(l) });
    expect(logs).toEqual(["heybe-service: camoufox-cli 技能已关闭（读回 skills.entries.camoufox-cli.enabled=false，agent agt_env1）"]);
    await ensureSkillsAtStartup({ bin: FAKE_GW, env: { ...dirtyEnv(home), HEYBE_FASTCLAW_AGENT_ID: "agt_env1" }, log: (l) => logs.push(l) });
    expect(logs[1]).toContain("已是关闭状态");
  });

  it("falls back to the first /v1 agent; none yet → skip with a log line", async () => {
    const home = fakeHome();
    const logs: string[] = [];
    await ensureSkillsAtStartup({ bin: FAKE_GW, env: dirtyEnv(home), firstAgent: async () => "agt_first", log: (l) => logs.push(l) });
    expect(logs[0]).toContain("agent agt_first");
    await ensureSkillsAtStartup({ bin: FAKE_GW, env: dirtyEnv(home), firstAgent: async () => undefined, log: (l) => logs.push(l) });
    expect(logs[1]).toContain("检查跳过");
    await expect(
      ensureSkillsAtStartup({ bin: FAKE_GW, env: dirtyEnv(home), firstAgent: async () => Promise.reject(new Error("x")), log: () => {} }),
    ).rejects.toBeInstanceOf(SkillGuardError);
  });

  it("service fails closed: check fails → E_FC_SKILL_DISABLE_FAILED and the gateway is stopped", async () => {
    let stopped = false;
    const err = await startHeybeService(
      { HEYBE_SERVICE_TOKEN: TOKEN, HEYBE_FASTCLAW_GATEWAY_BIN: "fastclaw", PATH: process.env.PATH },
      {
        startGateway: async () => ({ exited: new Promise(() => {}), stop: async () => void (stopped = true) }) as never,
        ensureSkills: async () => {
          throw new SkillGuardError("读回 true");
        },
      },
    ).catch((e: unknown) => e);
    expect((err as SkillGuardError).code).toBe("E_FC_SKILL_DISABLE_FAILED");
    expect(stopped).toBe(true);
  });

  it("main.ts with the fake binary: success logs the line; read-back wrong → HEYBE_SERVICE_ERROR, exit 3", async () => {
    const runMain = async (knobs: Record<string, unknown>) => {
      const home = fakeHome(knobs);
      const child = spawn(TSX, [MAIN], {
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          HEYBE_SERVICE_TOKEN: TOKEN,
          HEYBE_FASTCLAW_GATEWAY_BIN: FAKE_GW,
          FASTCLAW_PORT: String(await freePort()),
          FASTCLAW_HOME: home,
          HEYBE_FASTCLAW_AGENT_ID: "agt_main1",
          DEEPSEEK_API_KEY: SECRET,
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (err += d.toString()));
      const result = await new Promise<number | null | "ready">((resolve) => {
        child.stdout.on("data", () => out.includes(READY_PREFIX) && resolve("ready"));
        child.once("exit", resolve);
      });
      if (result === "ready") {
        const exited = new Promise((r) => child.once("exit", r));
        child.kill("SIGTERM");
        await exited;
      }
      return { result, out, err, home };
    };

    const ok = await runMain({});
    expect(ok.result).toBe("ready");
    expect(ok.err).toContain("camoufox-cli 技能已关闭（读回 skills.entries.camoufox-cli.enabled=false，agent agt_main1）");
    expect(JSON.stringify(calls(ok.home))).not.toContain(SECRET);

    const bad = await runMain({ configReadback: "true" });
    expect(bad.result).toBe(3);
    const line = bad.out.split("\n").find((l) => l.startsWith(ERROR_PREFIX));
    const body = JSON.parse(line!.slice(ERROR_PREFIX.length)) as { code: string; retryable: boolean; message: string };
    expect(body).toMatchObject({ code: "E_FC_SKILL_DISABLE_FAILED", retryable: false });
    expect(body.message).toContain("camoufox-cli");
    expect(bad.out + bad.err).not.toContain(SECRET);
  }, 30_000);
});
