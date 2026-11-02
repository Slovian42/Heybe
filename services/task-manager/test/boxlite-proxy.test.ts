import { spawn } from "node:child_process";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { connect } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import {
  bearerMatches,
  isBlockedBoxRoute,
  isCreateBoxRequest,
  probeFcCompat,
  rewriteCreateBox,
  startBoxliteProxy,
  type BoxliteProxy,
} from "../src/boxlite-proxy.js";

const CLIENT = "client-test-not-a-real-key";
const UPSTREAM = "upstream-test-not-a-real-key";
const DISABLED = { outbound: { mode: "disabled" }, inbound: { mode: "disabled" } };

interface Seen {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

/** Fake `boxlite serve`: records requests, answers 401 without the upstream key, echoes a WS-ish upgrade. */
async function fakeServe(opts: { requireKey?: string } = {}) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.concat(chunks) });
      if (opts.requireKey && req.headers.authorization !== `Bearer ${opts.requireKey}` && req.url !== "/v1/config") {
        res.writeHead(401, { "content-type": "application/json" });
        res.end('{"error":{"code":401}}');
        return;
      }
      res.writeHead(201, { "content-type": "application/json", "x-upstream": "yes" });
      res.end(JSON.stringify({ box_id: "box_1", echo: Buffer.concat(chunks).length }));
    });
  });
  server.on("upgrade", (req, sock: Socket) => {
    tunnels.push(sock);
    seen.push({ method: req.method ?? "", url: req.url ?? "", headers: req.headers, body: Buffer.alloc(0) });
    sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    sock.on("data", (d: Buffer) => sock.write(Buffer.concat([Buffer.from("echo:"), d])));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return { seen, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

const servers: http.Server[] = [];
const tunnels: Socket[] = [];
const proxies: BoxliteProxy[] = [];
afterEach(async () => {
  for (const p of proxies.splice(0)) await p.close();
  for (const t of tunnels.splice(0)) t.destroy();
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
});

async function proxyTo(upstream: string, stripAutoRemove = true, logs: string[] = []) {
  const p = await startBoxliteProxy({
    upstream,
    upstreamKey: UPSTREAM,
    clientKey: CLIENT,
    stripAutoRemove,
    log: (l) => logs.push(l),
  });
  proxies.push(p);
  return p;
}

async function send(url: string, init: { method?: string; body?: string; key?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.key !== null) headers.authorization = `Bearer ${init.key ?? CLIENT}`;
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(url, { method: init.method ?? "GET", headers, body: init.body });
  return { status: res.status, text: await res.text(), headers: res.headers };
}

describe("rewriteCreateBox", () => {
  it("always forces outbound and inbound disabled", () => {
    const out = JSON.parse(rewriteCreateBox('{"image":"x"}', { stripAutoRemove: false }).body.toString());
    expect(out).toEqual({ image: "x", network: DISABLED });
  });

  it("overwrites an incoming enabled network (nested and legacy flat forms)", () => {
    for (const network of [
      { outbound: { mode: "enabled", allow_net: ["example.com"] } },
      { mode: "enabled", allow_net: ["0.0.0.0/0"] },
      { outbound: { mode: "enabled" }, inbound: { mode: "enabled", allow_net: ["*"] } },
      "enabled",
      null,
    ]) {
      const r = rewriteCreateBox(JSON.stringify({ image: "x", network }), { stripAutoRemove: false });
      expect(JSON.parse(r.body.toString()).network).toEqual(DISABLED);
      expect(r.notes.join(";")).toContain("network overwritten");
    }
  });

  it("removes auto_remove only when asked", () => {
    const body = '{"image":"x","auto_remove":true}';
    expect(JSON.parse(rewriteCreateBox(body, { stripAutoRemove: true }).body.toString())).toEqual({ image: "x", network: DISABLED });
    expect(JSON.parse(rewriteCreateBox(body, { stripAutoRemove: false }).body.toString())).toEqual({
      image: "x",
      auto_remove: true,
      network: DISABLED,
    });
  });

  it("rejects bodies that are not a JSON object", () => {
    for (const b of ["", "not json", "[]", "null", '"x"', "42"]) {
      expect(() => rewriteCreateBox(b, { stripAutoRemove: true })).toThrow();
    }
  });
});

describe("route matching", () => {
  it("matches create box under any prefix", () => {
    expect(isCreateBoxRequest("POST", "/v1/boxes")).toBe(true);
    expect(isCreateBoxRequest("post", "/v1/default/boxes/")).toBe(true);
    expect(isCreateBoxRequest("POST", "/v1/boxes?x=1")).toBe(true);
    expect(isCreateBoxRequest("GET", "/v1/boxes")).toBe(false);
    expect(isCreateBoxRequest("POST", "/v1/boxes/b1/exec")).toBe(false);
    expect(isCreateBoxRequest("POST", "/v1/boxes/b1/start")).toBe(false);
  });

  it("blocks import and clone", () => {
    expect(isBlockedBoxRoute("POST", "/v1/boxes/import")).toBe(true);
    expect(isBlockedBoxRoute("POST", "/v1/default/boxes/b1/clone")).toBe(true);
    expect(isBlockedBoxRoute("POST", "/v1/boxes/b1/exec")).toBe(false);
    expect(isBlockedBoxRoute("GET", "/v1/boxes/import")).toBe(false);
  });

  it("bearerMatches", () => {
    expect(bearerMatches(`Bearer ${CLIENT}`, CLIENT)).toBe(true);
    expect(bearerMatches(`bearer ${CLIENT}`, CLIENT)).toBe(true);
    expect(bearerMatches("Bearer wrong", CLIENT)).toBe(false);
    expect(bearerMatches(undefined, CLIENT)).toBe(false);
    expect(bearerMatches(CLIENT, CLIENT)).toBe(false);
  });
});

describe("startBoxliteProxy", () => {
  it("listens on 127.0.0.1 only and refuses non-loopback upstreams", async () => {
    const up = await fakeServe();
    const p = await proxyTo(up.url);
    expect(p.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await expect(
      startBoxliteProxy({ upstream: "http://10.0.0.1:8100", clientKey: CLIENT, stripAutoRemove: false }),
    ).rejects.toThrow(/loopback/);
    await expect(
      startBoxliteProxy({ upstream: "https://127.0.0.1:8100", clientKey: CLIENT, stripAutoRemove: false }),
    ).rejects.toThrow(/loopback/);
  });

  it("box creation always reaches serve with outbound disabled", async () => {
    const up = await fakeServe({ requireKey: UPSTREAM });
    const logs: string[] = [];
    const p = await proxyTo(up.url, true, logs);
    const r = await send(`${p.url}/v1/boxes`, { method: "POST", body: '{"image":"thinkany/fastclaw-sandbox:latest","auto_remove":true}' });
    expect(r.status).toBe(201);
    const fwd = up.seen.at(-1)!;
    expect(fwd.method).toBe("POST");
    expect(fwd.url).toBe("/v1/boxes");
    expect(JSON.parse(fwd.body.toString())).toEqual({ image: "thinkany/fastclaw-sandbox:latest", network: DISABLED });
    expect(fwd.headers["content-length"]).toBe(String(fwd.body.length));
    expect(logs.join("\n")).toContain("outbound=disabled");
  });

  it("an incoming enabled network is overwritten and logged", async () => {
    const up = await fakeServe();
    const logs: string[] = [];
    const p = await proxyTo(up.url, false, logs);
    const body = JSON.stringify({ image: "x", network: { outbound: { mode: "enabled", allow_net: ["example.com"] } } });
    expect((await send(`${p.url}/v1/boxes`, { method: "POST", body })).status).toBe(201);
    expect(JSON.parse(up.seen.at(-1)!.body.toString()).network).toEqual(DISABLED);
    expect(logs.join("\n")).toMatch(/network overwritten \(was outbound=enabled/);
    expect(logs.join("\n")).not.toContain("example.com");
  });

  it("auto_remove is removed when strip is on", async () => {
    const up = await fakeServe();
    const p = await proxyTo(up.url, true);
    await send(`${p.url}/v1/boxes`, { method: "POST", body: '{"image":"x","auto_remove":true}' });
    expect(JSON.parse(up.seen.at(-1)!.body.toString())).not.toHaveProperty("auto_remove");
  });

  it("other requests pass through unchanged (except the key swap)", async () => {
    const up = await fakeServe({ requireKey: UPSTREAM });
    const p = await proxyTo(up.url);
    const exec = '{"command":"sh","args":["-c","echo hi"],"auto_remove":true,"network":"enabled"}';
    const r = await send(`${p.url}/v1/boxes/box_1/exec?x=1`, { method: "POST", body: exec, headers: { "x-custom": "1" } });
    expect(r.status).toBe(201);
    expect(r.headers.get("x-upstream")).toBe("yes");
    let fwd = up.seen.at(-1)!;
    expect(fwd.url).toBe("/v1/boxes/box_1/exec?x=1");
    expect(fwd.body.toString()).toBe(exec);
    expect(fwd.headers["x-custom"]).toBe("1");
    expect(fwd.headers.authorization).toBe(`Bearer ${UPSTREAM}`);

    expect((await send(`${p.url}/v1/boxes/box_1?force=true`, { method: "DELETE" })).status).toBe(201);
    fwd = up.seen.at(-1)!;
    expect([fwd.method, fwd.url, fwd.body.length]).toEqual(["DELETE", "/v1/boxes/box_1?force=true", 0]);

    // Binary upload (files tar) with chunked transfer stays byte-identical.
    const tar = Buffer.from([0, 1, 2, 255, 254, 0, 10, 13]);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        `${p.url}/v1/boxes/box_1/files?path=/w`,
        { method: "PUT", headers: { authorization: `Bearer ${CLIENT}`, "content-type": "application/x-tar" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", reject);
      req.write(tar.subarray(0, 3));
      req.end(tar.subarray(3));
    });
    expect(status).toBe(201);
    fwd = up.seen.at(-1)!;
    expect(fwd.method).toBe("PUT");
    expect(fwd.body.equals(tar)).toBe(true);
  });

  it("requires the client key (401) and never forwards without it", async () => {
    const up = await fakeServe();
    const p = await proxyTo(up.url);
    expect((await send(`${p.url}/v1/boxes`, { key: null })).status).toBe(401);
    expect((await send(`${p.url}/v1/boxes`, { method: "POST", body: '{"image":"x"}', key: "wrong" })).status).toBe(401);
    expect((await send(`${p.url}/v1/boxes`, { key: UPSTREAM })).status).toBe(401);
    expect(up.seen).toHaveLength(0);
  });

  it("refuses import/clone (403) and bad create bodies (400) without forwarding", async () => {
    const up = await fakeServe();
    const p = await proxyTo(up.url);
    expect((await send(`${p.url}/v1/boxes/import`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await send(`${p.url}/v1/boxes/b1/clone`, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await send(`${p.url}/v1/boxes`, { method: "POST", body: "not json" })).status).toBe(400);
    expect((await send(`${p.url}/v1/boxes`, { method: "POST", body: "[1]" })).status).toBe(400);
    expect(up.seen).toHaveLength(0);
  });

  it("passes WebSocket attach through with the key swapped, and rejects it without the key", async () => {
    const up = await fakeServe();
    const p = await proxyTo(up.url);
    const port = Number(new URL(p.url).port);
    const ws = (auth: string | null) =>
      new Promise<string>((resolve) => {
        const s = connect(port, "127.0.0.1", () => {
          s.write(
            "GET /v1/boxes/b1/executions/e1/attach HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
              "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
              (auth ? `Authorization: Bearer ${auth}\r\n` : "") +
              "\r\n",
          );
        });
        let buf = "";
        s.on("data", (d) => {
          buf += d.toString();
          if (buf.includes("\r\n\r\n") && buf.startsWith("HTTP/1.1 101") && !buf.includes("echo:")) s.write("ping");
          if (buf.includes("echo:ping") || (buf.includes("\r\n\r\n") && !buf.startsWith("HTTP/1.1 101"))) {
            s.destroy();
            resolve(buf);
          }
        });
        s.on("close", () => resolve(buf));
      });
    const ok = await ws(CLIENT);
    expect(ok).toMatch(/^HTTP\/1.1 101/);
    expect(ok).toContain("echo:ping");
    const fwd = up.seen.at(-1)!;
    expect(fwd.url).toBe("/v1/boxes/b1/executions/e1/attach");
    expect(fwd.headers.authorization).toBe(`Bearer ${UPSTREAM}`);
    expect(fwd.headers.upgrade).toBe("websocket");
    const n = up.seen.length;
    expect(await ws(null)).toMatch(/^HTTP\/1.1 401/);
    expect(up.seen).toHaveLength(n);
  });

  it("never logs keys", async () => {
    const up = await fakeServe();
    const logs: string[] = [];
    const p = await proxyTo(up.url, true, logs);
    await send(`${p.url}/v1/boxes`, { method: "POST", body: '{"image":"x"}' });
    await send(`${p.url}/v1/boxes`, { key: "wrong" });
    await send(`${p.url}/v1/boxes/import`, { method: "POST", body: "{}" });
    const all = logs.join("\n");
    expect(all).not.toContain(CLIENT);
    expect(all).not.toContain(UPSTREAM);
  });
});

describe("probeFcCompat", () => {
  const reply = (status: number, body: string) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;
  it("detects auto_remove rejection", async () => {
    expect(await probeFcCompat("http://127.0.0.1:1/v1/boxes", "k", reply(422, "unknown field `auto_remove`, expected one of …"))).toBe(
      "reject_auto_remove",
    );
    expect(await probeFcCompat("http://127.0.0.1:1/v1/boxes", "k", reply(422, "invalid type: string \"heybe-probe\", expected u32 at cpus"))).toBe("ok");
    expect(await probeFcCompat("http://127.0.0.1:1/v1/boxes", "k", reply(500, "boom"))).toBe("unknown");
  });
});

describe("boxlite-proxy-main", () => {
  it("starts from env only and prints READY", async () => {
    const up = await fakeServe({ requireKey: UPSTREAM });
    const tsx = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
    const main = new URL("../src/boxlite-proxy-main.ts", import.meta.url).pathname;
    const child = spawn(tsx, [main], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        HEYBE_BOXLITE_PROXY_UPSTREAM: up.url,
        HEYBE_BOXLITE_PROXY_PORT: "0",
        HEYBE_BOXLITE_PROXY_STRIP_AUTO_REMOVE: "1",
        HEYBE_BOXLITE_CLIENT_KEY: CLIENT,
        HEYBE_BOXLITE_UPSTREAM_KEY: UPSTREAM,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      const url = await new Promise<string>((resolve, reject) => {
        let out = "";
        child.stdout.on("data", (d) => {
          out += d.toString();
          const m = /READY (\S+)/.exec(out);
          if (m) resolve(m[1]);
        });
        child.on("exit", (c) => reject(new Error(`exited ${c}`)));
      });
      expect(child.spawnargs.join(" ")).not.toContain(CLIENT);
      const r = await send(`${url}/v1/boxes`, { method: "POST", body: '{"image":"x","auto_remove":true}' });
      expect(r.status).toBe(201);
      expect(JSON.parse(up.seen.at(-1)!.body.toString())).toEqual({ image: "x", network: DISABLED });
    } finally {
      child.kill("SIGTERM");
    }
  }, 20_000);
});
