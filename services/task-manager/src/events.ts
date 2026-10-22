import type Database from "better-sqlite3";
import type { TaskEventRecord } from "@heybe/shared-types/task-manager";

import { NotFoundError } from "./errors.js";
import { type EventRow, mapEvent } from "./map.js";

export interface NewEvent {
  taskId: string;
  nodeId?: string | null;
  attemptId?: string | null;
  type: string;
  data?: Record<string, unknown> | null;
  at: string;
}

export function insertEvent(db: Database.Database, event: NewEvent): TaskEventRecord {
  const info = db.prepare(`
    INSERT INTO events (task_id, node_id, attempt_id, type, data_json, at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    event.taskId,
    event.nodeId ?? null,
    event.attemptId ?? null,
    event.type,
    event.data == null ? null : JSON.stringify(event.data),
    event.at,
  );
  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(info.lastInsertRowid) as EventRow | undefined;
  if (!row) throw new NotFoundError("event insert did not return a row");
  return mapEvent(row);
}

export class EventRepository {
  constructor(private readonly db: Database.Database) {}

  append(event: NewEvent): TaskEventRecord {
    return insertEvent(this.db, event);
  }

  listByTask(taskId: string): TaskEventRecord[] {
    const rows = this.db.prepare(
      "SELECT * FROM events WHERE task_id = ? ORDER BY id ASC",
    ).all(taskId) as EventRow[];
    return rows.map(mapEvent);
  }
}
