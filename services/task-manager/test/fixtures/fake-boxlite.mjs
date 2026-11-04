#!/usr/bin/env node
/* global process, Buffer */
// Fake `boxlite serve` for sandbox.test.ts. Mimics BoxLite v0.10.7 serve auth + create-body checks.
// Writes what it saw (argv, env names, a hash of the key — never the key) to $BOXLITE_HOME.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import { join } from "node:path";

const home = process.env.BOXLITE_HOME;
const mode = existsSync(join(home, "mode")) ? readFileSync(join(home, "mode"), "utf8").trim() : "";
if (mode === "exit") {
  process.stderr.write("fake boxlite: refusing to start\n");
  process.exit(3);
}
const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1]);
// Like real serve: with BOXLITE_SERVE_API_KEY set, everything but GET /v1/config needs it; without
// it, serve runs open (200). "nokey" ignores the key it was given (= a wrong variable name upstream);
// "postopen" enforces it on GET only (a partial-auth regression).
const key = mode === "nokey" ? undefined : process.env.BOXLITE_SERVE_API_KEY;
writeFileSync(
  join(home, "record.json"),
  JSON.stringify({
    argv: args,
    pid: process.pid,
    envNames: Object.keys(process.env).sort(),
    keySha: process.env.BOXLITE_SERVE_API_KEY ? createHash("sha256").update(process.env.BOXLITE_SERVE_API_KEY).digest("hex") : null,
  }),
);
const boxes = new Map();
const execs = new Map();
const frame = (text) => {
  const p = Buffer.from(text);
  const h = p.length < 126 ? Buffer.from([0x81, p.length]) : Buffer.from([0x81, 126, p.length >> 8, p.length & 255]);
  return Buffer.concat([h, p]);
};
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const send = (code, obj) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(obj));
    };
    if (req.url === "/v1/config") return send(200, { version: "fake" });
    const open = mode === "postopen" && req.method === "POST";
    if (key && !open && req.headers.authorization !== `Bearer ${key}`) return send(401, { error: { message: "unauthorized", code: 401 } });
    if (req.method === "POST" && req.url === "/v1/boxes") {
      const text = Buffer.concat(chunks).toString();
      appendFileSync(join(home, "boxes.jsonl"), text + "\n");
      const body = JSON.parse(text);
      if ("auto_remove" in body) return send(400, { error: { message: "unknown field `auto_remove`, expected one of `image`, `network`" } });
      if (!body.image && !("auto_remove" in body)) return send(400, { error: { message: "missing field `image`" } });
      if (typeof body.cpus === "string") return send(400, { error: { message: "invalid type: string, expected u8 at cpus" } });
      boxes.set("box_fake", body);
      return send(201, { box_id: "box_fake" });
    }
    let m;
    if (req.method === "POST" && (m = req.url.match(/^\/v1\/boxes\/([^/]+)\/start$/))) return boxes.has(m[1]) ? send(204, {}) : send(404, {});
    if (req.method === "POST" && (m = req.url.match(/^\/v1\/boxes\/([^/]+)\/exec$/))) {
      if (!boxes.has(m[1])) return send(404, {});
      const ex = JSON.parse(Buffer.concat(chunks).toString());
      appendFileSync(join(home, "exec.jsonl"), JSON.stringify(ex) + "\n");
      execs.set("exe_fake", { box: m[1], cmd: ex.args?.[1] ?? "" });
      return send(201, { execution_id: "exe_fake" });
    }
    if (req.method === "DELETE" && (m = req.url.match(/^\/v1\/boxes\/([^/?]+)\?force=true$/))) {
      appendFileSync(join(home, "deleted.txt"), m[1] + "\n");
      return boxes.delete(m[1]) ? send(204, {}) : send(404, {});
    }
    if (req.method === "GET" && req.url === "/v1/boxes") return send(200, { boxes: [] });
    send(404, { error: { message: "not found" } });
  });
});
// WS attach: probe output depends on the box's network, like a real VM ("leaky" ignores it).
server.on("upgrade", (req, sock) => {
  const m = req.url.match(/^\/v1\/boxes\/([^/]+)\/executions\/([^/]+)\/attach$/);
  if ((key && req.headers.authorization !== `Bearer ${key}`) || !m || !execs.has(m[2])) {
    sock.end("HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const net = boxes.get(m[1])?.network?.outbound?.mode;
  const blocked = net === "disabled" && mode !== "leaky";
  const r = (open) => (blocked ? "NET_BLOCKED" : open);
  const port = (execs.get(m[2]).cmd.match(/host\.boxlite\.internal:(\d+)/) ?? [])[1];
  const out = `CURL=yes\nEXT=${r("OPEN")}\nHOST8100=${r("OPEN")}\nHOST11434=${r("OPEN")}\nDNS=${r("RESOLVED")}\nPORT=${port}\n`;
  sock.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
  sock.write(frame(JSON.stringify({ type: "stdout", data: out })));
  sock.write(frame(JSON.stringify({ type: "exit", exit_code: 0 })));
  sock.end(Buffer.from([0x88, 0]));
});
server.listen(port, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
