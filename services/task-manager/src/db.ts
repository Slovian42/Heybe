import Database from "better-sqlite3";

import { migrate } from "./migrate.js";

export function immediate<T>(db: Database.Database, fn: () => T): T {
  return db.transaction(fn).immediate();
}

export function openTaskDb(path = process.env.HEYBE_TASK_DB_PATH ?? ":memory:"): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  migrate(db);
  return db;
}
