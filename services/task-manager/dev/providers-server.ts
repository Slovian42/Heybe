// Dev-only entry for scripts/dev/providers-mac-check.sh: starts the task-manager
// HTTP server on loopback with /providers/* routes. Prints `PORT=<n>` once ready.
// HEYBE_PROVIDERS_MOCK=1 → in-memory keychain, fake FastClaw/Ollama (box dry run).
import Database from "better-sqlite3";
import { fastClawClientFromEnv } from "@heybe/fastclaw-adapter";
import type { ProviderConfig } from "@heybe/shared-types";
import {
  FastClawCliProvisioner,
  MacKeychainSecretStore,
  MemorySecretStore,
  startTaskHttpServer,
  testProviderConnection,
  type FetchLike,
  type ProbeChat,
  type ProviderProvisioner,
  type SecretStore,
  type TestDeps,
} from "../src/index.js";
import { migrate } from "../src/migrate.js";

const mock = process.env.HEYBE_PROVIDERS_MOCK === "1";
const log = (l: string): void => void process.stderr.write(`[providers] ${l}\n`);

let secrets: SecretStore;
let deps: Omit<TestDeps, "secrets">;
if (mock) {
  secrets = new MemorySecretStore();
  const ctx = Number(process.env.HEYBE_MOCK_OLLAMA_CTX ?? "16384");
  const fetchFn: FetchLike = async (url) => ({
    ok: true,
    status: 200,
    json: async () => (url.endsWith("/api/ps") ? { models: [{ name: process.env.HEYBE_OLLAMA_MODEL ?? "qwen2.5:3b", context_length: ctx }] } : { models: [] }),
  });
  const provisioner: ProviderProvisioner = { provision: async (c) => `agt_mock_${c.id.replace(/-/g, "")}` };
  const chat: ProbeChat = { sendMessage: async () => ({ id: "mock", object: "chat.completion", created: 0, model: "mock", choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }] }) as never };
  deps = { provisioner, chat, fetch: fetchFn, log };
} else {
  secrets = process.env.HEYBE_PROVIDERS_MEMORY_KEYCHAIN === "1" ? new MemorySecretStore() : new MacKeychainSecretStore(process.env.HEYBE_KEYCHAIN_SERVICE ?? "heybe");
  const fetchFn: FetchLike = (url, init) => fetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(5000) });
  deps = {
    provisioner: new FastClawCliProvisioner({ bin: process.env.FASTCLAW_BIN ?? "fastclaw" }),
    chat: fastClawClientFromEnv(process.env, { retry: { maxAttempts: 1 } }) as unknown as ProbeChat,
    fetch: fetchFn,
    timeoutMs: Number(process.env.HEYBE_PROBE_TIMEOUT_MS ?? "60000"),
    log,
  };
}

const db = new Database(":memory:");
migrate(db);
const server = await startTaskHttpServer(db, {
  port: Number(process.env.HEYBE_TM_PORT ?? "0"),
  providers: { secrets, test: (cfg: ProviderConfig) => testProviderConnection(cfg, { ...deps, secrets }) },
});
const addr = server.address();
process.stdout.write(`PORT=${typeof addr === "object" && addr ? addr.port : 0}\n`);
const stop = (): void => {
  server.close();
  process.exit(0);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
