import { existsSync, readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";

import type Database from "better-sqlite3";
import type { ArtifactRef } from "@heybe/shared-types";
import type { NodeRecord } from "@heybe/shared-types/task-manager";

import { sha256Hex } from "./artifacts.js";
import { immediate } from "./db.js";
import { ConflictError, NotFoundError } from "./errors.js";
import { insertEvent } from "./events.js";
import { applyNodeTransition, requireNode } from "./nodes.js";
import { requireTask } from "./tasks.js";
import { isoNow } from "./time.js";

/**
 * #23 T1.4.3 产物目录与待验收流程。
 *
 * - 产物按 `<root>/<taskId>/<attemptId>/<name>` 分目录，入库时记 sha256（artifacts 表）。
 * - Agent 说“完成”只能进 awaiting_review（state-machine.ts 禁止 running → completed）。
 * - 人工验收（acceptNode）前重新核对：声明的交付物都有记录、文件还在、校验值一致；
 *   任何一项不过就不能标成功，节点转 needs_check 并记下缺什么。
 */
export const ReviewEventType = {
  ArtifactRecorded: "artifact_recorded",
  ReviewAccepted: "review_accepted",
  ReviewRejected: "review_rejected",
  ReviewBlocked: "review_blocked",
} as const;

interface ArtifactRow {
  id: string;
  task_id: string;
  node_id: string | null;
  attempt_id: string | null;
  path: string;
  sha256: string;
  version: number;
  official: number;
  created_at: string;
}

export interface ArtifactRecord extends ArtifactRef {
  name: string;
  createdAt: string;
}

function mapArtifact(row: ArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    nodeId: row.node_id ?? undefined,
    attemptId: row.attempt_id ?? undefined,
    path: row.path,
    name: basename(row.path),
    sha256: row.sha256,
    version: row.version,
    official: row.official === 1,
    createdAt: row.created_at,
  };
}

export interface RecordArtifactInput {
  taskId: string;
  nodeId?: string;
  attemptId?: string;
  path: string;
  sha256: string;
  now?: string;
}

