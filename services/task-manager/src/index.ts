// Placeholder local task manager service. Single instance; sole dispatcher in task mode.
import Database from "better-sqlite3";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export function openTaskDb(path = process.env.HEYBE_TASK_DB_PATH ?? ":memory:") {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA_SQL);
  db.prepare("INSERT OR REPLACE INTO schema_meta(key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
  return db;
}

export { SCHEMA_SQL, SCHEMA_VERSION };
