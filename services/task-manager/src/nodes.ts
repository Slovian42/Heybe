import type Database from "better-sqlite3";
import type { TaskStatus } from "@heybe/shared-types";
import type { NodeRecord } from "@heybe/shared-types/task-manager";

import { EventType } from "./constants.js";
import { immediate } from "./db.js";
import { NotFoundError } from "./errors.js";
import { insertEvent } from "./events.js";
import { type NodeRow, mapNode } from "./map.js";
import { assertTransition } from "./state-machine.js";
import { isoNow } from "./time.js";

const NODE_SELECT = `
  SELECT n.*, (SELECT COUNT(*) FROM attempts a WHERE a.node_id = n.id) AS attempt_count
  FROM nodes n
`;

export interface PreparedNode {
  id: string;
  dependsOn: string[];
  assignedAgentId: string | null;
  requiredCapabilities: string[];
  fallbackAgentIds: string[];
  acceptanceCriteria: string;
  timeoutSec: number | null;
}

export function loadNode(db: Database.Database, id: string): NodeRecord | null {
  const row = db.prepare(`${NODE_SELECT} WHERE n.id = ?`).get(id) as NodeRow | undefined;
  return row ? mapNode(row) : null;
}

export function requireNode(db: Database.Database, id: string): NodeRecord {
  const node = loadNode(db, id);
  if (!node) throw new NotFoundError(`node not found: ${id}`);
  return node;
}

export function listNodes(db: Database.Database, taskId: string): NodeRecord[] {
  const rows = db.prepare(`${NODE_SELECT} WHERE n.task_id = ? ORDER BY n.rowid ASC`).all(taskId) as NodeRow[];
  return rows.map(mapNode);
}

export function insertNode(db: Database.Database, taskId: string, node: PreparedNode, now: string): NodeRecord {
  db.prepare(`
    INSERT INTO nodes (
      id, task_id, depends_on_json, assigned_agent_id, required_capabilities_json,
      fallback_agent_ids_json, acceptance_criteria, status, execution_version,
      lease_owner, lease_expires_at, timeout_sec, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?, ?)
  `).run(
    node.id,
    taskId,
    JSON.stringify(node.dependsOn),
    node.assignedAgentId,
    JSON.stringify(node.requiredCapabilities),
    JSON.stringify(node.fallbackAgentIds),
    node.acceptanceCriteria,
    node.timeoutSec,
    now,
    now,
  );
  return requireNode(db, node.id);
}

export function applyNodeTransition(
  db: Database.Database,
  id: string,
  to: TaskStatus,
  opts?: { now?: string; data?: Record<string, unknown> },
): NodeRecord {
  const current = requireNode(db, id);
  assertTransition(current.status, to);
  const now = opts?.now ?? isoNow();
  const clearLease = current.status === "running";
  db.prepare(`
    UPDATE nodes
    SET status = ?,
        updated_at = ?,
        lease_owner = CASE WHEN ? THEN NULL ELSE lease_owner END,
        lease_expires_at = CASE WHEN ? THEN NULL ELSE lease_expires_at END
    WHERE id = ?
  `).run(to, now, clearLease ? 1 : 0, clearLease ? 1 : 0, id);
  insertEvent(db, {
    taskId: current.taskId,
    nodeId: id,
    type: EventType.NodeStatus,
    data: { from: current.status, to, ...(opts?.data ?? {}) },
    at: now,
  });
  return requireNode(db, id);
}

export class NodeRepository {
  constructor(private readonly db: Database.Database) {}

  get(id: string): NodeRecord | null {
    return loadNode(this.db, id);
  }

  listByTask(taskId: string): NodeRecord[] {
    return listNodes(this.db, taskId);
  }

  transition(id: string, to: TaskStatus, opts?: { now?: string }): NodeRecord {
    return immediate(this.db, () => applyNodeTransition(this.db, id, to, opts));
  }
}
