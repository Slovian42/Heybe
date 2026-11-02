// BoxLite sandbox for the FastClaw gateway (Refs #6 #7 #12). Opt-in: HEYBE_BOXLITE_BIN=/path/to/boxlite.
//
//   FastClaw gateway --(client key)--> boxlite-proxy (127.0.0.1) --(serve key)--> boxlite serve (127.0.0.1)
//
// - Two random keys per start, kept only in memory (never written to disk, never in argv):
//   * serve key  → `boxlite serve` via env BOXLITE_SERVE_API_KEY (serve answers 401 without it,
//                  except the public GET /v1/config). Only the proxy knows it.
//   * client key → FastClaw via env BOXLITE_API_KEY (an explicit child-env exception); the proxy
//                  checks it and swaps it for the serve key.
// - The proxy forces outbound (and inbound) network disabled on every box FastClaw creates;
//   fc-compat decides only whether auto_remove is stripped.
// - The gateway's sandbox settings come only from here (FASTCLAW_SANDBOX_* and DOCKER_HOST are
//   not inherited from the parent env any more), so Lima/docker can't be switched on by accident.
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, type AddressInfo } from "node:net";

import { probeFcCompat, startBoxliteProxy, type BoxliteProxy, type FcCompatVerdict } from "./boxlite-proxy.js";
import { buildChildEnv, type ChildEnvOptions } from "./child-env.js";
import { LOOPBACK_HOST } from "./constants.js";

/** BoxLite ≥0.10 REST prefix (serve has no tenant segment). FastClaw builds {URL}/{PREFIX}/boxes. */
export const BOXLITE_PREFIX = "v1";

export type SandboxErrorCode = "E_BOXLITE_EXITED" | "E_BOXLITE_READY_TIMEOUT" | "E_BOXLITE_NO_AUTH" | "E_BOXLITE_COMPAT";

export class SandboxError extends Error {
  readonly code: SandboxErrorCode;
  constructor(code: SandboxErrorCode, message: string) {
    super(message);
    this.name = "SandboxError";
    this.code = code;
  }
}

/** 256-bit random key, base64url (no characters that need quoting in headers). */
export function generateKey(): string {
  return randomBytes(32).toString("base64url");
}

export function boxliteServeArgs(port: number): string[] {
  return ["serve", "--host", LOOPBACK_HOST, "--port", String(port)];
}

/**
 * Child-env options that turn the BoxLite sandbox on for the gateway. All names are listed in
 * `extra` (the generic allowlist no longer carries any FASTCLAW_SANDBOX_* name), and
 * BOXLITE_API_KEY is the one secret-looking name allowed through.
 */
export function sandboxGatewayEnv(proxyUrl: string, clientKey: string): ChildEnvOptions {
  const set: Record<string, string> = {
    FASTCLAW_SANDBOX_ENABLED: "1",
    FASTCLAW_SANDBOX_ENFORCE: "1",
    FASTCLAW_SANDBOX_BACKEND: "boxlite",
    FASTCLAW_SANDBOX_BOXLITE_URL: proxyUrl,
    FASTCLAW_SANDBOX_BOXLITE_PREFIX: BOXLITE_PREFIX,
    BOXLITE_API_KEY: clientKey,
  };
  return { extra: Object.keys(set), set };
}

export function freeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, LOOPBACK_HOST, () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

export interface SandboxOptions {
  /** Path to the `boxlite` binary (HEYBE_BOXLITE_BIN). */
  bin: string;
  /** Parent env; filtered through buildChildEnv before it reaches `boxlite serve`. */
  env?: Record<string, string | undefined>;
  /** serve port on 127.0.0.1 (default: a free port). */
  servePort?: number;
  readyTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
  /** Injectable for tests. */
  spawnImpl?: typeof spawn;
}

export interface SandboxHandle {
  /** Pass to startGateway({ childEnv }). Holds the client key; never log it. */
  gatewayEnv: ChildEnvOptions;
  proxyUrl: string;
  serveUrl: string;
  compat: FcCompatVerdict;
  /** Resolves when `boxlite serve` exits. */
  exited: Promise<number | null>;
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function startSandbox(opts: SandboxOptions): Promise<SandboxHandle> {
  const doFetch = opts.fetchImpl ?? fetch;
  const log = opts.log ?? ((l: string) => process.stderr.write(`heybe-sandbox: ${l}\n`));
  const serveKey = generateKey();
  const clientKey = generateKey();
  const port = opts.servePort ?? (await freeLoopbackPort());
  const serveUrl = `http://${LOOPBACK_HOST}:${port}`;

  // The serve key goes in through the environment only (BoxLite reads BOXLITE_SERVE_API_KEY).
  const { env } = buildChildEnv(opts.env ?? process.env, {
    extra: ["BOXLITE_SERVE_API_KEY", "BOXLITE_HOME"],
    set: { BOXLITE_SERVE_API_KEY: serveKey },
  });
  const child: ChildProcess = (opts.spawnImpl ?? spawn)(opts.bin, boxliteServeArgs(port), {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let tail = "";
  child.stderr?.on("data", (d: Buffer) => {
    tail = (tail + d.toString()).slice(-4096);
  });
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
  let proxy: BoxliteProxy | undefined;
  const stop = async (graceMs = 3000): Promise<void> => {
    await proxy?.close();
    proxy = undefined;
    if (done) return;
    child.kill("SIGTERM");
    const ok = await Promise.race([exited.then(() => true), sleep(graceMs).then(() => false)]);
    if (!ok && !done) {
      child.kill("SIGKILL");
      await exited;
    }
  };
  const lastLine = () => tail.trim().split("\n").slice(-1)[0] ?? "";

  try {
    // 1) Ready = GET /v1/config 200 (public route) while our child is alive.
    const deadline = Date.now() + (opts.readyTimeoutMs ?? 20_000);
    for (;;) {
      if (done) throw new SandboxError("E_BOXLITE_EXITED", `boxlite serve 启动时退出了：${lastLine() || "没有输出"}`);
      try {
        const r = await doFetch(`${serveUrl}/v1/config`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) break;
      } catch {
        // not up yet
      }
      if (Date.now() >= deadline) throw new SandboxError("E_BOXLITE_READY_TIMEOUT", `boxlite serve 没有在 ${serveUrl} 就绪`);
      await sleep(200);
    }
    // 2) The key must be enforced: without it, serve must answer 401 (else anyone local could create boxes).
    const anon = await doFetch(`${serveUrl}/${BOXLITE_PREFIX}/boxes`, { signal: AbortSignal.timeout(5000) });
    await anon.body?.cancel();
    if (anon.status !== 401) {
      throw new SandboxError("E_BOXLITE_NO_AUTH", `boxlite serve 不带 key 的请求返回 ${anon.status}（应为 401），拒绝使用`);
    }
    // 3) fc-compat decides only auto_remove; the network override is unconditional.
    const compat = await probeFcCompat(`${serveUrl}/${BOXLITE_PREFIX}/boxes`, serveKey, doFetch);
    if (compat === "unknown") throw new SandboxError("E_BOXLITE_COMPAT", "无法判定 FastClaw 建箱请求体与 BoxLite 是否兼容");
    proxy = await startBoxliteProxy({
      upstream: serveUrl,
      upstreamKey: serveKey,
      clientKey,
      stripAutoRemove: compat === "reject_auto_remove",
      log,
    });
    return {
      gatewayEnv: sandboxGatewayEnv(proxy.url, clientKey),
      proxyUrl: proxy.url,
      serveUrl,
      compat,
      exited,
      stop,
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
