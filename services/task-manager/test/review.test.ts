import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EventRepository,
  MockExecutor,
  NodeRepository,
  ReviewEventType,
  TaskRepository,
  acceptNode,
  checkNodeArtifacts,
  dispatchOnce,
  isFileName,
  listArtifacts,
  openTaskDb,
  recordArtifact,
  rejectNode,
  saveArtifact,
  sha256Hex,
  startTaskHttpServer,
  stopTaskHttpServer,
} from "../src/index.js";

const enc = new TextEncoder();
const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "heybe-review-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Run one node with a mock executor that "says done" and optionally writes report.md. */
async function setup(opts: { write?: boolean; deliverables?: string[] } = {}) {
  const root = tmp();
  const db = openTaskDb(":memory:");
  new TaskRepository(db).create({ goal: "写报告", deliverables: opts.deliverables ?? ["report.md"], nodes: [{ id: "n1" }] });
  const executor = new MockExecutor((req) => {
    if (opts.write !== false) {
      const saved = saveArtifact({ root, taskId: req.taskId, attemptId: req.attemptId, name: "report.md", bytes: enc.encode("# 报告"), contentType: "text/markdown" });
      recordArtifact(db, { taskId: req.taskId, nodeId: req.nodeId, attemptId: req.attemptId, path: saved.path, sha256: saved.sha256 });
    }
    return { outcome: "awaiting_review" };
  });
  const r = await dispatchOnce(db, executor, { owner: "s", agentId: "a1" });
  if (!r.claimed) throw new Error("claim");
  return { db, root, r, executor };
}

describe("#23 artifact directory + checksum", () => {
  it("stores per task/attempt with sha256 and 700/600", async () => {
    const { db, root, r } = await setup();
    const [a] = listArtifacts(db, r.request.taskId);
    expect(a?.path).toBe(join(root, r.request.taskId, r.request.attemptId, "report.md"));
    expect(a?.sha256).toBe(sha256Hex(enc.encode("# 报告")));
    expect(a?.version).toBe(1);
    expect(a?.official).toBe(false);
    expect(statSync(join(root, r.request.taskId, r.request.attemptId)).mode & 0o777).toBe(0o700);
    expect(statSync(a!.path).mode & 0o777).toBe(0o600);
  });

  it("retry gets a new attempt dir and version 2; first file is untouched", async () => {
    const { db, r, executor } = await setup();
    rejectNode(db, "n1", { rework: true, reason: "再写详细点" });
    const r2 = await dispatchOnce(db, executor, { owner: "s", agentId: "a1" });
    if (!r2.claimed) throw new Error("claim");
    const arts = listArtifacts(db, r.request.taskId);
    expect(arts.map((a) => a.version)).toEqual([1, 2]);
    expect(arts[0]!.path).not.toBe(arts[1]!.path);
    expect(checkNodeArtifacts(db, "n1").artifacts.map((a) => a.attemptId)).toEqual([r2.request.attemptId]);
  });

  it("rejects bad attempt ids", () => {
    expect(() => saveArtifact({ root: tmp(), taskId: "t", attemptId: "../x", name: "r.md", bytes: enc.encode("x"), contentType: "text/plain" })).toThrow();
  });

  it("treats only file-like deliverables as required", () => {
    expect(isFileName("report.md")).toBe(true);
    expect(isFileName("一份摘要")).toBe(false);
    expect(isFileName("../a.md")).toBe(false);
  });
});

describe("#23 agent 'done' only reaches awaiting_review", () => {
  it("executor saying done leaves the node in awaiting_review", async () => {
    const { r } = await setup();
    expect(r.node.status).toBe("awaiting_review");
  });

  it("accept with intact files → completed, artifacts official", async () => {
    const { db, r } = await setup();
    const res = acceptNode(db, "n1");
    expect(res.accepted).toBe(true);
    expect(res.node.status).toBe("completed");
    expect(listArtifacts(db, r.request.taskId)[0]?.official).toBe(true);
    const types = new EventRepository(db).listByTask(r.request.taskId).map((e) => e.type);
    expect(types).toContain(ReviewEventType.ReviewAccepted);
  });
});

describe("#23 missing files can never be marked success", () => {
  it("no artifact recorded → needs_check, not completed", async () => {
    const { db } = await setup({ write: false });
    const res = acceptNode(db, "n1");
    expect(res.accepted).toBe(false);
    expect(res.node.status).toBe("needs_check");
    expect(res.check.problems[0]?.code).toBe("artifact_not_recorded");
    // Trying again still refuses.
    expect(acceptNode(db, "n1").node.status).toBe("needs_check");
  });

  it("file deleted after recording → needs_check", async () => {
    const { db, r } = await setup();
    rmSync(listArtifacts(db, r.request.taskId)[0]!.path);
    const res = acceptNode(db, "n1");
    expect(res.accepted).toBe(false);
    expect(res.check.problems[0]?.code).toBe("artifact_file_missing");
  });

  it("file changed after recording → checksum mismatch", async () => {
    const { db, r } = await setup();
    writeFileSync(listArtifacts(db, r.request.taskId)[0]!.path, "改过");
    const res = acceptNode(db, "n1");
    expect(res.check.problems[0]?.code).toBe("artifact_checksum_mismatch");
    expect(new NodeRepository(db).get("n1")?.status).toBe("needs_check");
  });

  it("accept refuses nodes that are not awaiting review", async () => {
    const db = openTaskDb(":memory:");
    new TaskRepository(db).create({ goal: "x", nodes: [{ id: "n1" }] });
    expect(() => acceptNode(db, "n1")).toThrow(/not awaiting_review/);
  });

  it("reject without rework → failed", async () => {
    const { db } = await setup();
    expect(rejectNode(db, "n1", { reason: "不对" }).status).toBe("failed");
  });
});

describe("#23 HTTP", () => {
  it("lists artifacts, blocks bad accept with 422, accepts good one", async () => {
    const bad = await setup({ write: false });
    const good = await setup();
    for (const [t, expectStatus] of [[bad, 422], [good, 200]] as const) {
      const server = await startTaskHttpServer(t.db);
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      try {
        const list = await fetch(`${base}/tasks/${t.r.request.taskId}/artifacts`);
        expect(list.status).toBe(200);
        const check = await (await fetch(`${base}/nodes/n1/review`)).json() as { check: { ok: boolean } };
        expect(check.check.ok).toBe(expectStatus === 200);
        const res = await fetch(`${base}/nodes/n1/accept`, { method: "POST", body: "{}" });
        expect(res.status).toBe(expectStatus);
      } finally {
        await stopTaskHttpServer(server);
      }
    }
  });
});
