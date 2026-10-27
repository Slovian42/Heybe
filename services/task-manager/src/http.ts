import http from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import type Database from "better-sqlite3";
import type { Budget } from "@heybe/shared-types";
import type { CreateNodeInput, CreateTaskInput } from "@heybe/shared-types/task-manager";

import { LOOPBACK_HOST } from "./constants.js";
import {
  ConflictError,
  IdempotencyConflictError,
  IllegalStateTransitionError,
  NotFoundError,
  ValidationError,
} from "./errors.js";
import { EventRepository } from "./events.js";
import { NodeRepository } from "./nodes.js";
import { TaskRepository } from "./tasks.js";

const MAX_BODY = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

function statusFor(error: unknown): number {
  if (error instanceof NotFoundError) return 404;
  if (error instanceof ValidationError) return 400;
  if (
    error instanceof IdempotencyConflictError
    || error instanceof ConflictError
    || error instanceof IllegalStateTransitionError
  ) return 409;
  if (error instanceof SyntaxError) return 400;
  return 500;
}

function errorMessage(error: unknown): string {
  if (statusFor(error) === 500) return "internal error";
  return error instanceof Error ? error.message : "internal error";
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const ok = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new ValidationError("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function asRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string`);
  return value;
}

function optionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  return value;
}

function optionalTimeout(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative integer`);
  }
  return value;
}

function parseNode(value: unknown, index: number): CreateNodeInput {
  const row = asRecord(value, `nodes[${index}]`);
  const assigned = row.assignedAgentId;
  let assignedAgentId: string | null | undefined;
  if (assigned === undefined) assignedAgentId = undefined;
  else if (assigned === null) assignedAgentId = null;
  else if (typeof assigned === "string") assignedAgentId = assigned;
  else throw new ValidationError(`nodes[${index}].assignedAgentId must be a string or null`);
  return {
    id: optionalString(row.id, `nodes[${index}].id`),
    dependsOn: optionalStringArray(row.dependsOn, `nodes[${index}].dependsOn`),
    assignedAgentId,
    requiredCapabilities: optionalStringArray(row.requiredCapabilities, `nodes[${index}].requiredCapabilities`),
    fallbackAgentIds: optionalStringArray(row.fallbackAgentIds, `nodes[${index}].fallbackAgentIds`),
    acceptanceCriteria: optionalString(row.acceptanceCriteria, `nodes[${index}].acceptanceCriteria`),
    timeoutSec: optionalTimeout(row.timeoutSec, `nodes[${index}].timeoutSec`),
  };
}

function parseNodes(value: unknown): CreateNodeInput[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new ValidationError("nodes must be an array");
  return value.map(parseNode);
}

function parseCreateBody(value: unknown, headerKey: string | undefined): CreateTaskInput {
  const body = asRecord(value, "body");
  const bodyKey = optionalString(body.idempotencyKey, "idempotencyKey");
  if (headerKey !== undefined && bodyKey !== undefined && headerKey !== bodyKey) {
    throw new ValidationError("Idempotency-Key header does not match idempotencyKey");
  }
  const budget = body.budget;
  if (budget !== undefined && (!budget || typeof budget !== "object" || Array.isArray(budget))) {
    throw new ValidationError("budget must be an object");
  }
  return {
    goal: optionalString(body.goal, "goal") ?? "",
    deliverables: optionalStringArray(body.deliverables, "deliverables"),
    budget: budget as Budget | undefined,
    authorizationScope: optionalStringArray(body.authorizationScope, "authorizationScope"),
    idempotencyKey: headerKey ?? bodyKey,
    routineRunId: optionalString(body.routineRunId, "routineRunId"),
    sourceEventKey: optionalString(body.sourceEventKey, "sourceEventKey"),
    nodes: parseNodes(body.nodes),
  };
}

function decodeId(raw: string): string {
  let id: string;
  try {
    id = decodeURIComponent(raw);
  } catch {
    throw new ValidationError("invalid task id");
  }
  if (id.length === 0 || id.length > 200) throw new ValidationError("invalid task id");
  return id;
}

export interface TaskHttpOptions {
  port?: number;
  host?: string;
  /**
   * Called after a task is cancelled; should drop in-flight executor connections
   * (e.g. FastClawNodeExecutor.abortTask) and return how many were aborted.
   */
  onCancel?: (taskId: string) => number;
}

async function handle(
  db: Database.Database,
  req: IncomingMessage,
  res: ServerResponse,
  opts: TaskHttpOptions = {},
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`);
  const method = req.method ?? "GET";
  const tasks = new TaskRepository(db);
  const nodes = new NodeRepository(db);
  const events = new EventRepository(db);

  if (method === "POST" && url.pathname === "/tasks") {
    const raw = await readBody(req);
    const header = req.headers["idempotency-key"];
    const headerKey = Array.isArray(header) ? header[0] : header;
    const parsed = raw.length === 0 ? {} : JSON.parse(raw) as unknown;
    const created = tasks.create(parseCreateBody(parsed, headerKey));
    sendJson(res, created.created ? 201 : 200, created);
    return;
  }

  const one = /^\/tasks\/([^/]+)$/.exec(url.pathname);
  if (one && method === "GET") {
    const id = decodeId(one[1] ?? "");
    const task = tasks.get(id);
    if (!task) throw new NotFoundError(`task not found: ${id}`);
    sendJson(res, 200, { task, nodes: nodes.listByTask(id), events: events.listByTask(id) });
    return;
  }

  const cancel = /^\/tasks\/([^/]+)\/cancel$/.exec(url.pathname);
  if (cancel && method === "POST") {
    const id = decodeId(cancel[1] ?? "");
    const raw = await readBody(req);
    const parsed = raw.length === 0 ? {} : asRecord(JSON.parse(raw) as unknown, "body");
    const reason = optionalString(parsed.reason, "reason");
    const task = tasks.cancel(id, { reason });
    const aborted = opts.onCancel ? opts.onCancel(id) : 0;
    sendJson(res, 200, {
      task,
      aborted,
      // FastClaw v1.4.0 has no /v1 stop: dropping the connection does not prove the run stopped.
      serverStopped: aborted > 0 ? "unknown" : null,
      nodes: nodes.listByTask(id),
      events: events.listByTask(id),
      dispatch: "stopped",
    });
    return;
  }

  if (one || cancel) {
    sendJson(res, 405, { error: "method not allowed" });
    return;
  }
  sendJson(res, 404, { error: "not found" });
}

export function startTaskHttpServer(
  db: Database.Database,
  opts: TaskHttpOptions = {},
): Promise<Server> {
  const host = opts.host ?? LOOPBACK_HOST;
  if (host !== LOOPBACK_HOST) {
    return Promise.reject(new Error(`task manager HTTP server only listens on ${LOOPBACK_HOST}`));
  }
  const server = http.createServer((req, res) => {
    void handle(db, req, res, opts).catch((error: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendJson(res, statusFor(error), { error: errorMessage(error) });
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, host, () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

export async function stopTaskHttpServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
