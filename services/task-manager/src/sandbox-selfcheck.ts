// Deterministic sandbox self-check (Refs #6 #12, #90 Mac recheck 3 item B). Runs inside the
// local service, which holds the proxy client key in memory, so no key ever leaves the process:
//
//   1. POST {proxy}/v1/boxes with FastClaw v1.4.0's create body ({image, auto_remove}), no network
//      field — the proxy must force outbound=disabled (its log line is checked by the script);
//   2. start, exec the network probes (same command as scripts/poc/lib-net-verify.sh, host port =
//      this run's serve port), read the output over the WebSocket attach route;
//   3. DELETE the box (always).
//
// The result carries only markers (KEY=VALUE), HTTP codes and timings — never a key or raw output.
import { randomBytes } from "node:crypto";
import { connect } from "node:net";

/** FastClaw v1.4.0's default sandbox image (internal/sandbox/boxlite_executor.go). */
export const FASTCLAW_DEFAULT_IMAGE = "thinkany/fastclaw-sandbox:latest";

export const PROBE_MARKERS = ["CURL", "EXT", "HOST8100", "HOST11434", "DNS"] as const;

/**
 * Same as NET_PROBE_CMD in scripts/poc/lib-net-verify.sh (a test keeps them in sync); only the
 * host serve port changes. The HOST8100 marker name is kept so net_verdict works unchanged.
 */
export function netProbeCmd(servePort: number): string {
  return (
    "echo CURL=$(command -v curl >/dev/null 2>&1 && echo yes || echo no); " +
    "curl -sS -m 8 -o /dev/null https://example.com >/dev/null 2>&1 && echo EXT=OPEN || echo EXT=NET_BLOCKED; " +
    `curl -sS -m 5 -o /dev/null http://host.boxlite.internal:${servePort}/v1/config >/dev/null 2>&1 && echo HOST8100=OPEN || echo HOST8100=NET_BLOCKED; ` +
    "curl -sS -m 5 -o /dev/null http://192.168.127.254:11434/ >/dev/null 2>&1 && echo HOST11434=OPEN || echo HOST11434=NET_BLOCKED; " +
    "(getent hosts example.com || nslookup example.com) >/dev/null 2>&1 && echo DNS=RESOLVED || echo DNS=NET_BLOCKED"
  );
}

/** First value of each known marker in `text` (JSON-escaped newlines tolerated). */
export function parseMarkers(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/\b(CURL|EXT|HOST8100|HOST11434|DNS)=([A-Za-z_]+)/g)) {
    const [, k, v] = m;
    if (k && v && !(k in out)) out[k] = v;
  }
  return out;
}

export interface SelfcheckResult {
  ok: boolean;
  /** The create request carried no network field (FastClaw's shape); the proxy adds it. */
  request_network: "not_specified";
  image: string;
  create_http: number;
  start_http?: number;
  exec_http?: number;
  attach?: "101" | string;
  markers: Record<string, string>;
  delete_http?: number;
  elapsed_ms: number;
  error?: string;
}

export interface SelfcheckOptions {
  proxyUrl: string;
  clientKey: string;
  servePort: number;
  image?: string;
  fetchImpl?: typeof fetch;
  createTimeoutMs?: number;
  execTimeoutMs?: number;
}

