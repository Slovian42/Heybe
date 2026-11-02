// 19-b: the Heybe service owns the FastClaw gateway process. When the service stops
// (Tauri quit / SIGTERM / parent gone) the gateway is stopped too, so nothing is left behind.
import { spawn, type ChildProcess } from "node:child_process";

import { buildChildEnv } from "./child-env.js";

export interface GatewayOptions {
  /** Path to the `fastclaw` binary (HEYBE_FASTCLAW_GATEWAY_BIN). */
  bin: string;
  /** Health URL, e.g. http://127.0.0.1:18963/healthz. */
  healthUrl: string;
  env?: Record<string, string | undefined>;
  readyTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GatewayHandle {
  child: ChildProcess;
  /** Resolves when the gateway exits (code or signal). */
  exited: Promise<number | null>;
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  // Whitelisted env only: no model/provider keys, no HEYBE_* tokens (child-env.ts rules).
  const { env } = buildChildEnv(opts.env ?? process.env);
  const child = spawn(opts.bin, [], { env, stdio: ["ignore", "ignore", "inherit"] });
  let done = false;
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      done = true;
      resolve(code);
    });
    child.once("error", () => {
      done = true;
      resolve(null);
    });
  });

  const stop = async (graceMs = 3000): Promise<void> => {
    if (done) return;
    child.kill("SIGTERM");
    const killed = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
    if (!killed && !done) {
      child.kill("SIGKILL");
      await exited;
    }
  };

  const doFetch = opts.fetchImpl ?? fetch;
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (done) throw new Error("FastClaw gateway exited during startup");
    try {
      const res = await doFetch(opts.healthUrl, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { child, exited, stop };
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  await stop();
  throw new Error("FastClaw gateway did not become healthy in time");
}
