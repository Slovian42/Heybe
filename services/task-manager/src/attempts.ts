import type Database from "better-sqlite3";
import type { AttemptRecord } from "@heybe/shared-types/task-manager";

import { NotFoundError } from "./errors.js";
import { type AttemptRow, mapAttempt } from "./map.js";

const SELECT_ATTEMPT = "SELECT * FROM attempts WHERE id = ?";

export function getAttempt(db: Database.Database, id: string): AttemptRecord | null {
  const row = db.prepare(SELECT_ATTEMPT).get(id) as AttemptRow | undefined;
  return row ? mapAttempt(row) : null;
}

export function requireAttempt(db: Database.Database, id: string): AttemptRecord {
  const attempt = getAttempt(db, id);
  if (!attempt) throw new NotFoundError(`attempt not found: ${id}`);
  return attempt;
}

export function listAttemptsByNode(db: Database.Database, nodeId: string): AttemptRecord[] {
  const rows = db.prepare(
    "SELECT * FROM attempts WHERE node_id = ? ORDER BY rowid ASC",
  ).all(nodeId) as AttemptRow[];
  return rows.map(mapAttempt);
}

export function insertRunningAttempt(
  db: Database.Database,
  input: { id: string; nodeId: string; agentId: string; executionVersion: number; startedAt: string },
): AttemptRecord {
  db.prepare(`
    INSERT INTO attempts (
      id, node_id, agent_id, execution_version, status, checkpoint_json, error, started_at, ended_at, invalidated
    ) VALUES (?, ?, ?, ?, 'running', NULL, NULL, ?, NULL, 0)
  `).run(input.id, input.nodeId, input.agentId, input.executionVersion, input.startedAt);
  return requireAttempt(db, input.id);
}

export function invalidateOpenAttempts(db: Database.Database, nodeId: string, endedAt: string): number {
  const info = db.prepare(`
    UPDATE attempts
    SET invalidated = 1, status = 'invalidated', ended_at = ?
    WHERE node_id = ? AND invalidated = 0
  `).run(endedAt, nodeId);
  return info.changes;
}

export class AttemptRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): AttemptRecord | null {
    return getAttempt(this.db, id);
  }

  listByNode(nodeId: string): AttemptRecord[] {
    return listAttemptsByNode(this.db, nodeId);
  }
}
