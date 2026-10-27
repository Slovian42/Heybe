import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { TaskStatus } from "@heybe/shared-types";
import type { AttemptRecord, ExecutionOutcome, NodeRecord, TaskRecord } from "@heybe/shared-types/task-manager";

import { insertRunningAttempt, invalidateOpenAttempts } from "./attempts.js";
import { DEFAULT_LEASE_MS, DEFAULT_WORKER_SLOTS, EventType } from "./constants.js";
import { immediate } from "./db.js";
import { StaleExecutionError, ValidationError } from "./errors.js";
import { insertEvent } from "./events.js";
import { applyNodeTransition, loadNode, requireNode } from "./nodes.js";
import { assertTransition } from "./state-machine.js";
import { applyTaskTransition, requireTask } from "./tasks.js";
import { addMs, isoNow } from "./time.js";

export interface ClaimedWork {
  task: TaskRecord;
  node: NodeRecord;
  attempt: AttemptRecord;
}

export interface ClaimOptions {
  owner: string;
  now?: string;
  leaseMs?: number;
  workerSlots?: number;
  /**
   * FastClaw agent id to backfill on nodes that have none. Never derived from
   * `owner` (a scheduler identity, not an agent). When omitted, the node stays
   * unassigned and the executor picks its own default agent.
   */
  agentId?: string;
}

/** Recorded on attempts whose node had no agent at claim time. */
export const UNASSIGNED_AGENT_ID = "unassigned";

export interface ApplyExecutionInput {
  nodeId: string;
  executionVersion: number;
  outcome: ExecutionOutcome;
  owner?: string;
  error?: string;
  checkpoint?: unknown;
  now?: string;
}

/**
 * Conditional claim. Two schedulers racing on the same expected version:
 * SQLite serializes the IMMEDIATE transactions and only one UPDATE matches.
 */
export const CLAIM_NODE_SQL = `
UPDATE nodes
SET status = 'running',
    execution_version = execution_version + 1,
    lease_owner = @owner,
    lease_expires_at = @expires,
    assigned_agent_id = COALESCE(assigned_agent_id, @agentId),
    updated_at = @now
WHERE id = @id
  AND execution_version = @expectedVersion
  AND (
    status IN ('pending', 'retry_wait')
    OR (
      status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at <= @now
    )
  )
`;

interface CandidateRow {
  id: string;
  task_id: string;
  status: string;
  execution_version: number;
  assigned_agent_id: string | null;
  depends_on_json: string;
}

function countActiveLeases(db: Database.Database, now: string): number {
  const row = db.prepare(`
    SELECT COUNT(*) AS c FROM nodes
    WHERE status = 'running'
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > ?
  `).get(now) as { c: number };
  return row.c;
}

function dependenciesMet(db: Database.Database, dependsOnJson: string): boolean {
  const parsed = JSON.parse(dependsOnJson) as unknown;
  if (!Array.isArray(parsed) || parsed.length === 0) return true;
  if (!parsed.every((id) => typeof id === "string")) return false;
  const ids = [...new Set(parsed)];
  const rows = db.prepare(
    `SELECT status FROM nodes WHERE id IN (${ids.map(() => "?").join(", ")})`,
  ).all(...ids) as { status: string }[];
  if (rows.length !== ids.length) return false;
  return rows.every((row) => row.status === "completed");
}

function selectCandidates(db: Database.Database, now: string): CandidateRow[] {
  return db.prepare(`
    SELECT n.id, n.task_id, n.status, n.execution_version, n.assigned_agent_id, n.depends_on_json
    FROM nodes n
    JOIN tasks t ON t.id = n.task_id
    WHERE t.status IN ('pending', 'running', 'retry_wait')
      AND (
        n.status IN ('pending', 'retry_wait')
        OR (
          n.status = 'running'
          AND n.lease_expires_at IS NOT NULL
          AND n.lease_expires_at <= ?
        )
      )
    ORDER BY n.created_at ASC, n.id ASC
    LIMIT 100
  `).all(now) as CandidateRow[];
}

