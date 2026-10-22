import { describe, expect, it } from "vitest";

import { EventRepository, IdempotencyConflictError, TaskRepository, openTaskDb } from "../src/index.js";

describe("task idempotency", () => {
  it("returns the original task for the same key and payload", () => {
    const db = openTaskDb(":memory:");
    const tasks = new TaskRepository(db);
    const first = tasks.create({
      goal: "summarize",
      idempotencyKey: "evt-1",
      deliverables: ["notes.md"],
      nodes: [{ id: "n1", acceptanceCriteria: "has notes" }],
    });
    const second = tasks.create({
      goal: "summarize",
      idempotencyKey: "evt-1",
      deliverables: ["notes.md"],
      nodes: [{ id: "n1", acceptanceCriteria: "has notes" }],
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(second.nodes.map((node) => node.id)).toEqual(["n1"]);
    const created = new EventRepository(db).listByTask(first.task.id).filter((event) => event.type === "task_created");
    expect(created).toHaveLength(1);
    db.close();
  });

  it("rejects the same key when the payload differs", () => {
    const db = openTaskDb(":memory:");
    const tasks = new TaskRepository(db);
    tasks.create({ goal: "summarize", idempotencyKey: "evt-1" });
    expect(() => tasks.create({ goal: "something else", idempotencyKey: "evt-1" })).toThrow(IdempotencyConflictError);
    expect(tasks.create({ goal: "summarize", idempotencyKey: "evt-1" }).created).toBe(false);
    db.close();
  });

  it("creates distinct tasks when no key is provided", () => {
    const db = openTaskDb(":memory:");
    const tasks = new TaskRepository(db);
    const first = tasks.create({ goal: "same words" });
    const second = tasks.create({ goal: "same words" });
    expect(first.task.id).not.toBe(second.task.id);
    expect(first.task.idempotencyKey).toBeNull();
    db.close();
  });
});
