import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

import { describe, expect, it } from "vitest";

import {
  AttemptRepository,
  CLAIM_NODE_SQL,
  EventRepository,
  IllegalStateTransitionError,
  NodeRepository,
  StaleExecutionError,
  TaskRepository,
  applyExecutionResult,
  claimNextNode,
  openTaskDb,
} from "../src/index.js";
import { openTemp, tempDb } from "./helpers.js";

const T0 = "2026-01-01T00:00:00.000Z";
const LEASE = 60_000;

describe("atomic claim", () => {
  it("lets only one scheduler hold a node", () => {
    const file = tempDb();
    const a = openTaskDb(file.path);
    const b = openTaskDb(file.path);
    new TaskRepository(a).create({ goal: "g", nodes: [{ id: "n1" }] });
    const first = claimNextNode(a, { owner: "sched-a", now: T0, leaseMs: LEASE });
    const second = claimNextNode(b, { owner: "sched-b", now: T0, leaseMs: LEASE });
    expect(first?.node.id).toBe("n1");
    expect(first?.node.executionVersion).toBe(1);
    expect(first?.node.leaseOwner).toBe("sched-a");
    expect(second).toBeNull();
    a.close();
    b.close();
    file.cleanup();
  });

  it("serializes two concurrent updates so only one version wins", async () => {
    const file = tempDb();
    const db = openTaskDb(file.path);
    new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
    db.close();
    const sqlitePath = createRequire(import.meta.url).resolve("better-sqlite3");
    const script = `
      const { parentPort, workerData } = require("worker_threads");
      const Database = require(workerData.sqlitePath);
      const db = new Database(workerData.path);
      db.pragma("busy_timeout = 5000");
      const tx = db.transaction(() => db.prepare(workerData.sql).run(workerData.params).changes);
      try {
        parentPort.postMessage({ changes: tx.immediate() });
      } catch (error) {
        parentPort.postMessage({ error: String(error && error.message || error), code: error && error.code });
      } finally {
        db.close();
      }
    `;
    const run = (owner: string) => new Promise<{ changes?: number; error?: string }>((resolve, reject) => {
      const worker = new Worker(script, {
        eval: true,
        workerData: {
          path: file.path,
          sqlitePath,
          sql: CLAIM_NODE_SQL,
          params: {
            owner,
            agentId: owner,
            expires: "2026-01-01T00:00:30.000Z",
            now: T0,
            id: "n1",
            expectedVersion: 0,
          },
        },
      });
      worker.on("message", resolve);
      worker.on("error", reject);
    });
    const [left, right] = await Promise.all([run("s1"), run("s2")]);
    expect(left.error).toBeUndefined();
    expect(right.error).toBeUndefined();
    const changes = [left.changes, right.changes].sort();
    expect(changes).toEqual([0, 1]);
    const check = openTaskDb(file.path);
    const node = new NodeRepository(check).get("n1");
    expect(node?.executionVersion).toBe(1);
    expect(node?.status).toBe("running");
    expect(["s1", "s2"]).toContain(node?.leaseOwner);
    check.close();
    file.cleanup();
  });

  it("rejects a stale result after the execution version advances", () => {
    const { db, cleanup } = openTemp();
    const tasks = new TaskRepository(db);
    const nodes = new NodeRepository(db);
    const attempts = new AttemptRepository(db);
    tasks.create({ goal: "g", nodes: [{ id: "n1" }] });
    const first = claimNextNode(db, { owner: "a", now: T0, leaseMs: 1000 });
    expect(claimNextNode(db, { owner: "b", now: "2026-01-01T00:00:00.999Z", leaseMs: 1000 })).toBeNull();
    const second = claimNextNode(db, { owner: "b", now: "2026-01-01T00:00:01.000Z", leaseMs: 1000 });
    expect(second?.node.executionVersion).toBe(2);
    expect(attempts.get(first?.attempt.id ?? "")?.invalidated).toBe(true);
    expect(() => applyExecutionResult(db, {
      nodeId: "n1",
      executionVersion: 1,
      outcome: "failed",
      owner: "a",
      now: "2026-01-01T00:00:01.000Z",
    })).toThrow(StaleExecutionError);
    expect(nodes.get("n1")).toMatchObject({ status: "running", executionVersion: 2, leaseOwner: "b" });
    const done = applyExecutionResult(db, {
      nodeId: "n1",
      executionVersion: 2,
      outcome: "awaiting_review",
      owner: "b",
      now: "2026-01-01T00:00:02.000Z",
    });
    expect(done.status).toBe("awaiting_review");
    expect(done.leaseOwner).toBeNull();
    cleanup();
  });

  it("does not dispatch new nodes after cancel, and still accepts the in-flight result", () => {
    const { db, cleanup } = openTemp();
    const tasks = new TaskRepository(db);
    const nodes = new NodeRepository(db);
    const { task } = tasks.create({ goal: "g", nodes: [{ id: "n1" }, { id: "n2" }] });
    const claimed = claimNextNode(db, { owner: "s", now: T0, leaseMs: LEASE });
    expect(claimed?.node.id).toBe("n1");
    const cancelled = tasks.cancel(task.id, { reason: "user" });
    expect(cancelled.status).toBe("cancelled");
    expect(claimNextNode(db, { owner: "other", now: T0, leaseMs: LEASE })).toBeNull();
    expect(nodes.get("n1")?.status).toBe("running");
    expect(nodes.get("n2")?.status).toBe("pending");
    const events = new EventRepository(db).listByTask(task.id);
    expect(events.filter((event) => event.type === "task_cancelled")).toHaveLength(1);
    expect(events.find((event) => event.type === "task_cancelled")?.data).toMatchObject({
      effect: "stop_dispatch",
      reason: "user",
    });
    tasks.cancel(task.id);
    expect(new EventRepository(db).listByTask(task.id).filter((event) => event.type === "task_cancelled")).toHaveLength(1);
    const finished = applyExecutionResult(db, {
      nodeId: "n1",
      executionVersion: 1,
      outcome: "awaiting_review",
      owner: "s",
      now: T0,
    });
    expect(finished.status).toBe("awaiting_review");
    expect(tasks.get(task.id)?.status).toBe("cancelled");
    cleanup();
  });

  it("caps running leases at the default worker slots and waits on dependencies", () => {
    const { db, cleanup } = openTemp();
    const tasks = new TaskRepository(db);
    const nodes = new NodeRepository(db);
    tasks.create({
      goal: "g",
      nodes: [
        { id: "a" },
        { id: "b", dependsOn: ["a"] },
        { id: "c" },
        { id: "d" },
      ],
    });
    const first = claimNextNode(db, { owner: "s", now: T0, leaseMs: LEASE });
    const second = claimNextNode(db, { owner: "s", now: T0, leaseMs: LEASE });
    const blocked = claimNextNode(db, { owner: "s", now: T0, leaseMs: LEASE });
    expect([first?.node.id, second?.node.id].sort()).toEqual(["a", "c"]);
    expect(blocked).toBeNull();
    expect(() => nodes.transition(first?.node.id ?? "", "completed")).toThrow(IllegalStateTransitionError);
    applyExecutionResult(db, {
      nodeId: "a",
      executionVersion: 1,
      outcome: "awaiting_review",
      owner: "s",
      now: T0,
    });
    nodes.transition("a", "completed");
    const third = claimNextNode(db, { owner: "s", now: T0, leaseMs: LEASE });
    expect(third?.node.id).toBe("b");
    cleanup();
  });
});
