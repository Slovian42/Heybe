// 19-b: the Heybe service owns the FastClaw gateway process. When the service stops
// (Tauri quit / SIGTERM / parent gone) the gateway is stopped too, so nothing is left behind.
//
// Startup rules (Mac batch 2026-11-02):
// - We never attach to a gateway we did not start. If the port is already taken (a leftover
//   `fastclaw daemon`, another Heybe, a different FastClaw build, or any other program) we fail
//   with a readable, non-retryable error instead of "becoming healthy" against it.
// - Readiness = our own child alive AND /healthz 200, polled with backoff up to readyTimeoutMs.
// - After ready, /api/status `version` must match `fastclaw version` when both are known.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { connect } from "node:net";

import { buildChildEnv, type ChildEnvOptions } from "./child-env.js";

/**
 * Args for the FastClaw child. Always the explicit foreground `gateway` subcommand, never a
 * bare `fastclaw`: in FastClaw v1.4.0 the root command (cmd/fastclaw/main.go RunE) checks
 * `isInteractiveTerminal(os.Stdin, os.Stdout)` (cmd_chat.go), which only tests
 * os.ModeCharDevice — and /dev/null (our "ignore" stdio) IS a character device. So a bare
 * `fastclaw` took the chat path: `daemon.Start` (a detached background gateway that outlives
 * us), then the bubbletea TUI, which needs /dev/tty and dies with "could not open a new TTY"
 * when there is no controlling terminal (Dock / Finder launch, setsid). `gateway --port N`
 * (gatewayCmd -> runGateway) runs in the foreground with no TTY or daemon involved.
 */
export function gatewayArgs(port: number): string[] {
  return ["gateway", "--port", String(port)];
}

export type GatewayErrorCode =
  | "E_FC_PORT_BUSY" // something that is not FastClaw listens on the port
  | "E_FC_FOREIGN_GATEWAY" // a FastClaw gateway we did not start is on the port
  | "E_FC_VERSION_MISMATCH" // gateway version != CLI version
  | "E_FC_READY_TIMEOUT" // our child never answered /healthz in time
  | "E_FC_EXITED"; // our child exited during startup

/** Retrying cannot fix these; the supervisor should stop and show the message. */
export const NON_RETRYABLE: ReadonlySet<GatewayErrorCode> = new Set([
  "E_FC_PORT_BUSY",
  "E_FC_FOREIGN_GATEWAY",
  "E_FC_VERSION_MISMATCH",
]);

export class GatewayError extends Error {
  readonly code: GatewayErrorCode;
  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
  get retryable(): boolean {
    return !NON_RETRYABLE.has(this.code);
  }
}

export interface GatewayOptions {
  /** Path to the `fastclaw` binary (HEYBE_FASTCLAW_GATEWAY_BIN). */
  bin: string;
  /** Port the gateway listens on (also passed as FASTCLAW_PORT in env). */
  port: number;
  /** Health URL; default http://127.0.0.1:<port>/healthz. */
  healthUrl?: string;
  env?: Record<string, string | undefined>;
  /**
   * Extra names / fixed values for the gateway's env (buildChildEnv options), e.g. the BoxLite
   * sandbox settings from sandbox.ts. Only the gateway gets them, not `fastclaw version`.
   */
  childEnv?: ChildEnvOptions;
  /** Total time to wait for /healthz after spawning (default 30 s). */
  readyTimeoutMs?: number;
  /** Poll backoff: starts at minDelayMs, doubles up to maxDelayMs (default 200 ms .. 2 s). */
  minDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Version the gateway must report. undefined = ask `<bin> version`; null = skip the check.
   */
  expectedVersion?: string | null;
  fetchImpl?: typeof fetch;
  /** Is something listening on 127.0.0.1:port? (injectable for tests) */
  portInUse?: (port: number) => Promise<boolean>;
}