/** Insert one artifact row. `version` counts per task+file name (retries get v2, v3 …). */
export function recordArtifact(db: Database.Database, input: RecordArtifactInput): ArtifactRecord {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error("sha256 must be 64 hex chars");
  const now = input.now ?? isoNow();
  const name = basename(input.path);
  const rows = db.prepare("SELECT path, version FROM artifacts WHERE task_id = ?").all(input.taskId) as {
    path: string;
    version: number;
  }[];
  const version = rows.filter((r) => basename(r.path) === name).reduce((m, r) => Math.max(m, r.version), 0) + 1;
  const id = randomUUID();
  db.prepare(`
    INSERT INTO artifacts (id, task_id, node_id, attempt_id, path, sha256, version, official, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, input.taskId, input.nodeId ?? null, input.attemptId ?? null, input.path, input.sha256, version, now);
  insertEvent(db, {
    taskId: input.taskId,
    nodeId: input.nodeId,
    attemptId: input.attemptId,
    type: ReviewEventType.ArtifactRecorded,
    data: { name, sha256: input.sha256, version },
    at: now,
  });
  return mapArtifact(db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow);
}

export function listArtifacts(db: Database.Database, taskId: string): ArtifactRecord[] {
  const rows = db.prepare("SELECT * FROM artifacts WHERE task_id = ? ORDER BY rowid ASC").all(taskId) as ArtifactRow[];
  return rows.map(mapArtifact);
}

export type ArtifactProblemCode = "artifact_not_recorded" | "artifact_file_missing" | "artifact_checksum_mismatch";

export interface ArtifactProblem {
  name: string;
  code: ArtifactProblemCode;
  message: string;
}

export interface ArtifactCheck {
  ok: boolean;
  attemptId: string | null;
  artifacts: ArtifactRecord[];
  problems: ArtifactProblem[];
}

/** Deliverables may be prose ("一份摘要"); only names like `report.md` are treated as required files. */
export function isFileName(value: string): boolean {
  return /^[\w-][\w.-]{0,127}\.[A-Za-z0-9]{1,10}$/.test(value) && !value.includes("..");
}

function latestAttemptId(db: Database.Database, nodeId: string): string | null {
  const row = db.prepare(
    "SELECT id FROM attempts WHERE node_id = ? AND invalidated = 0 ORDER BY rowid DESC LIMIT 1",
  ).get(nodeId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Check a node's artifacts from its latest live attempt.
 * `expected` defaults to the task's `deliverables` (file names).
 */
export function checkNodeArtifacts(
  db: Database.Database,
  nodeId: string,
  opts: { expected?: readonly string[] } = {},
): ArtifactCheck {
  const node = requireNode(db, nodeId);
  const expected = opts.expected ?? requireTask(db, node.taskId).deliverables.filter(isFileName);
  const attemptId = latestAttemptId(db, nodeId);
  const all = listArtifacts(db, node.taskId).filter(
    (a) => a.nodeId === nodeId && (attemptId === null || a.attemptId === attemptId),
  );
  // Newest row per name wins.
  const byName = new Map<string, ArtifactRecord>();
  for (const a of all) byName.set(a.name, a);
  const problems: ArtifactProblem[] = [];
  for (const name of expected) {
    if (!byName.has(name)) problems.push({ name, code: "artifact_not_recorded", message: `缺少产物 ${name}` });
  }
  for (const a of byName.values()) {
    if (!existsSync(a.path) || !statSync(a.path).isFile()) {
      problems.push({ name: a.name, code: "artifact_file_missing", message: `产物文件不见了：${a.name}` });
      continue;
    }
    if (sha256Hex(readFileSync(a.path)) !== a.sha256) {
      problems.push({ name: a.name, code: "artifact_checksum_mismatch", message: `产物校验值不一致：${a.name}` });
    }
  }
  return { ok: problems.length === 0, attemptId, artifacts: [...byName.values()], problems };
}

export interface ReviewResult {
  node: NodeRecord;
  check: ArtifactCheck;
  accepted: boolean;
}

/**
 * Human acceptance. Only from awaiting_review (or needs_check after a fix).
 * Files missing / changed → needs_check, never completed.
 */
export function acceptNode(
  db: Database.Database,
  nodeId: string,
  opts: { expected?: readonly string[]; now?: string; note?: string } = {},
): ReviewResult {
  return immediate(db, () => {
    const current = requireNode(db, nodeId);
    if (current.status !== "awaiting_review" && current.status !== "needs_check") {
      throw new ConflictError(`node ${nodeId} is ${current.status}, not awaiting_review`);
    }
    const now = opts.now ?? isoNow();
    const check = checkNodeArtifacts(db, nodeId, { expected: opts.expected });
    if (!check.ok) {
      insertEvent(db, {
        taskId: current.taskId,
        nodeId,
        attemptId: check.attemptId ?? undefined,
        type: ReviewEventType.ReviewBlocked,
        data: { problems: check.problems },
        at: now,
      });
      const node = current.status === "needs_check"
        ? current
        : applyNodeTransition(db, nodeId, "needs_check", { now, data: { reason: "artifacts_invalid" } });
      return { node, check, accepted: false };
    }
    const mark = db.prepare("UPDATE artifacts SET official = 1 WHERE id = ?");
    for (const a of check.artifacts) mark.run(a.id);
    insertEvent(db, {
      taskId: current.taskId,
      nodeId,
      attemptId: check.attemptId ?? undefined,
      type: ReviewEventType.ReviewAccepted,
      data: { artifacts: check.artifacts.map((a) => ({ name: a.name, sha256: a.sha256, version: a.version })), note: opts.note ?? null },
      at: now,
    });
    const node = applyNodeTransition(db, nodeId, "completed", { now });
    return { node, check: { ...check, artifacts: check.artifacts.map((a) => ({ ...a, official: true })) }, accepted: true };
  });
}

/** Reject: `rework` puts the node back to pending (a new attempt), otherwise failed. */
export function rejectNode(
  db: Database.Database,
  nodeId: string,
  opts: { reason?: string; rework?: boolean; now?: string } = {},
): NodeRecord {
  return immediate(db, () => {
    const current = requireNode(db, nodeId);
    if (current.status !== "awaiting_review" && current.status !== "needs_check") {
      throw new ConflictError(`node ${nodeId} is ${current.status}, not awaiting_review`);
    }
    const now = opts.now ?? isoNow();
    insertEvent(db, {
      taskId: current.taskId,
      nodeId,
      type: ReviewEventType.ReviewRejected,
      data: { reason: opts.reason ?? null, rework: opts.rework === true },
      at: now,
    });
    return applyNodeTransition(db, nodeId, opts.rework ? "pending" : "failed", { now });
  });
}

export function requireArtifact(db: Database.Database, id: string): ArtifactRecord {
  const row = db.prepare("SELECT * FROM artifacts WHERE id = ?").get(id) as ArtifactRow | undefined;
  if (!row) throw new NotFoundError(`artifact not found: ${id}`);
  return mapArtifact(row);
}
