import type Database from "better-sqlite3";

import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";
import { isoNow } from "./time.js";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: SCHEMA_VERSION,
    name: "baseline",
    up(db) {
      db.exec(SCHEMA_SQL);
    },
  },
  {
    // Draft DDL is unchanged. Idempotency keys are added on top of it.
    version: SCHEMA_VERSION + 1,
    name: "tasks_idempotency_key",
    up(db) {
      const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
      if (!cols.some((col) => col.name === "idempotency_key")) {
        db.exec("ALTER TABLE tasks ADD COLUMN idempotency_key TEXT");
      }
      db.exec(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency_key ON tasks(idempotency_key)",
      );
    },
  },
];

const last = MIGRATIONS[MIGRATIONS.length - 1];
if (
  !last
  || MIGRATIONS[0]?.version !== SCHEMA_VERSION
  || MIGRATIONS.some((migration, index) => migration.version !== SCHEMA_VERSION + index)
) {
  throw new Error(`migrations must start at draft SCHEMA_VERSION ${SCHEMA_VERSION}`);
}

/** Version written to schema_meta after openTaskDb. The draft SQL stays at SCHEMA_VERSION. */
export const LATEST_SCHEMA_VERSION = last.version;

export function readSchemaVersion(db: Database.Database): number {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
  ).get() as { name: string } | undefined;
  if (!table) return 0;
  const row = db.prepare(
    "SELECT value FROM schema_meta WHERE key = 'schema_version'",
  ).get() as { value: string } | undefined;
  if (!row) return 0;
  const version = Number(row.value);
  return Number.isFinite(version) ? version : 0;
}

function appliedVersions(db: Database.Database): Set<number> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[];
  return new Set(rows.map((row) => row.version));
}

/** Apply pending numbered migrations. Safe to call more than once. */
export function migrate(db: Database.Database): number {
  const done = appliedVersions(db);
  for (const migration of MIGRATIONS) {
    if (done.has(migration.version)) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)",
      ).run(migration.version, migration.name, isoNow());
      db.prepare(
        "INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?)",
      ).run(String(migration.version));
    });
    apply();
  }
  return LATEST_SCHEMA_VERSION;
}
