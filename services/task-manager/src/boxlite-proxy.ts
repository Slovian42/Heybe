// Local BoxLite proxy between the FastClaw gateway and `boxlite serve` (Refs #6 #7 #12).
//
// Why it exists (all checked against source, docs/sandbox-options.md §BoxLite):
// - FastClaw v1.4.0 internal/sandbox/boxlite_executor.go createBox() sends exactly
//   {"image": …, "auto_remove": true} and nothing else: no network field, so BoxLite applies its
//   default (outbound enabled, host reachable as host.boxlite.internal / 192.168.127.254).
//   `fastclaw agents config <a> set sandbox.network none` writes an agent-scope row the system
//   pool never reads, so it does not help.
// - BoxLite ≥0.10.0 CreateBoxRequest is deny_unknown_fields and dropped auto_remove, so the
//   FastClaw body is rejected as a whole ("unknown field `auto_remove`").
//
// What it does:
// - Every box-creating POST …/boxes gets `"network":{"outbound":{"mode":"disabled"},
//   "inbound":{"mode":"disabled"}}`. Any network field the client sent is overwritten (and
//   logged). This is unconditional; there is no option to turn it off.
// - auto_remove is removed when `stripAutoRemove` (decided by the fc-compat probe).
// - Other box-creating routes FastClaw never uses (POST …/boxes/import, …/boxes/{id}/clone)
//   are refused with 403, because their bodies cannot carry our network override.
// - A create body that is not a JSON object is refused with 400 (fail closed).
// - Clients must present `Authorization: Bearer <clientKey>`; the proxy replaces it with the
//   upstream key before forwarding. Neither key is ever logged.
// - Everything else (exec, files tar upload, WebSocket attach, DELETE …) is streamed unchanged.
// - Listens on 127.0.0.1 only and forwards only to a loopback upstream.
import { timingSafeEqual } from "node:crypto";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";

import { LOOPBACK_HOST } from "./constants.js";

/** Network spec forced into every box creation. Inbound is disabled explicitly (BoxLite's default too). */
export const DISABLED_NETWORK = Object.freeze({
  outbound: Object.freeze({ mode: "disabled" }),
  inbound: Object.freeze({ mode: "disabled" }),
});

/** Upper bound for a create-box JSON body we buffer to rewrite (FastClaw sends ~60 bytes). */
export const MAX_CREATE_BODY_BYTES = 1024 * 1024;

export type ProxyLog = (line: string) => void;

function pathOnly(url: string): string {
  const i = url.indexOf("?");
  return (i >= 0 ? url.slice(0, i) : url).replace(/\/+$/, "");
}

/** POST …/boxes (any prefix: /v1/boxes, /v1/default/boxes). */
export function isCreateBoxRequest(method: string | undefined, url: string | undefined): boolean {
  return (method ?? "").toUpperCase() === "POST" && /\/boxes$/.test(pathOnly(url ?? ""));
}

/** Box-creating routes whose body we cannot rewrite into a disabled network: refused. */
export function isBlockedBoxRoute(method: string | undefined, url: string | undefined): boolean {
  if ((method ?? "").toUpperCase() !== "POST") return false;
  const p = pathOnly(url ?? "");
  return /\/boxes\/import$/.test(p) || /\/boxes\/[^/]+\/clone$/.test(p);
}

export interface CreateRewrite {
  body: Buffer;
  /** Human-readable notes for the log (no values from the body except network modes). */
  notes: string[];
}

function describeNetwork(v: unknown): string {
  if (v === undefined) return "absent";
  if (!v || typeof v !== "object") return JSON.stringify(v);
  const o = v as Record<string, unknown>;
  const mode = (x: unknown) => (x && typeof x === "object" ? String((x as Record<string, unknown>).mode) : undefined);
  const parts: string[] = [];
  if ("outbound" in o) parts.push(`outbound=${mode(o.outbound)}`);
  if ("inbound" in o) parts.push(`inbound=${mode(o.inbound)}`);
  if ("mode" in o) parts.push(`mode=${String(o.mode)}`);
  if ("allow_net" in o) parts.push("allow_net=…");
  return parts.length ? parts.join(",") : "{}";
}

/**
 * Rewrite a create-box body: force the disabled network, optionally drop auto_remove.
 * Throws when the body is not a JSON object (the caller answers 400 and forwards nothing).
 */
