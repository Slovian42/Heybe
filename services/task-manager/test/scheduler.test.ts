import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";
import type { ExecutionRequest, ExecutionResult, NodeExecutor } from "@heybe/shared-types/task-manager";

import { NodeRepository, TaskRepository, openTaskDb, startDispatchLoop, startTaskHttpServer, stopTaskHttpServer } from "../src/index.js";

class Gate implements NodeExecutor {
  seen: ExecutionRequest[] = [];
  max = 0;
  live = 0;
  release: (() => void)[] = [];
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    this.seen.push(req);
    this.live++;
    this.max = Math.max(this.max, this.live);
    await new Promise<void>((r) => this.release.push(r));
    this.live--;
    return { outcome: "awaiting_review" };
  }
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 200 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(f()).toBe(true);
};

describe("startDispatchLoop", () => {
  it("runs nodes up to workerSlots and keeps polling", async () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "g", nodes: [{ id: "a" }, { id: "b" }, { id: "c" }] });
    const ex = new Gate();
    const loop = startDispatchLoop(db, ex, { owner: "sched", workerSlots: 2, idleMs: 5 });
    await until(() => ex.seen.length === 2);
    ex.release.splice(0).forEach((r) => r());
    await until(() => ex.seen.length === 3);
    ex.release.splice(0).forEach((r) => r());
    await until(() => loop.inflight === 0);
    await loop.stop();
    expect(ex.max).toBeLessThanOrEqual(2);
    expect(new NodeRepository(db).get("c")?.status).toBe("awaiting_review");
    db.close();
  });
});

describe("HTTP cancel hook", () => {
  it("calls onCancel and reports server state as unknown", async () => {
    const db = openTaskDb(":memory:");
    const calls: string[] = [];
    const server = await startTaskHttpServer(db, { port: 0, onCancel: (id) => (calls.push(id), 1) });
    const port = (server.address() as AddressInfo).port;
    try {
      const { task } = new TaskRepository(db).create({ goal: "g", nodes: [{ id: "n1" }] });
      const res = await fetch(`http://127.0.0.1:${port}/tasks/${task.id}/cancel`, { method: "POST" });
      const body = (await res.json()) as { aborted: number; serverStopped: string | null };
      expect(res.status).toBe(200);
      expect(calls).toEqual([task.id]);
      expect(body.aborted).toBe(1);
      expect(body.serverStopped).toBe("unknown");
    } finally {
      await stopTaskHttpServer(server);
      db.close();
    }
  });
});