export interface GatewayHandle {
  child: ChildProcess;
  /** Resolves when the gateway exits (code or signal). */
  exited: Promise<number | null>;
  /** Version reported by the running gateway (/api/status), if any. */
  version?: string;
  stop(graceMs?: number): Promise<void>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "dev" / "" mean "no published version": FastClaw's buildinfo.Version defaults to "dev", and
 * the v1.4.0 release builds only stamp main.version (.goreleaser.yaml / release.yml ldflags), so
 * an official v1.4.0 gateway reports "dev" on /api/status while `fastclaw version` says v1.4.0.
 * That is also why FastClaw itself prints "gateway is running FastClaw dev but this CLI is
 * v1.4.0" (cmd_chat.go warnVersionSkew). Such values can't be compared.
 */
export function knownVersion(v: string | undefined | null): string | undefined {
  const s = (v ?? "").trim().replace(/^v/i, "");
  return s && s !== "dev" && s !== "unknown" ? s : undefined;
}

export function versionsConflict(a: string | undefined | null, b: string | undefined | null): boolean {
  const x = knownVersion(a);
  const y = knownVersion(b);
  return x !== undefined && y !== undefined && x !== y;
}

/** Parse `fastclaw version` output ("FastClaw v1.4.0\n  commit: …"). */
export function parseCliVersion(out: string): string | undefined {
  const m = /FastClaw\s+(v?[0-9][\w.+-]*|dev)\b/i.exec(out);
  return m?.[1];
}

export function readCliVersion(bin: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(bin, ["version"], { env, timeout: 5000 }, (err, stdout) => {
      resolve(err ? undefined : parseCliVersion(String(stdout)));
    });
  });
}

export function tcpPortInUse(port: number, host = "127.0.0.1", timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const s = connect({ port, host });
    const done = (v: boolean) => {
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeoutMs, () => done(false));
    s.once("connect", () => done(true));
    s.once("error", () => done(false));
  });
}

interface StatusProbe {
  fastclaw: boolean;
  version?: string;
}

async function probeStatus(doFetch: typeof fetch, base: string): Promise<StatusProbe> {
  let fastclaw = false;
  try {
    const h = await doFetch(`${base}/healthz`, { signal: AbortSignal.timeout(1000) });
    fastclaw = h.ok;
  } catch {
    // not HTTP / not answering
  }
  try {
    const r = await doFetch(`${base}/api/status`, { signal: AbortSignal.timeout(1000) });
    if (r.ok) {
      const body = (await r.json()) as { version?: unknown };
      if (typeof body.version === "string") return { fastclaw: true, version: body.version };
    }
  } catch {
    // ignore
  }
  return { fastclaw };
}

function originOf(healthUrl: string): string {
  return new URL(healthUrl).origin;
}

function foreignMessage(port: number, found: StatusProbe, cli: string | undefined): GatewayError {
  const ver = found.version ?? "未知";
  const stopHint =
    `请先停掉它：如果是之前留下的 FastClaw，跑 \`FASTCLAW_HOME=<它的数据目录> fastclaw daemon stop\`` +
    `（Heybe 开发版：\`scripts/poc/t021-mac.sh cleanup\`）；或者给 Heybe 换一个 FASTCLAW_PORT。`;
  if (versionsConflict(found.version, cli)) {
    return new GatewayError(
      "E_FC_VERSION_MISMATCH",
      `端口 ${port} 上已经有一个 FastClaw gateway（版本 ${ver}），和 Heybe 要用的 fastclaw（${cli}）版本不一致，` +
        `而且不是 Heybe 这次启动的；Heybe 不会连接它。${stopHint}`,
    );
  }
  return new GatewayError(
    "E_FC_FOREIGN_GATEWAY",
    `端口 ${port} 上已经有一个 FastClaw gateway 在运行（报告版本 ${ver}），不是 Heybe 这次启动的；` +
      `Heybe 不会连接别人的 gateway。${stopHint}`,
  );
}

const TAIL_BYTES = 4096;