export function rewriteCreateBox(raw: Buffer | string, opts: { stripAutoRemove: boolean }): CreateRewrite {
  const text = typeof raw === "string" ? raw : raw.toString("utf8");
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("create box body is not JSON");
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("create box body is not a JSON object");
  const o = { ...(obj as Record<string, unknown>) };
  const notes: string[] = [];
  if (opts.stripAutoRemove && "auto_remove" in o) {
    delete o.auto_remove;
    notes.push("auto_remove removed");
  }
  if ("network" in o) notes.push(`network overwritten (was ${describeNetwork(o.network)})`);
  else notes.push("network set");
  o.network = { outbound: { ...DISABLED_NETWORK.outbound }, inbound: { ...DISABLED_NETWORK.inbound } };
  return { body: Buffer.from(JSON.stringify(o)), notes };
}

export function bearerMatches(header: string | string[] | undefined, key: string): boolean {
  const h = Array.isArray(header) ? header[0] : header;
  const m = /^Bearer\s+(.+)$/i.exec(h?.trim() ?? "");
  if (!m) return false;
  const a = Buffer.from(m[1].trim());
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  "transfer-encoding",
]);

function isLoopback(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "localhost" || h === "::1";
}

export interface BoxliteProxyOptions {
  /** `boxlite serve` base, e.g. http://127.0.0.1:8100 (must be loopback, http). */
  upstream: string;
  /** Sent upstream as `Authorization: Bearer …` (BOXLITE_SERVE_API_KEY of the serve). */
  upstreamKey?: string;
  /** Required from clients as `Authorization: Bearer …` (FastClaw's BOXLITE_API_KEY). */
  clientKey: string;
  /** Remove auto_remove from create bodies (fc-compat: BoxLite ≥0.10 rejects it). */
  stripAutoRemove: boolean;
  /** Listen port on 127.0.0.1; 0 = random. */
  port?: number;
  log?: ProxyLog;
}

export interface BoxliteProxy {
  port: number;
  /** http://127.0.0.1:<port> — what FASTCLAW_SANDBOX_BOXLITE_URL points at. */
  url: string;
  close(): Promise<void>;
}

const defaultLog: ProxyLog = (line) => process.stderr.write(`boxlite-proxy: ${line}\n`);

