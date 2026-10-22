import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { Budget, TaskStatus } from "@heybe/shared-types";
import type { CreateNodeInput, CreateTaskInput, NodeRecord, TaskRecord } from "@heybe/shared-types/task-manager";

import { EventType } from "./constants.js";
import { immediate } from "./db.js";
import {
  ConflictError,
  IdempotencyConflictError,
  NotFoundError,
  ValidationError,
  isUniqueConstraint,
} from "./errors.js";
import { insertEvent } from "./events.js";
import { type TaskRow, mapTask } from "./map.js";
import { insertNode, listNodes, type PreparedNode } from "./nodes.js";
import { assertTransition } from "./state-machine.js";
import { isoNow } from "./time.js";

export interface CreateTaskResult {
  task: TaskRecord;
  nodes: NodeRecord[];
  created: boolean;
}

export interface CancelTaskOptions {
  now?: string;
  reason?: string;
}

const TASK_SELECT = "SELECT * FROM tasks WHERE id = ?";

export function getTask(db: Database.Database, id: string): TaskRecord | null {
  const row = db.prepare(TASK_SELECT).get(id) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

export function requireTask(db: Database.Database, id: string): TaskRecord {
  const task = getTask(db, id);
  if (!task) throw new NotFoundError(`task not found: ${id}`);
  return task;
}

export function findTaskByIdempotencyKey(db: Database.Database, key: string): TaskRecord | null {
  const row = db.prepare("SELECT * FROM tasks WHERE idempotency_key = ?").get(key) as TaskRow | undefined;
  return row ? mapTask(row) : null;
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function assertStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ValidationError(`${field} must be an array of strings`);
  }
  return value;
}

function prepareNodes(nodes: CreateNodeInput[]): PreparedNode[] {
  const prepared: PreparedNode[] = nodes.map((node) => ({
    id: node.id ?? randomUUID(),
    dependsOn: node.dependsOn ?? [],
    assignedAgentId: node.assignedAgentId ? node.assignedAgentId : null,
    requiredCapabilities: node.requiredCapabilities ?? [],
    fallbackAgentIds: node.fallbackAgentIds ?? [],
    acceptanceCriteria: node.acceptanceCriteria ?? "",
    timeoutSec: node.timeoutSec ?? null,
  }));
  const ids = new Set<string>();
  for (const node of prepared) {
    if (node.id.length === 0 || node.id.length > 200) throw new ValidationError("invalid node id");
    if (ids.has(node.id)) throw new ValidationError(`duplicate node id ${node.id}`);
    ids.add(node.id);
    if (node.timeoutSec != null && (!Number.isInteger(node.timeoutSec) || node.timeoutSec < 0)) {
      throw new ValidationError("timeoutSec must be a non-negative integer");
    }
  }
  for (const node of prepared) {
    for (const dep of node.dependsOn) {
      if (typeof dep !== "string" || dep.length === 0) throw new ValidationError("invalid dependency id");
      if (dep === node.id) throw new ValidationError("node depends on itself");
      if (!ids.has(dep)) throw new ValidationError(`unknown dependency ${dep}`);
    }
  }
  return prepared;
}

export function validateCreateInput(input: CreateTaskInput): void {
  if (typeof input.goal !== "string" || input.goal.trim() === "") {
    throw new ValidationError("goal is required");
  }
  if (input.idempotencyKey !== undefined) {
    if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 200) {
      throw new ValidationError("invalid idempotencyKey");
    }
  }
  for (const [value, field] of [
    [input.routineRunId, "routineRunId"],
    [input.sourceEventKey, "sourceEventKey"],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.length === 0 || value.length > 200)) {
      throw new ValidationError(`invalid ${field}`);
    }
  }
  assertStringArray(input.deliverables, "deliverables");
  assertStringArray(input.authorizationScope, "authorizationScope");
  if (input.budget !== undefined) {
    if (!input.budget || typeof input.budget !== "object" || Array.isArray(input.budget)) {
      throw new ValidationError("budget must be an object");
    }
  }
  if (input.nodes !== undefined) {
    if (!Array.isArray(input.nodes)) throw new ValidationError("nodes must be an array");
    prepareNodes(input.nodes);
  }
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function payloadMatches(existing: TaskRecord, nodes: NodeRecord[], input: CreateTaskInput): boolean {
  if (existing.goal !== input.goal) return false;
  if (input.deliverables !== undefined && !sameList(existing.deliverables, input.deliverables)) return false;
  if (input.budget !== undefined && stableStringify(existing.budget) !== stableStringify(input.budget)) return false;
  if (input.authorizationScope !== undefined && !sameList(existing.authorizationScope, input.authorizationScope)) return false;
  if (input.routineRunId !== undefined && existing.routineRunId !== input.routineRunId) return false;
  if (input.sourceEventKey !== undefined && existing.sourceEventKey !== input.sourceEventKey) return false;
  if (input.nodes === undefined) return true;
  if (nodes.length !== input.nodes.length) return false;
  for (let i = 0; i < nodes.length; i++) {
    const stored = nodes[i];
    const requested = input.nodes[i];
    if (!stored || !requested) return false;
    if (requested.id !== undefined && requested.id !== stored.id) return false;
    if (!sameList(stored.dependsOn, requested.dependsOn ?? [])) return false;
    const agent = requested.assignedAgentId ? requested.assignedAgentId : null;
    if (agent !== stored.assignedAgentId) return false;
    if (!sameList(stored.requiredCapabilities, requested.requiredCapabilities ?? [])) return false;
    if (!sameList(stored.fallbackAgentIds, requested.fallbackAgentIds ?? [])) return false;
    if ((requested.acceptanceCriteria ?? "") !== stored.acceptanceCriteria) return false;
    if ((requested.timeoutSec ?? null) !== stored.timeoutSec) return false;
  }
  return true;
}

