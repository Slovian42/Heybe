import { describe, expect, it } from "vitest";
import { openTaskDb } from "../src/index.js";

describe("task-manager schema", () => {
  it("creates all draft tables", () => {
    const db = openTaskDb(":memory:");
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table')").all() as { name: string }[]).map((r) => r.name);
    for (const t of ["tasks", "nodes", "attempts", "events", "artifacts", "approvals", "external_jobs", "receipts", "notifications", "memory_facts", "memory_access"]) {
      expect(names).toContain(t);
    }
  });
  it("dedupes routine occurrences", () => {
    const db = openTaskDb(":memory:");
    const ins = db.prepare("INSERT INTO tasks(id, goal, status, routine_run_id, created_at, updated_at) VALUES (?, 'g', 'pending', 'run-1', 'now', 'now')");
    ins.run("t1");
    expect(() => ins.run("t2")).toThrow();
  });
});