export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  // Whitelisted env only: no model/provider keys, no HEYBE_* tokens (child-env.ts rules).
  const { env: plainEnv } = buildChildEnv(opts.env ?? process.env);
  const { env } = opts.childEnv ? buildChildEnv(opts.env ?? process.env, opts.childEnv) : { env: plainEnv };
  const port = opts.port;
  const healthUrl = opts.healthUrl ?? `http://127.0.0.1:${port}/healthz`;
  const base = originOf(healthUrl);
  const doFetch = opts.fetchImpl ?? fetch;
  const inUse = opts.portInUse ?? tcpPortInUse;
  const cli = opts.expectedVersion === undefined ? await readCliVersion(opts.bin, plainEnv) : (opts.expectedVersion ?? undefined);

  // 1) Never attach to a gateway (or anything) we did not start.
  if (await inUse(port)) {
    const found = await probeStatus(doFetch, base);
    if (found.fastclaw) throw foreignMessage(port, found, cli);
    throw new GatewayError(
      "E_FC_PORT_BUSY",
      `端口 ${port} 已被其它程序占用（不是 FastClaw），gateway 起不来。` +
        `用 \`lsof -nP -iTCP:${port} -sTCP:LISTEN\` 看是谁占的，停掉它或者换一个 FASTCLAW_PORT。`,
    );
  }

  // 2) Spawn our own foreground gateway; keep a stderr tail for readable errors.
  const child = spawn(opts.bin, gatewayArgs(port), { env, stdio: ["ignore", "ignore", "pipe"] });
  let tail = "";
  child.stderr?.on("data", (d: Buffer) => {
    process.stderr.write(d);
    tail = (tail + d.toString()).slice(-TAIL_BYTES);
  });
  let done = false;
  let exitCode: number | null = null;
  const exited = new Promise<number | null>((resolve) => {
    child.once("exit", (code) => {
      done = true;
      exitCode = code;
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

  const lastLines = () =>
    tail
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-3)
      .join(" | ");

  // 3) Wait for /healthz with backoff. FastClaw keeps running when its listener fails to bind
  //    ("bind: address already in use"), so watch stderr for that instead of trusting /healthz.
  const timeoutMs = opts.readyTimeoutMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let delay = opts.minDelayMs ?? 200;
  const maxDelay = opts.maxDelayMs ?? 2000;
  for (;;) {
    if (done) {
      const hint = /could not open a new TTY/.test(tail) ? "（需要 TTY：说明没有用 gateway 子命令启动）" : "";
      throw new GatewayError("E_FC_EXITED", `FastClaw gateway 启动时退出了（退出码 ${exitCode ?? "?"}）${hint}：${lastLines() || "没有输出"}`);
    }
    if (/address already in use/.test(tail)) {
      await stop();
      throw new GatewayError("E_FC_PORT_BUSY", `端口 ${port} 刚被别的程序占用，gateway 绑不上端口；停掉占用者或换一个 FASTCLAW_PORT。`);
    }
    let ok = false;
    try {
      const res = await doFetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      ok = res.ok;
    } catch {
      // not up yet
    }
    if (ok && !done) break;
    if (Date.now() >= deadline) {
      await stop();
      throw new GatewayError(
        "E_FC_READY_TIMEOUT",
        `FastClaw gateway ${Math.round(timeoutMs / 1000)} 秒内没有就绪（${healthUrl}）。最后的输出：${lastLines() || "没有输出"}`,
      );
    }
    await sleep(Math.min(delay, Math.max(0, deadline - Date.now())));
    delay = Math.min(delay * 2, maxDelay);
  }

  // 4) Our child is up; check that it is the version we expect (and that /healthz was not
  //    answered by someone who grabbed the port between our check and the bind).
  const status = await probeStatus(doFetch, base);
  if (done || /address already in use/.test(tail)) {
    await stop();
    throw new GatewayError("E_FC_PORT_BUSY", `端口 ${port} 刚被别的程序占用，gateway 绑不上端口；停掉占用者或换一个 FASTCLAW_PORT。`);
  }
  if (versionsConflict(status.version, cli)) {
    await stop();
    throw new GatewayError(
      "E_FC_VERSION_MISMATCH",
      `FastClaw gateway 报告版本 ${status.version}，但 fastclaw 命令是 ${cli}；请重新安装同一版本的 FastClaw（scripts/poc/t021-mac.sh）。`,
    );
  }
  return { child, exited, stop, version: status.version };
}
