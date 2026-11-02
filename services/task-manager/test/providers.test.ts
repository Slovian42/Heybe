import { describe, expect, it } from "vitest";
import { FastClawError } from "@heybe/fastclaw-adapter";
import { PROVIDER_PRESETS, validateProviderConfig, DEFAULT_PROVIDER, type ProviderConfig, type ProviderKind } from "@heybe/shared-types";
import {
  FastClawCliProvisioner,
  MacKeychainSecretStore,
  MemorySecretStore,
  PROVIDER_KEY_ENV,
  classifyProviderError,
  initArgs,
  testProviderConnection,
  type CliRunner,
  type FetchLike,
  type ProbeChat,
} from "../src/index.js";

const KEY = "sk-test-SECRET-abcdef1234567890";

function cfgFor(kind: ProviderKind): ProviderConfig {
  const p = PROVIDER_PRESETS[kind];
  if (kind === "openai_compatible") return { id: "my-relay", kind, baseUrl: "https://relay.example.com/v1", model: "m-1", keyRef: "heybe.provider.my-relay" };
  return { id: kind, kind, baseUrl: p.baseUrl, model: p.defaultModel, ...(p.needsKey ? { keyRef: `heybe.provider.${kind}` } : {}) };
}

/** FastClaw v1.4.0 shape for relayed upstream errors (observed 2026-11-02). */
function upstream(status: number, body: string): FastClawError {
  return new FastClawError({ kind: "5xx", status: 502, code: "agent_error", errorType: "server_error", method: "POST", path: "/v1/chat/completions", message: `API error ${status}: ${body}` });
}

const scenarios: Array<[string, () => Promise<unknown>, string]> = [
  ["success", async () => ({ choices: [{ message: { role: "assistant", content: "OK" } }] }), "ok"],
  ["401", async () => { throw upstream(401, `{"error":{"message":"Authentication Fails, Your api key: ${KEY} is invalid","type":"authentication_error"}}`); }, "key_invalid"],
  ["404 model", async () => { throw upstream(404, `{"error":{"message":"The model 'x' does not exist"}}`); }, "model_not_found"],
  ["429", async () => { throw upstream(429, `{"error":{"message":"rate limit"}}`); }, "rate_limited"],
  ["timeout", async () => { throw new FastClawError({ kind: "timeout", method: "POST", path: "/v1/chat/completions", message: "timed out" }); }, "timeout"],
];

async function run(kind: ProviderKind, reply: () => Promise<unknown>) {
  const secrets = new MemorySecretStore();
  const cfg = cfgFor(kind);
  if (cfg.keyRef) await secrets.set(cfg.keyRef, KEY);
  const logs: string[] = [];
  const provisioned: Array<string | undefined> = [];
  const chat: ProbeChat = { sendMessage: reply as ProbeChat["sendMessage"] };
  const res = await testProviderConnection(cfg, {
    secrets,
    chat,
    provisioner: { provision: async (_c, k) => (provisioned.push(k), "agt_probe1") },
    log: (l) => logs.push(l),
  });
  return { res, logs, provisioned };
}

describe("testProviderConnection (mock, per provider)", () => {
  for (const kind of ["deepseek", "openai", "anthropic", "openrouter", "openai_compatible"] as const) {
    for (const [name, reply, code] of scenarios) {
      it(`${kind}: ${name} → ${code}`, async () => {
        const { res, logs, provisioned } = await run(kind, reply);
        expect(res.code).toBe(code);
        expect(res.status).toBe(code === "ok" ? "ok" : "failed");
        expect(provisioned).toEqual([KEY]);
        const all = JSON.stringify(res) + logs.join("\n");
        expect(all).not.toContain(KEY);
        expect(all).not.toContain("SECRET");
        if (code !== "ok") expect(res.message).toMatch(/[\u4e00-\u9fff]/);
      });
    }
  }

  it("key missing → key_missing, no provisioning", async () => {
    let called = false;
    const res = await testProviderConnection(cfgFor("openai"), {
      secrets: new MemorySecretStore(),
      chat: { sendMessage: async () => ({}) as never },
      provisioner: { provision: async () => ((called = true), "x") },
    });
    expect(res.code).toBe("key_missing");
    expect(called).toBe(false);
  });

  it("invalid config → config_invalid", async () => {
    const res = await testProviderConnection({ ...cfgFor("openai"), baseUrl: "ftp://x" }, {
      secrets: new MemorySecretStore(),
      chat: { sendMessage: async () => ({}) as never },
      provisioner: { provision: async () => "x" },
    });
    expect(res.code).toBe("config_invalid");
  });

  it("provision failure → fastclaw_error, key redacted in log", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("heybe.provider.deepseek", KEY);
    const logs: string[] = [];
    const res = await testProviderConnection(cfgFor("deepseek"), {
      secrets,
      chat: { sendMessage: async () => ({}) as never },
      provisioner: { provision: async () => { throw new Error(`boom ${KEY}`); } },
      log: (l) => logs.push(l),
    });
    expect(res.code).toBe("fastclaw_error");
    expect(logs.join()).not.toContain(KEY);
  });
});