function replay(db: Database.Database, existing: TaskRecord, input: CreateTaskInput): CreateTaskResult {
  const nodes = listNodes(db, existing.id);
  if (!payloadMatches(existing, nodes, input)) {
    throw new IdempotencyConflictError(input.idempotencyKey ?? "");
  }
  return { task: existing, nodes, created: false };
}

function insertFresh(db: Database.Database, input: CreateTaskInput, now: string): CreateTaskResult {
  const id = randomUUID();
  const deliverables = input.deliverables ?? [];
  const budget: Budget = input.budget ?? {};
  const authorizationScope = input.authorizationScope ?? [];
  db.prepare(`
    INSERT INTO tasks (
      id, goal, deliverables_json, status, budget_json, authorization_scope_json,
      routine_run_id, source_event_key, idempotency_key, created_at, updated_at
    ) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.goal,
    JSON.stringify(deliverables),
    stableStringify(budget),
    JSON.stringify(authorizationScope),
    input.routineRunId ?? null,
    input.sourceEventKey ?? null,
    input.idempotencyKey ?? null,
    now,
    now,
  );
  for (const node of prepareNodes(input.nodes ?? [])) insertNode(db, id, node, now);
  insertEvent(db, {
    taskId: id,
    type: EventType.TaskCreated,
    data: { goal: input.goal, idempotencyKey: input.idempotencyKey ?? null },
    at: now,
  });
  return { task: requireTask(db, id), nodes: listNodes(db, id), created: true };
}

export function createTask(
  db: Database.Database,
  input: CreateTaskInput,
  opts?: { now?: string },
): CreateTaskResult {
  validateCreateInput(input);
  const now = opts?.now ?? isoNow();
  try {
    return immediate(db, () => {
      if (input.idempotencyKey) {
        const existing = findTaskByIdempotencyKey(db, input.idempotencyKey);
        if (existing) return replay(db, existing, input);
      }
      return insertFresh(db, input, now);
    });
  } catch (error) {
    if (input.idempotencyKey && isUniqueConstraint(error)) {
      const existing = findTaskByIdempotencyKey(db, input.idempotencyKey);
      if (existing) return replay(db, existing, input);
    }
    if (isUniqueConstraint(error)) throw new ConflictError("task unique key already exists");
    throw error;
  }
}

export function applyTaskTransition(
  db: Database.Database,
  id: string,
  to: TaskStatus,
  opts?: { now?: string; data?: Record<string, unknown> },
): TaskRecord {
  const current = requireTask(db, id);
  assertTransition(current.status, to);
  const now = opts?.now ?? isoNow();
  db.prepare("UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?").run(to, now, id);
  insertEvent(db, {
    taskId: id,
    type: EventType.TaskStatus,
    data: { from: current.status, to, ...(opts?.data ?? {}) },
    at: now,
  });
  return requireTask(db, id);
}

/**
 * Cancel stops dispatch of new nodes and records an event.
 * Nodes already claimed keep their status; their in-flight attempt can still finish.
 */
export function cancelTask(db: Database.Database, id: string, opts?: CancelTaskOptions): TaskRecord {
  return immediate(db, () => {
    const current = requireTask(db, id);
    if (current.status === "cancelled") return current;
    assertTransition(current.status, "cancelled");
    const now = opts?.now ?? isoNow();
    db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now, id);
    insertEvent(db, {
      taskId: id,
      type: EventType.TaskCancelled,
      data: { from: current.status, effect: "stop_dispatch", reason: opts?.reason ?? null },
      at: now,
    });
    return requireTask(db, id);
  });
}

export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): TaskRecord | null {
    return getTask(this.db, id);
  }

  create(input: CreateTaskInput, opts?: { now?: string }): CreateTaskResult {
    return createTask(this.db, input, opts);
  }

  transition(id: string, to: TaskStatus, opts?: { now?: string }): TaskRecord {
    return immediate(this.db, () => applyTaskTransition(this.db, id, to, opts));
  }

  cancel(id: string, opts?: CancelTaskOptions): TaskRecord {
    return cancelTask(this.db, id, opts);
  }
}