export function claimNextNode(db: Database.Database, opts: ClaimOptions): ClaimedWork | null {
  if (typeof opts.owner !== "string" || opts.owner.trim() === "") {
    throw new ValidationError("owner is required");
  }
  const now = opts.now ?? isoNow();
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const workerSlots = opts.workerSlots ?? DEFAULT_WORKER_SLOTS;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new ValidationError("leaseMs must be positive");
  if (!Number.isInteger(workerSlots) || workerSlots < 1) {
    throw new ValidationError("workerSlots must be a positive integer");
  }
  const expires = addMs(now, leaseMs);

  return immediate(db, () => {
    if (countActiveLeases(db, now) >= workerSlots) return null;
    for (const candidate of selectCandidates(db, now)) {
      if (!dependenciesMet(db, candidate.depends_on_json)) continue;
      const status = candidate.status as TaskStatus;
      if (status !== "running") assertTransition(status, "running");
      const optAgent = opts.agentId?.trim() || null;
      const agentId = candidate.assigned_agent_id ?? optAgent;
      const info = db.prepare(CLAIM_NODE_SQL).run({
        owner: opts.owner,
        expires,
        now,
        id: candidate.id,
        expectedVersion: candidate.execution_version,
        agentId,
      });
      if (info.changes !== 1) continue;

      invalidateOpenAttempts(db, candidate.id, now);
      const executionVersion = candidate.execution_version + 1;
      const attempt = insertRunningAttempt(db, {
        id: randomUUID(),
        nodeId: candidate.id,
        agentId: agentId ?? UNASSIGNED_AGENT_ID,
        executionVersion,
        startedAt: now,
      });
      const taskRow = db.prepare("SELECT status FROM tasks WHERE id = ?").get(candidate.task_id) as { status: TaskStatus };
      if (taskRow.status === "pending" || taskRow.status === "retry_wait") {
        applyTaskTransition(db, candidate.task_id, "running", { now });
      }
      insertEvent(db, {
        taskId: candidate.task_id,
        nodeId: candidate.id,
        attemptId: attempt.id,
        type: EventType.NodeClaimed,
        data: { owner: opts.owner, executionVersion, agentId },
        at: now,
      });
      const node = loadNode(db, candidate.id);
      if (!node || node.executionVersion !== executionVersion) {
        throw new Error(`claim did not stick for node ${candidate.id}`);
      }
      return { task: requireTask(db, candidate.task_id), node, attempt };
    }
    return null;
  });
}

export function applyExecutionResult(db: Database.Database, input: ApplyExecutionInput): NodeRecord {
  const now = input.now ?? isoNow();
  const result = immediate(db, ():
    | { ok: true; node: NodeRecord }
    | { ok: false; actualVersion: number; leaseOwner: string | null } => {
    const node = requireNode(db, input.nodeId);
    const versionOk = node.executionVersion === input.executionVersion;
    const ownerOk = input.owner === undefined || node.leaseOwner === input.owner;
    if (!versionOk || !ownerOk) {
      return { ok: false, actualVersion: node.executionVersion, leaseOwner: node.leaseOwner };
    }
    const updated = applyNodeTransition(db, node.id, input.outcome, { now });
    const info = db.prepare(`
      UPDATE attempts
      SET status = ?, error = ?, checkpoint_json = ?, ended_at = ?
      WHERE node_id = ? AND execution_version = ? AND invalidated = 0
    `).run(
      input.outcome,
      input.error ?? null,
      input.checkpoint === undefined ? null : JSON.stringify(input.checkpoint),
      now,
      node.id,
      input.executionVersion,
    );
    if (info.changes !== 1) {
      throw new Error(`no live attempt for node ${node.id} version ${input.executionVersion}`);
    }
    insertEvent(db, {
      taskId: node.taskId,
      nodeId: node.id,
      type: EventType.AttemptFinished,
      data: { outcome: input.outcome, executionVersion: input.executionVersion },
      at: now,
    });
    return { ok: true, node: updated };
  });

  if (!result.ok) {
    const node = requireNode(db, input.nodeId);
    insertEvent(db, {
      taskId: node.taskId,
      nodeId: node.id,
      type: EventType.StaleResultRejected,
      data: {
        executionVersion: input.executionVersion,
        actualVersion: result.actualVersion,
        owner: input.owner ?? null,
      },
      at: now,
    });
    const message = input.executionVersion !== result.actualVersion
      ? `stale execution result for node ${input.nodeId}: version ${input.executionVersion} does not match ${result.actualVersion}`
      : `stale execution result for node ${input.nodeId}: lease owner mismatch`;
    throw new StaleExecutionError(message, input.nodeId, input.executionVersion, result.actualVersion);
  }
  return result.node;
}
