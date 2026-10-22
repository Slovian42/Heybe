import type { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import {
  claimNextNode,
  openTaskDb,
  startTaskHttpServer,
  stopTaskHttpServer,
} from "../src/index.js";

describe("local task HTTP API", () => {
  it("listens only on 127.0.0.1", async () => {
    const db = openTaskDb(":memory:");
    await expect(startTaskHttpServer(db, { host: "0.0.0.0", port: 0 })).rejects.toThrow(/127\.0\.0\.1/);
    await expect(startTaskHttpServer(db, { host: "localhost", port: 0 })).rejects.toThrow(/127\.0\.0\.1/);
    const server = await startTaskHttpServer(db, { port: 0 });
    const address = server.address();
    expect(address).toMatchObject({ address: "127.0.0.1" });
    const port = (address as AddressInfo).port;
    const missing = await fetch(`http://127.0.0.1:${port}/tasks/missing`);
    expect(missing.status).toBe(404);
    await stopTaskHttpServer(server);
    db.close();
  });

  it("creates, reads, and cancels a task", async () => {
    const db = openTaskDb(":memory:");
    const server = await startTaskHttpServer(db, { port: 0 });
    const port = (server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    try {
      const created = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          goal: "write a report",
          idempotencyKey: "evt-1",
          nodes: [{ id: "n1" }, { id: "n2" }],
        }),
      });
      expect(created.status).toBe(201);
      const createdBody = await created.json() as { created: boolean; task: { id: string; status: string }; nodes: { id: string }[] };
      expect(createdBody.created).toBe(true);
      expect(createdBody.task.status).toBe("pending");
      expect(createdBody.nodes.map((node) => node.id)).toEqual(["n1", "n2"]);

      const replay = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "evt-1" },
        body: JSON.stringify({ goal: "write a report" }),
      });
      expect(replay.status).toBe(200);
      const replayBody = await replay.json() as { created: boolean; task: { id: string } };
      expect(replayBody.created).toBe(false);
      expect(replayBody.task.id).toBe(createdBody.task.id);

      const conflict = await fetch(`${base}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: "other", idempotencyKey: "evt-1" }),
      });
      expect(conflict.status).toBe(409);

      const fetched = await fetch(`${base}/tasks/${createdBody.task.id}`);
      expect(fetched.status).toBe(200);
      const fetchedBody = await fetched.json() as { task: { goal: string }; nodes: unknown[] };
      expect(fetchedBody.task.goal).toBe("write a report");
      expect(fetchedBody.nodes).toHaveLength(2);

      const cancelled = await fetch(`${base}/tasks/${createdBody.task.id}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "stop" }),
      });
      expect(cancelled.status).toBe(200);
      const cancelledBody = await cancelled.json() as {
        dispatch: string;
        task: { status: string };
        nodes: { id: string; status: string }[];
        events: { type: string; data: { effect?: string } | null }[];
      };
      expect(cancelledBody.dispatch).toBe("stopped");
      expect(cancelledBody.task.status).toBe("cancelled");
      expect(cancelledBody.nodes.every((node) => node.status === "pending")).toBe(true);
      expect(cancelledBody.events.some((event) => event.type === "task_cancelled" && event.data?.effect === "stop_dispatch")).toBe(true);
      expect(claimNextNode(db, { owner: "sched" })).toBeNull();
    } finally {
      await stopTaskHttpServer(server);
      db.close();
    }
  });
});