/** Minimal WebSocket reader: handshake with the bearer key, collect server text/binary frames until "exit"/close/timeout. */
export function readAttach(url: string, key: string, timeoutMs: number): Promise<{ status: string; text: string }> {
  const u = new URL(url);
  return new Promise((resolve) => {
    const sock = connect(Number(u.port), u.hostname);
    let head = "";
    let status = "";
    let buf = Buffer.alloc(0);
    let text = "";
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ status, text });
    };
    const timer = setTimeout(done, timeoutMs);
    sock.on("error", done);
    sock.on("close", done);
    sock.on("connect", () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nAuthorization: Bearer ${key}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${randomBytes(16).toString("base64")}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
    });
    sock.on("data", (d: Buffer) => {
      if (!status) {
        head += d.toString("latin1");
        const i = head.indexOf("\r\n\r\n");
        if (i < 0) return;
        status = head.split(" ")[1] ?? "?";
        if (status !== "101") return done();
        buf = Buffer.from(head.slice(i + 4), "latin1");
      } else {
        buf = Buffer.concat([buf, d]);
      }
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0]! & 0x0f;
        let len = buf[1]! & 0x7f;
        let off = 2;
        if (len === 126) {
          if (buf.length < 4) return;
          len = buf.readUInt16BE(2);
          off = 4;
        } else if (len === 127) {
          if (buf.length < 10) return;
          len = Number(buf.readBigUInt64BE(2));
          off = 10;
        }
        if (buf[1]! & 0x80) off += 4; // servers don't mask; tolerate it anyway (payload stays as sent)
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len).toString("utf8");
        buf = buf.subarray(off + len);
        if (op === 8) return done();
        if (op === 1 || op === 2 || op === 0) {
          text += payload;
          if (payload.includes('"exit"')) return done();
        }
      }
    });
  });
}

export async function runSandboxSelfcheck(opts: SelfcheckOptions): Promise<SelfcheckResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const t0 = Date.now();
  const image = opts.image ?? FASTCLAW_DEFAULT_IMAGE;
  const base = `${opts.proxyUrl}/v1`;
  const headers = { authorization: `Bearer ${opts.clientKey}`, "content-type": "application/json" };
  const res: SelfcheckResult = { ok: false, request_network: "not_specified", image, create_http: 0, markers: {}, elapsed_ms: 0 };
  const call = async (method: string, path: string, body: unknown, ms: number): Promise<{ status: number; json: Record<string, unknown> }> => {
    const r = await doFetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
    const t = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(t) as Record<string, unknown>;
    } catch {
      // non-JSON body; only the status is used
    }
    return { status: r.status, json };
  };
  let box = "";
  try {
    // FastClaw v1.4.0 createBox: exactly {image, auto_remove:true}; no network settings.
    const c = await call("POST", "/boxes", { image, auto_remove: true }, opts.createTimeoutMs ?? 900_000);
    res.create_http = c.status;
    box = typeof c.json.box_id === "string" ? c.json.box_id : "";
    if (c.status >= 300 || !box) throw new Error(`建箱失败（HTTP ${c.status}）`);
    const s = await call("POST", `/boxes/${encodeURIComponent(box)}/start`, undefined, opts.createTimeoutMs ?? 300_000);
    res.start_http = s.status;
    if (s.status >= 300) throw new Error(`start 失败（HTTP ${s.status}）`);
    const e = await call("POST", `/boxes/${encodeURIComponent(box)}/exec`, { command: "sh", args: ["-c", netProbeCmd(opts.servePort)] }, 60_000);
    res.exec_http = e.status;
    const exe = typeof e.json.execution_id === "string" ? e.json.execution_id : "";
    if (e.status >= 300 || !exe) throw new Error(`exec 失败（HTTP ${e.status}）`);
    const a = await readAttach(
      `${base}/boxes/${encodeURIComponent(box)}/executions/${encodeURIComponent(exe)}/attach`,
      opts.clientKey,
      opts.execTimeoutMs ?? 90_000,
    );
    res.attach = a.status;
    res.markers = parseMarkers(a.text.replace(/\\n/g, "\n"));
    const m = res.markers;
    res.ok = m.CURL === "yes" && ["EXT", "HOST8100", "HOST11434", "DNS"].every((k) => m[k] === "NET_BLOCKED");
    if (!res.ok && a.status !== "101") res.error = `attach 握手失败（${a.status || "无响应"}）`;
  } catch (err) {
    res.error = err instanceof Error ? err.message : "自检出错";
  } finally {
    if (box) {
      try {
        res.delete_http = (await call("DELETE", `/boxes/${encodeURIComponent(box)}?force=true`, undefined, 60_000)).status;
      } catch {
        res.delete_http = 0;
      }
      if (!res.delete_http || res.delete_http >= 300) {
        res.ok = false;
        res.error = res.error ?? `删箱失败（HTTP ${res.delete_http}）`;
      }
    }
    res.elapsed_ms = Date.now() - t0;
  }
  return res;
}
