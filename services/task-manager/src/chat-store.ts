// #19 part 2 (item 2): chat turns in the task-manager SQLite, so a running or finished turn can be
// shown again after the window is closed and reopened, the UI reloads, or the service restarts.
// One row per turn, folded from the turn's events (text, tool steps, error, model source).
import type Database from "better-sqlite3";
import type { ChatModelSource, ChatTurnSnapshot, ChatTurnStatus } from "@heybe/shared-types/chat";
import { chatErrorMessage } from "@heybe/shared-types/chat";

import { isoNow } from "./time.js";

export const CHAT_TURNS_SQL = `
CREATE TABLE IF NOT EXISTS chat_turns (
  id           TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  user_content TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('streaming','done','stopped','interrupted','failed','unavailable')),
  text         TEXT NOT NULL DEFAULT '',
  tools_json   TEXT NOT NULL DEFAULT '[]',
  error_json   TEXT,
  source_json  TEXT,
  last_seq     INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_turns_session ON chat_turns(session_id, created_at);
`;

interface Row {
  id: string;
  session_id: string;
  user_content: string;
  status: ChatTurnStatus;
  text: string;
  tools_json: string;
  error_json: string | null;
  source_json: string | null;
  last_seq: number;
  created_at: string;
  updated_at: string;
}

function parse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toSnapshot(row: Row): ChatTurnSnapshot {
  const error = parse<ChatTurnSnapshot["error"] | null>(row.error_json, null);
  const source = parse<ChatModelSource | null>(row.source_json, null);
  return {
    id: row.id,
    sessionId: row.session_id,
    userContent: row.user_content,
    status: row.status,
    text: row.text,
    tools: parse(row.tools_json, []),
    ...(error ? { error } : {}),
    ...(source ? { source } : {}),
    lastSeq: row.last_seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** How many turns GET /chat/sessions/:id returns (newest kept). */
export const CHAT_HISTORY_LIMIT = 200;

export class ChatTurnStore {
  constructor(private readonly db: Database.Database) {}

  create(input: { id: string; sessionId: string; userContent: string }): ChatTurnSnapshot {
    const now = isoNow();
    this.db
      .prepare(
        `INSERT INTO chat_turns (id, session_id, user_content, status, created_at, updated_at)
         VALUES (?, ?, ?, 'streaming', ?, ?)`,
      )
      .run(input.id, input.sessionId, input.userContent, now, now);
    return this.get(input.id)!;
  }

  get(id: string): ChatTurnSnapshot | undefined {
    const row = this.db.prepare("SELECT * FROM chat_turns WHERE id = ?").get(id) as Row | undefined;
    return row ? toSnapshot(row) : undefined;
  }

  listBySession(sessionId: string, limit = CHAT_HISTORY_LIMIT): ChatTurnSnapshot[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (SELECT rowid AS r, * FROM chat_turns WHERE session_id = ? ORDER BY rowid DESC LIMIT ?) ORDER BY r ASC`,
      )
      .all(sessionId, limit) as Row[];
    return rows.map(toSnapshot);
  }

  /** Write the folded state. Never moves a turn out of a final status. */
  save(turn: ChatTurnSnapshot): void {
    this.db
      .prepare(
        `UPDATE chat_turns
            SET status = ?, text = ?, tools_json = ?, error_json = ?, source_json = ?, last_seq = ?, updated_at = ?
          WHERE id = ? AND status = 'streaming'`,
      )
      .run(
        turn.status,
        turn.text,
        JSON.stringify(turn.tools),
        turn.error ? JSON.stringify(turn.error) : null,
        turn.source ? JSON.stringify(turn.source) : null,
        turn.lastSeq,
        isoNow(),
        turn.id,
      );
  }

  /**
   * On service start: a turn still `streaming` belonged to a previous service process (crash,
   * restart, quit). Its upstream connection is gone, so the outcome is unknown.
   */
  interruptOrphans(): number {
    const error = { reason: "service_restarted", message: chatErrorMessage("service_restarted") };
    return this.db
      .prepare(
        `UPDATE chat_turns SET status = 'interrupted', error_json = ?, updated_at = ? WHERE status = 'streaming'`,
      )
      .run(JSON.stringify(error), isoNow()).changes;
  }
}
