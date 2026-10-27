import { describe, expect, it } from "vitest";

import { NodeRepository, TaskRepository, UNASSIGNED_AGENT_ID, claimNextNode, openTaskDb } from "../src/index.js";

describe("claimNextNode agent backfill (#58)", () => {
  it("never uses owner as the agent id", () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
    const c = claimNextNode(db, { owner: "scheduler-1" });
    expect(c?.node.assignedAgentId ?? null).toBeNull();
    expect(c?.attempt.agentId).toBe(UNASSIGNED_AGENT_ID);
    expect(new NodeRepository(db).get("n1")?.assignedAgentId ?? null).toBeNull();
    db.close();
  });

  it("backfills only the explicit agentId", () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
    const c = claimNextNode(db, { owner: "scheduler-1", agentId: "agt_x" });
    expect(c?.node.assignedAgentId).toBe("agt_x");
    expect(c?.attempt.agentId).toBe("agt_x");
    db.close();
  });
});
