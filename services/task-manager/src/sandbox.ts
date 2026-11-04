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
import { runSandboxSelfcheck, type SelfcheckResult } from "./sandbox-selfcheck.js";
import { buildChildEnv, type ChildEnvOptions } from "./child-env.js";
import { LOOPBACK_HOST } from "./constants.js";

/** BoxLite ≥0.10 REST prefix (serve has no tenant segment). FastClaw builds {URL}/{PREFIX}/boxes. */
export const BOXLITE_PREFIX = "v1";

export type SandboxErrorCode = "E_BOXLITE_EXITED" | "E_BOXLITE_READY_TIMEOUT" | "E_SANDBOX_UNAUTHENTICATED" | "E_BOXLITE_COMPAT";

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
 *
 * FASTCLAW_DEPLOY=hosted closes B1 (docs/b1-file-tools.md): FastClaw v1.4.0 then routes every
 * file-tool path (write_file / edit_file / read_file / list_dir, incl. ~/Documents and /Users/…)
 * into the sandbox (internal/agent/tools/route.go rule 1) and never registers host_exec
 * (buildinfo.IsHostExecAllowed). It is set only together with the sandbox: hosted without a
 * sandbox pool makes file tools refuse instead of touching the host.
 */
export function sandboxGatewayEnv(proxyUrl: string, clientKey: string): ChildEnvOptions {
  const set: Record<string, string> = {
    FASTCLAW_SANDBOX_ENABLED: "1",
    FASTCLAW_SANDBOX_ENFORCE: "1",
    FASTCLAW_SANDBOX_BACKEND: "boxlite",
    FASTCLAW_SANDBOX_BOXLITE_URL: proxyUrl,
    FASTCLAW_SANDBOX_BOXLITE_PREFIX: BOXLITE_PREFIX,
    BOXLITE_API_KEY: clientKey,
    FASTCLAW_DEPLOY: "hosted",
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
  /** Create a box through our proxy (FastClaw's body, no network), run the net probes, delete it. Keys stay in here. */
  selfcheck(opts?: { image?: string }): Promise<SelfcheckResult>;
  /** Resolves when `boxlite serve` exits. */
  exited: Promise<number | null>;
  stop(graceMs?: number): Promise<void>;
}

/** Protected routes probed at startup (no key, then a wrong key). /v1/config is public by design. */
export const AUTH_PROBES: ReadonlyArray<{ method: "GET" | "POST"; path: string }> = [
  { method: "GET", path: `/${BOXLITE_PREFIX}/boxes` },
  { method: "POST", path: `/${BOXLITE_PREFIX}/boxes` },
];

/** Throws E_SANDBOX_UNAUTHENTICATED unless every protected probe answers 401 without a valid key. */
export async function assertServeAuthenticated(serveUrl: string, doFetch: typeof fetch = fetch): Promise<void> {
  for (const auth of [undefined, `Bearer ${generateKey()}`]) {
    for (const p of AUTH_PROBES) {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (auth) headers.authorization = auth;
      let status = 0;
      try {
        // POST body is deliberately invalid ({}), so even an open serve creates nothing.
        const r = await doFetch(`${serveUrl}${p.path}`, {
          method: p.method,
          headers,
          body: p.method === "POST" ? "{}" : undefined,
          signal: AbortSignal.timeout(5000),
        });
        status = r.status;
        await r.body?.cancel();
      } catch {
        status = 0;
      }
      if (status !== 401) {
        throw new SandboxError(
          "E_SANDBOX_UNAUTHENTICATED",
          `boxlite serve 没有启用鉴权：${auth ? "带错误 key" : "不带 key"}的 ${p.method} ${p.path} 返回 ${status || "无响应"}（应为 401）。` +
            "沙箱已停止，Heybe 不会在无鉴权的沙箱上继续运行",
        );
      }
    }
  }
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
    // 2) The key must be enforced. GET /v1/config is BoxLite's public route (200 even with a key),
    //    so it says nothing about auth; probe protected routes instead: without a key and with a
    //    wrong key, list and create must both answer 401. Anything else: stop serve, never run open.
    await assertServeAuthenticated(serveUrl, doFetch);
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
      selfcheck: (o) => {
        if (!proxy) return Promise.reject(new Error("沙箱已停止"));
        return runSandboxSelfcheck({ proxyUrl: proxy.url, clientKey, servePort: port, image: o?.image, fetchImpl: doFetch });
      },
    };
  } catch (err) {
    await stop();
    throw err;
  }
}
