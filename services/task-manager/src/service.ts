// 19-b: the local Heybe service started by the desktop shell.
// Listens on 127.0.0.1:<random port>, requires the startup token, serves chat (default on)
// and tasks, and optionally owns the FastClaw gateway. Never logs tokens.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { fastClawClientFromEnv, type FastClawClient } from "@heybe/fastclaw-adapter";

import { fastClawChatStream, type ChatStreamFn } from "./chat.js";
import { openTaskDb } from "./db.js";
import { startGateway, type GatewayHandle } from "./gateway.js";
import { startTaskHttpServer, stopTaskHttpServer } from "./http.js";

export const READY_PREFIX = "HEYBE_SERVICE_READY ";
export const MIN_TOKEN_LENGTH = 32;

export interface HeybeService {
  port: number;
  /** Rejects/resolves when the owned gateway dies; undefined when no gateway is owned. */
  gatewayExited?: Promise<number | null>;
  stop(): Promise<void>;
}

export interface ServiceDeps {
  chat?: ChatStreamFn;
  startGateway?: typeof startGateway;
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
  const bin = env.HEYBE_FASTCLAW_GATEWAY_BIN?.trim();
  if (bin) {
    const fcPort = env.FASTCLAW_PORT?.trim() || "18953";
    const portNum = Number(fcPort);
    if (!Number.isInteger(portNum) || portNum <= 0 || portNum > 65535) throw new Error("FASTCLAW_PORT invalid");
    gateway = await (deps.startGateway ?? startGateway)({
      bin,
      port: portNum,
      env,
      healthUrl: `http://127.0.0.1:${fcPort}/healthz`,
    });
  }

  const db = openTaskDb(env.HEYBE_TASK_DB?.trim() || ":memory:");
  let server: Server;
  try {
    server = await startTaskHttpServer(db, { port, token, chat: deps.chat ?? chatFromEnv(env) });
  } catch (err) {
    db.close();
    await gateway?.stop();
    throw err;
  }

  let stopped = false;
  return {
    port: (server.address() as AddressInfo).port,
    gatewayExited: gateway?.exited,
    async stop() {
      if (stopped) return;
      stopped = true;
      await stopTaskHttpServer(server);
      db.close();
      await gateway?.stop();
    },
  };
}