describe("ollama", () => {
  const okReply = async () => ({ choices: [{ message: { role: "assistant", content: "OK" } }] });
  const fetchWith = (ctx: number | null, up = true): FetchLike => async (url) => {
    if (!up) throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
    if (url.endsWith("/api/tags")) return { ok: true, status: 200, json: async () => ({ models: [] }) };
    if (url.endsWith("/api/ps")) return { ok: true, status: 200, json: async () => ({ models: ctx ? [{ name: "qwen2.5:3b", context_length: ctx }] : [] }) };
    return { ok: true, status: 200, json: async () => ({ parameters: "" }) };
  };
  const deps = (f: FetchLike) => ({ secrets: new MemorySecretStore(), chat: { sendMessage: okReply } as unknown as ProbeChat, provisioner: { provision: async () => "agt_o" }, fetch: f });

  it("not running", async () => {
    expect((await testProviderConnection(cfgFor("ollama"), deps(fetchWith(null, false)))).code).toBe("ollama_not_running");
  });
  it("ctx 4096 → warning", async () => {
    const r = await testProviderConnection(cfgFor("ollama"), deps(fetchWith(4096)));
    expect(r.status).toBe("warning");
    expect(r.code).toBe("context_too_small");
  });
  it("ctx 16384 → ok", async () => {
    expect((await testProviderConnection(cfgFor("ollama"), deps(fetchWith(16384)))).code).toBe("ok");
  });
});

describe("classifyProviderError", () => {
  it("FastClaw's own 401 is fastclaw_error, not key_invalid", () => {
    const e = new FastClawError({ kind: "4xx", status: 401, method: "POST", path: "/v1/chat/completions", message: "invalid api key" });
    expect(classifyProviderError(e, "deepseek").code).toBe("fastclaw_error");
  });
  it("network to FastClaw → fastclaw_error; DNS text → network_unreachable", () => {
    expect(classifyProviderError(new FastClawError({ kind: "network", method: "POST", path: "/v1/x", message: "fetch failed" }), "openai").code).toBe("fastclaw_error");
    const dns = new FastClawError({ kind: "5xx", status: 502, method: "POST", path: "/v1/x", message: "dial tcp: lookup x: no such host" });
    expect(classifyProviderError(dns, "openai").code).toBe("network_unreachable");
  });
  it("unknown upstream status → provider_error mentions interface change", () => {
    const c = classifyProviderError(upstream(500, "{}"), "anthropic");
    expect(c.code).toBe("provider_error");
    expect(c.message).toContain("接口有变化");
    expect(c.detail?.status).toBe(500);
  });
});

describe("FastClawCliProvisioner", () => {
  it("key only in child env, never argv; keeps only Agent ID from stdout", async () => {
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const runner: CliRunner = async (args, env) => {
      calls.push({ args, env });
      return { code: 0, stdout: "Admin password: hunter2hunter2\nAgent ID: agt_abc123\n", stderr: "" };
    };
    const p = new FastClawCliProvisioner({ run: runner, env: { PATH: "/bin", DEEPSEEK_API_KEY: "leak-me-please" } });
    expect(await p.provision(cfgFor("deepseek"), KEY)).toBe("agt_abc123");
    expect(calls[0].args.join(" ")).not.toContain(KEY);
    expect(calls[0].args).toContain(PROVIDER_KEY_ENV);
    expect(calls[0].env[PROVIDER_KEY_ENV]).toBe(KEY);
    expect(calls[0].env.DEEPSEEK_API_KEY).toBeUndefined();
  });
  it("existing agent → retry with --id", async () => {
    const seen: string[][] = [];
    const runner: CliRunner = async (args) => {
      seen.push(args);
      return seen.length === 1
        ? { code: 1, stdout: "", stderr: 'agent "heybe-probe-openai" already exists (id agt_old9), pass --id' }
        : { code: 0, stdout: "Agent ID: agt_old9\n", stderr: "" };
    };
    expect(await new FastClawCliProvisioner({ run: runner, env: {} }).provision(cfgFor("openai"), KEY)).toBe("agt_old9");
    expect(seen[1]).toContain("--id");
  });
  it("openai_compatible uses config id as provider; ollama has no key flag", () => {
    expect(initArgs(cfgFor("openai_compatible"), true)).toEqual(expect.arrayContaining(["--provider", "my-relay", "--api-base", "https://relay.example.com/v1"]));
    expect(initArgs(cfgFor("ollama"), false)).not.toContain("--api-key-env");
  });
});

describe("MacKeychainSecretStore (mocked security)", () => {
  it("status exposes only last4", async () => {
    const store = new MacKeychainSecretStore("heybe", async (args) => (args[0] === "find-generic-password" ? { code: 0, stdout: `${KEY}\n` } : { code: 0, stdout: "" }));
    expect(await store.status("r")).toEqual({ set: true, last4: KEY.slice(-4) });
  });
  it("missing entry → not set", async () => {
    const store = new MacKeychainSecretStore("heybe", async () => ({ code: 44, stdout: "" }));
    expect(await store.status("r")).toEqual({ set: false });
  });
});

describe("shared-types providers", () => {
  it("default preset is valid DeepSeek", () => {
    expect(DEFAULT_PROVIDER.kind).toBe("deepseek");
    expect(validateProviderConfig(DEFAULT_PROVIDER)).toEqual([]);
  });
});
