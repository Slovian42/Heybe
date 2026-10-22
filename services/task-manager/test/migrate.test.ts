import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { SCHEMA_SQL, SCHEMA_VERSION } from "../src/schema.js";
import { LATEST_SCHEMA_VERSION, migrate, openTaskDb, readSchemaVersion } from "../src/index.js";
import { tempDb } from "./helpers.js";

describe("schema migrations", () => {
  it("keeps the draft version and migrates a fresh database to the latest", () => {
    expect(SCHEMA_VERSION).toBe(1);
    expect(LATEST_SCHEMA_VERSION).toBeGreaterThan(SCHEMA_VERSION);
    const db = openTaskDb(":memory:");
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    migrate(db);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const versions = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all() as { version: number }[];
    expect(versions.map((row) => row.version)).toEqual([1, LATEST_SCHEMA_VERSION]);
    const cols = db.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
    expect(cols.map((col) => col.name)).toContain("idempotency_key");
    const triggers = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'memory_facts_fts%'",
    ).all();
    expect(triggers).toEqual([]);
    db.close();
  });

  it("upgrades a draft database without rewriting existing rows", () => {
    const file = tempDb();
    const raw = new Database(file.path);
    raw.exec(SCHEMA_SQL);
    raw.prepare("INSERT INTO schema_meta(key, value) VALUES ('schema_version', '1')").run();
    raw.prepare(
      "INSERT INTO tasks(id, goal, status, created_at, updated_at) VALUES ('t1', 'keep me', 'pending', 't', 't')",
    ).run();
    raw.close();

    const db = openTaskDb(file.path);
    expect(readSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
    const row = db.prepare("SELECT goal, idempotency_key FROM tasks WHERE id = 't1'").get() as {
      goal: string;
      idempotency_key: string | null;
    };
    expect(row.goal).toBe("keep me");
    expect(row.idempotency_key).toBeNull();
    db.close();
    file.cleanup();
  });
});
