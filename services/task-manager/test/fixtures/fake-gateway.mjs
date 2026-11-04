#!/usr/bin/env node
/* global process, setInterval, setTimeout */
// Stand-in for `fastclaw` in tests. Like FastClaw v1.4.0, only `fastclaw gateway --port N` runs a
// foreground gateway; a bare `fastclaw` with /dev/null stdio takes the chat/TUI path and fails
// without a TTY (cmd/fastclaw/main.go RunE + cmd_chat.go isInteractiveTerminal), so mimic that.
//
// Behaviour knobs (FASTCLAW_HOME is on the child-env whitelist, so tests use it):
// - FASTCLAW_HOME ending in .pid: write our pid there.
// - FASTCLAW_HOME a dir with fake.json: {cliVersion, statusVersion, readyAfterMs, neverReady, bindError, exitWith, recordEnv}
// - recordEnv: write env.json (env names + sandbox settings, BOXLITE_API_KEY length only) for `gateway`.
// - `agents config <agent> get|set <key> [value]` (camoufox-cli check): values live in config.json,
//   every call is appended to config-calls.jsonl ({argv, envNames}). Knobs: configSetExit (set fails
//   with that exit code), configReadback (get always prints this), configAgents (known agents;
//   default any agt_* id) → "agent not found" exit 1 like FC agentcli.Resolve.
import http from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.FASTCLAW_HOME ?? "";
const knobsFile = join(home, "fake.json");
const k = home && existsSync(knobsFile) ? JSON.parse(readFileSync(knobsFile, "utf8")) : {};
const args = process.argv.slice(2);

if (args[0] === "version") {
  process.stdout.write(`FastClaw ${k.cliVersion ?? "v1.4.0"}\n  commit: fake\n`);
  process.exit(0);
}
if (args[0] === "agents" && args[1] === "config") {
  const [, , agent, op, key, value] = args;
  if (home && !home.endsWith(".pid")) {
    appendFileSync(join(home, "config-calls.jsonl"), JSON.stringify({ argv: args, envNames: Object.keys(process.env).sort() }) + "\n");
  }
  const known = k.configAgents ? k.configAgents.includes(agent) : /^agt_/.test(agent ?? "");
  if (!known) {
    process.stderr.write(`Error: agent not found: ${agent}\n`);
    process.exit(1);
  }
  const file = join(home, "config.json");
  const state = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (op === "set") {
    if (k.configSetExit) {
      process.stderr.write("Error: database is locked\n");
      process.exit(k.configSetExit);
    }
    state[key] = value === "false" ? false : value === "true" ? true : value;
    writeFileSync(file, JSON.stringify(state));
    process.stdout.write(`Set ${key}\n`);
    process.exit(0);
  }
  if (op === "get") {
    const v = k.configReadback ?? (key in state ? (typeof state[key] === "string" ? state[key] : JSON.stringify(state[key])) : "null");
    process.stdout.write(`${v}\n`);
    process.exit(0);
  }
  process.exit(1);
}
if (args[0] !== "gateway") {
  process.stderr.write("Starting FastClaw gateway…\nError: could not open a new TTY: open /dev/tty: device not configured\n");
  process.exit(1);
}
const i = args.indexOf("--port");
const port = Number(i >= 0 ? args[i + 1] : process.env.FASTCLAW_PORT);
if (home.endsWith(".pid")) writeFileSync(home, String(process.pid));
if (k.recordEnv) {
  const sandbox = Object.fromEntries(Object.entries(process.env).filter(([n]) => n.startsWith("FASTCLAW_SANDBOX_") || n === "FASTCLAW_DEPLOY"));
  writeFileSync(
    join(home, "env.json"),
    JSON.stringify({ names: Object.keys(process.env).sort(), sandbox, apiKeyLength: (process.env.BOXLITE_API_KEY ?? "").length }),
  );
}
if (k.exitWith !== undefined) {
  process.stderr.write("fake: config broken\n");
  process.exit(k.exitWith);
} else if (k.bindError) {
  // FastClaw logs the bind failure and keeps running without a listener.
  process.stderr.write(`level=ERROR msg="web server error" error="listen tcp 127.0.0.1:${port}: bind: address already in use"\n`);
  setInterval(() => undefined, 1000);
} else if (k.neverReady) {
  setInterval(() => undefined, 1000);
} else {
  setTimeout(() => {
    http
      .createServer((q, r) => {
        if (q.url === "/api/status") {
          r.setHeader("content-type", "application/json");
          r.end(JSON.stringify({ version: k.statusVersion ?? "dev", port }));
        } else r.end("ok");
      })
      .listen(port, "127.0.0.1");
  }, k.readyAfterMs ?? 0);
}
