// 19-b: the local Heybe service started by the desktop shell.
// Listens on 127.0.0.1:<random port>, requires the startup token, serves chat (default on)
// and tasks, and optionally owns the FastClaw gateway. Never logs tokens.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { fastClawClientFromEnv, type FastClawClient } from "@heybe/fastclaw-adapter";

import { fastClawChatStream, type ChatStreamFn } from "./chat.js";
import { openTaskDb } from "./db.js";
import { SkillGuardError, camoufoxLogLine, ensureCamoufoxDisabled, type CliRunner } from "./fastclaw-skills.js";
import { startGateway, type GatewayHandle } from "./gateway.js";
import { startTaskHttpServer, stopTaskHttpServer } from "./http.js";
import { startSandbox, type SandboxHandle } from "./sandbox.js";

export const READY_PREFIX = "HEYBE_SERVICE_READY ";
/** Startup failure line on stdout: {"code","message","retryable"}; the shell shows `message`. */
export const ERROR_PREFIX = "HEYBE_SERVICE_ERROR ";

function msFromEnv(raw: string | undefined, fallback: number): number {
  const n = Number(raw?.trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
export const MIN_TOKEN_LENGTH = 32;

export interface HeybeService {
  port: number;
  /** Resolves when the owned gateway (or its BoxLite sandbox) dies; undefined when no gateway is owned. */
  gatewayExited?: Promise<number | null>;
  stop(): Promise<void>;
}

export interface ServiceDeps {
  chat?: ChatStreamFn;
  startGateway?: typeof startGateway;
  startSandbox?: typeof startSandbox;
  /** Startup camoufox-cli check (default: ensureSkillsAtStartup). */
  ensureSkills?: (opts: SkillStartupOptions) => Promise<void>;
}

export interface SkillStartupOptions {
  bin: string;
  env: Record<string, string | undefined>;
  run?: CliRunner;
  /** First agent id via GET /v1/agents (default: fastClawClientFromEnv(env)). undefined = none yet. */
  firstAgent?: () => Promise<string | undefined>;
  log?: (line: string) => void;
}

/**
 * Every start, after our gateway is ready: make sure camoufox-cli is off (fastclaw-skills.ts,
 * /v1-only exception 2). The setting is system scope, so any existing agent works as the CLI's
 * <agent> argument: HEYBE_FASTCLAW_AGENT_ID, else the first agent from GET /v1/agents. No agent
 * yet → skip (FastClawCliProvisioner turns it off when it creates one). No /v1 settings at all
 * (no HEYBE_FASTCLAW_BASE_URL) → skip too: nothing can chat through this service then.
 * Failure → SkillGuardError (E_FC_SKILL_DISABLE_FAILED); the caller stops the gateway.
 */
export async function ensureSkillsAtStartup(opts: SkillStartupOptions): Promise<void> {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const env = opts.env;
  let agent = env.HEYBE_FASTCLAW_AGENT_ID?.trim() || undefined;
  if (!agent) {
    const first =
      opts.firstAgent ??
      (env.HEYBE_FASTCLAW_BASE_URL?.trim()
        ? async () => (await fastClawClientFromEnv(env).listAgents({ limit: 1 })).agents[0]?.id
        : undefined);
    if (!first) {
      log(camoufoxLogLine("skipped_no_agent"));
      return;
    }
    try {
      agent = await first();
    } catch {
      throw new SkillGuardError("查不到 Agent 列表（GET /v1/agents 失败）");
    }
    if (!agent) {
      log(camoufoxLogLine("skipped_no_agent"));
      return;
    }
  }
  const outcome = await ensureCamoufoxDisabled(agent, { bin: opts.bin, run: opts.run, env });
  log(camoufoxLogLine(outcome, agent));
}

/** Lazily resolve the agent (HEYBE_FASTCLAW_AGENT_ID or the first /v1/agents entry). */
export function chatFromEnv(env: Record<string, string | undefined>): ChatStreamFn {
  let client: FastClawClient | undefined;
  let agentId = env.HEYBE_FASTCLAW_AGENT_ID?.trim() || undefined;
  return async function* (input) {
    client ??= fastClawClientFromEnv(env);
    if (!agentId) {
      const list = await client.listAgents({ limit: 1, signal: input.signal });
      agentId = list.agents[0]?.id;
      if (!agentId) throw Object.assign(new Error("no agent"), { kind: "4xx", code: "no_agent" });
    }
    yield* fastClawChatStream(client, agentId)(input);
  };
}

export async function startHeybeService(
  env: Record<string, string | undefined> = process.env,
  deps: ServiceDeps = {},
): Promise<HeybeService> {
  const token = env.HEYBE_SERVICE_TOKEN ?? "";
  if (token.length < MIN_TOKEN_LENGTH || /\s/.test(token)) {
    throw new Error(`HEYBE_SERVICE_TOKEN must be at least ${MIN_TOKEN_LENGTH} non-space characters`);
  }
  const port = Number(env.HEYBE_SERVICE_PORT ?? "0");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("HEYBE_SERVICE_PORT invalid");

  let gateway: GatewayHandle | undefined;
  let sandbox: SandboxHandle | undefined;
  const bin = env.HEYBE_FASTCLAW_GATEWAY_BIN?.trim();
  if (bin) {
    const fcPort = env.FASTCLAW_PORT?.trim() || "18953";
    const portNum = Number(fcPort);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) throw new Error("FASTCLAW_PORT invalid");
    // Opt-in BoxLite sandbox (sandbox.ts): serve + egress-disabling proxy first, then the gateway
    // gets the sandbox env (incl. the proxy client key) through child-env `set`, never argv.
    const boxliteBin = env.HEYBE_BOXLITE_BIN?.trim();
    if (boxliteBin) {
      sandbox = await (deps.startSandbox ?? startSandbox)({
        bin: boxliteBin,
        env,
        readyTimeoutMs: msFromEnv(env.HEYBE_BOXLITE_READY_TIMEOUT_MS, 20_000),
      });
    }
    try {
      gateway = await (deps.startGateway ?? startGateway)({
        bin,
        port: portNum,
        env,
        childEnv: sandbox?.gatewayEnv,
        readyTimeoutMs: msFromEnv(env.HEYBE_FASTCLAW_READY_TIMEOUT_MS, 30_000),
        healthUrl: `http://127.0.0.1:${fcPort}/healthz`,
      });
    } catch (err) {
      await sandbox?.stop();
      throw err;
    }
    try {
      await (deps.ensureSkills ?? ensureSkillsAtStartup)({ bin, env });
    } catch (err) {
      await gateway.stop();
      await sandbox?.stop();
      throw err instanceof SkillGuardError ? err : new SkillGuardError("检查时出错");
    }
  }

  const db = openTaskDb(env.HEYBE_TASK_DB?.trim() || ":memory:");
  let server: Server;
  try {
    server = await startTaskHttpServer(db, { port, token, chat: deps.chat ?? chatFromEnv(env) });
  } catch (err) {
    db.close();
    await gateway?.stop();
    await sandbox?.stop();
    throw err;
  }

  let stopped = false;
  return {
    port: (server.address() as AddressInfo).port,
    gatewayExited: gateway && sandbox ? Promise.race([gateway.exited, sandbox.exited]) : gateway?.exited,
    async stop() {
      if (stopped) return;
      stopped = true;
      await stopTaskHttpServer(server);
      db.close();
      await gateway?.stop();
      await sandbox?.stop();
    },
  };
}
