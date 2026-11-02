#!/usr/bin/env node
/* global process */
// Stand-in for `fastclaw` in tests: serves /healthz on FASTCLAW_PORT, records its pid.
import http from "node:http";
import { writeFileSync } from "node:fs";
// FASTCLAW_HOME is on the child-env whitelist; tests point it at a pid file path.
if (process.env.FASTCLAW_HOME?.endsWith(".pid")) writeFileSync(process.env.FASTCLAW_HOME, String(process.pid));
http.createServer((_q, r) => r.end("ok")).listen(Number(process.env.FASTCLAW_PORT), "127.0.0.1");
