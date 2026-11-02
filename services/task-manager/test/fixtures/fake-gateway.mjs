#!/usr/bin/env node
/* global process */
// Stand-in for `fastclaw` in tests. Like FastClaw v1.4.0, only `fastclaw gateway --port N` runs a
// foreground gateway; a bare `fastclaw` with /dev/null stdio takes the chat/TUI path and fails
// without a TTY (cmd/fastclaw/main.go RunE + cmd_chat.go isInteractiveTerminal), so mimic that.
import http from "node:http";
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
if (args[0] !== "gateway") {
  process.stderr.write("Starting FastClaw gateway…\nError: could not open a new TTY: open /dev/tty: device not configured\n");
  process.exit(1);
}
const i = args.indexOf("--port");
const port = Number(i >= 0 ? args[i + 1] : process.env.FASTCLAW_PORT);
// FASTCLAW_HOME is on the child-env whitelist; tests point it at a pid file path.
if (process.env.FASTCLAW_HOME?.endsWith(".pid")) writeFileSync(process.env.FASTCLAW_HOME, String(process.pid));
http.createServer((_q, r) => r.end("ok")).listen(port, "127.0.0.1");
