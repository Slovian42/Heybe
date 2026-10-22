import { describe, expect, it } from "vitest";

import { MockExecutor, NodeRepository, TaskRepository, dispatchOnce, openTaskDb } from "../src/index.js";

describe("mock dispatch", () => {
  it("moves a claimed node to awaiting_review and does not mark it completed", async () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "draft", nodes: [{ id: "n1", acceptanceCriteria: "exists" }] });
    const executor = new MockExecutor();
    const result = await dispatchOnce(db, executor, { owner: "sched" });
    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error("expected a claim");
    expect(result.result.outcome).toBe("awaiting_review");
    expect(result.node.status).toBe("awaiting_review");
    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]?.executionVersion).toBe(1);
    expect(new NodeRepository(db).get("n1")?.status).toBe("awaiting_review");
    db.close();
  });

  it("records an observed executor failure as failed", async () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "draft", nodes: [{ id: "n1" }] });
    const executor = new MockExecutor(() => {
      throw new Error("mock blew up");
    });
    const result = await dispatchOnce(db, executor, { owner: "sched" });
    expect(result.claimed).toBe(true);
    if (!result.claimed) throw new Error("expected a claim");
    expect(result.node.status).toBe("failed");
    expect(result.result.error).toMatch(/mock blew up/);
    db.close();
  });
});