export async function startBoxliteProxy(opts: BoxliteProxyOptions): Promise<BoxliteProxy> {
  const up = new URL(opts.upstream);
  if (up.protocol !== "http:" || !isLoopback(up.hostname)) throw new Error("boxlite proxy upstream must be http on loopback");
  if (!opts.clientKey) throw new Error("boxlite proxy needs a client key");
  const upHost = up.hostname.replace(/^\[|\]$/g, "");
  const upPort = Number(up.port || 80);
  const log = opts.log ?? defaultLog;

  const upstreamHeaders = (req: IncomingMessage, keepHopByHop: boolean): Record<string, string | string[]> => {
    const out: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue;
      const lk = k.toLowerCase();
      if (lk === "authorization" || lk === "host") continue;
      if (!keepHopByHop && HOP_BY_HOP.has(lk)) continue;
      out[lk] = v;
    }
    out.host = up.host;
    if (opts.upstreamKey) out.authorization = `Bearer ${opts.upstreamKey}`;
    return out;
  };

  const reject = (res: ServerResponse, code: number, message: string) => {
    const body = JSON.stringify({ error: { code, message } });
    res.writeHead(code, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
    res.end(body);
  };

  const forward = (req: IncomingMessage, res: ServerResponse, body?: Buffer) => {
    const headers = upstreamHeaders(req, false);
    if (body) {
      headers["content-length"] = String(body.length);
    } else if (req.headers["transfer-encoding"]) {
      headers["transfer-encoding"] = "chunked";
    }
    const upReq = http.request({ host: upHost, port: upPort, method: req.method, path: req.url, headers }, (upRes) => {
      const h: Record<string, string | string[]> = {};
      for (const [k, v] of Object.entries(upRes.headers)) if (v !== undefined && !HOP_BY_HOP.has(k)) h[k] = v;
      res.writeHead(upRes.statusCode ?? 502, upRes.statusMessage, h);
      upRes.pipe(res);
    });
    upReq.on("error", () => {
      if (!res.headersSent) reject(res, 502, "boxlite upstream unreachable");
      else res.destroy();
    });
    if (body) upReq.end(body);
    else req.pipe(upReq);
  };

  const server = http.createServer((req, res) => {
    if (!bearerMatches(req.headers.authorization, opts.clientKey)) {
      req.resume();
      reject(res, 401, "unauthorized");
      return;
    }
    if (isBlockedBoxRoute(req.method, req.url)) {
      req.resume();
      log(`refused ${req.method} ${pathOnly(req.url ?? "")}: box creation route without network override`);
      reject(res, 403, "heybe: this box creation route is disabled (network must stay off)");
      return;
    }
    if (!isCreateBoxRequest(req.method, req.url)) {
      forward(req, res);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_CREATE_BODY_BYTES) tooBig = true;
      else chunks.push(c);
    });
    req.on("end", () => {
      if (tooBig) {
        reject(res, 413, "create box body too large");
        return;
      }
      let rewritten: CreateRewrite;
      try {
        rewritten = rewriteCreateBox(Buffer.concat(chunks), { stripAutoRemove: opts.stripAutoRemove });
      } catch (err) {
        log(`refused POST ${pathOnly(req.url ?? "")}: ${(err as Error).message}`);
        reject(res, 400, "heybe: create box body must be a JSON object");
        return;
      }
      log(`POST ${pathOnly(req.url ?? "")}: ${rewritten.notes.join("; ")}; outbound=disabled`);
      forward(req, res, rewritten.body);
    });
  });

  // WebSocket attach (…/executions/{id}/attach): check the key, swap it, then splice sockets.
  const tunnels = new Set<Socket>();
  server.on("upgrade", (req: IncomingMessage, sock: Socket, head: Buffer) => {
    tunnels.add(sock);
    sock.on("close", () => tunnels.delete(sock));
    if (!bearerMatches(req.headers.authorization, opts.clientKey)) {
      sock.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    if (isCreateBoxRequest(req.method, req.url) || isBlockedBoxRoute(req.method, req.url)) {
      sock.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    const upSock = connect({ host: upHost, port: upPort }, () => {
      const headers = upstreamHeaders(req, true);
      let lines = `${req.method} ${req.url} HTTP/1.1\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        for (const one of Array.isArray(v) ? v : [v]) lines += `${k}: ${one}\r\n`;
      }
      upSock.write(lines + "\r\n");
      if (head.length) upSock.write(head);
      upSock.pipe(sock);
      sock.pipe(upSock);
    });
    const kill = () => {
      upSock.destroy();
      sock.destroy();
    };
    upSock.on("error", () => {
      if (sock.writable) sock.end("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      kill();
    });
    sock.on("error", kill);
    tunnels.add(upSock);
    upSock.on("close", () => {
      tunnels.delete(upSock);
      sock.destroy();
    });
    sock.on("close", () => upSock.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, LOOPBACK_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  log(`listening ${LOOPBACK_HOST}:${port} -> ${up.host} (outbound network forced to disabled; auto_remove ${opts.stripAutoRemove ? "stripped" : "kept"})`);
  return {
    port,
    url: `http://${LOOPBACK_HOST}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        for (const t of tunnels) t.destroy();
        server.close(() => resolve());
      }),
  };
}

export type FcCompatVerdict = "reject_auto_remove" | "ok" | "unknown";

/**
 * fc-compat probe (same as scripts/poc/boxlite-poc.sh fc-compat): POST …/boxes with
 * {"auto_remove":true,"cpus":"heybe-probe"}. Both old and new BoxLite must answer 4xx (cpus is a
 * number), so no box is created; the error text tells whether auto_remove is still accepted.
 */
export async function probeFcCompat(
  boxesUrl: string,
  upstreamKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<FcCompatVerdict> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (upstreamKey) headers.authorization = `Bearer ${upstreamKey}`;
  const res = await fetchImpl(boxesUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ auto_remove: true, cpus: "heybe-probe" }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (res.ok) {
    // Should never happen; remove whatever got created.
    try {
      const id = (JSON.parse(text) as { box_id?: string }).box_id;
      if (id) await fetchImpl(`${boxesUrl}/${encodeURIComponent(id)}?force=true`, { method: "DELETE", headers });
    } catch {
      // ignore
    }
    return "ok";
  }
  if (/unknown field/i.test(text) && text.includes("auto_remove")) return "reject_auto_remove";
  if (/invalid type|cpus/i.test(text)) return "ok";
  return "unknown";
}
