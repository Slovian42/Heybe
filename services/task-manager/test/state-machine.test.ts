import { describe, expect, it } from "vitest";
import { TASK_STATUSES, type TaskStatus } from "@heybe/shared-types/task-manager";

import {
  EventRepository,
  IllegalStateTransitionError,
  TaskRepository,
  TRANSITIONS,
  assertTransition,
  canTransition,
  openTaskDb,
} from "../src/index.js";

describe("state machine", () => {
  it("allows only the declared transitions", () => {
    for (const from of TASK_STATUSES) {
      for (const to of TASK_STATUSES) {
        const legal = TRANSITIONS[from].includes(to);
        expect(canTransition(from, to)).toBe(legal);
        if (legal) {
          expect(assertTransition(from, to)).toBe(to);
        } else {
          expect(() => assertTransition(from, to)).toThrow(IllegalStateTransitionError);
        }
      }
    }
  });

  it("rejects an executor jumping from running straight to completed", () => {
    expect(canTransition("running", "completed")).toBe(false);
    expect(() => assertTransition("running", "completed")).toThrow(
      /illegal state transition: running -> completed/,
    );
  });

  it("walks pending to completed only through awaiting_review", () => {
    const path: TaskStatus[] = ["pending", "running", "awaiting_review", "completed"];
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      if (!from || !to) throw new Error("path");
      expect(assertTransition(from, to)).toBe(to);
    }
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("failed", "running")).toBe(false);
    expect(canTransition("cancelled", "running")).toBe(false);
  });

  it("persists a legal transition and leaves the row unchanged when rejected", () => {
    const db = openTaskDb(":memory:");
    const tasks = new TaskRepository(db);
    const { task } = tasks.create({ goal: "ship the report" });
    expect(task.status).toBe("pending");
    expect(tasks.transition(task.id, "running").status).toBe("running");
    expect(() => tasks.transition(task.id, "completed")).toThrow(IllegalStateTransitionError);
    expect(tasks.get(task.id)?.status).toBe("running");
    const events = new EventRepository(db).listByTask(task.id);
    expect(events.filter((event) => event.type === "task_status")).toHaveLength(1);
    expect(events.find((event) => event.type === "task_status")?.data).toMatchObject({
      from: "pending",
      to: "running",
    });
    db.close();
  });
});
