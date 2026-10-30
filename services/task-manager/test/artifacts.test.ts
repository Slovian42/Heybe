import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FastClawClient } from "@heybe/fastclaw-adapter";

import {
  ArtifactError,
  EventRepository,
  FastClawEventType,
  FastClawNodeExecutor,
  TaskRepository,
  WEB_REPORT_FILE,
  assertArtifactName,
  assertPublicHttpUrl,
  buildWebReportPrompt,
  defaultReportsRoot,
  dispatchOnce,
  openTaskDb,
  saveArtifact,
} from "../src/index.js";

const TOKEN = "fc_test_token_do_not_log";
const enc = new TextEncoder();
const tmp = () => mkdtempSync(join(tmpdir(), "heybe-art-"));

describe("saveArtifact", () => {
  it("writes <root>/<task>/<name> with 700/600", () => {
    const root = join(tmp(), "reports");
    const saved = saveArtifact({ root, taskId: "t1", name: "report.md", bytes: enc.encode("# hi"), contentType: "text/markdown; charset=utf-8" });
    expect(readFileSync(saved.path, "utf8")).toBe("# hi");
    expect(statSync(saved.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(root, "t1")).mode & 0o777).toBe(0o700);
    expect(statSync(root).mode & 0o777).toBe(0o700);
  });

  it.each(["../x.md", "a/b.md", "/etc/passwd", "..", ".hidden", "a b.md", ""])("rejects name %j", (name) => {
    expect(() => assertArtifactName(name)).toThrow(ArtifactError);
  });

  it("rejects oversize and non-text", () => {
    const root = tmp();
    expect(() => saveArtifact({ root, taskId: "t", name: "r.md", bytes: new Uint8Array(11), contentType: "text/markdown", maxBytes: 10 })).toThrow(/上限/);
    expect(() => saveArtifact({ root, taskId: "t", name: "r.md", bytes: enc.encode("x"), contentType: "text/html" })).toThrow(/类型/);
    expect(() => saveArtifact({ root, taskId: "../t", name: "r.md", bytes: enc.encode("x"), contentType: "text/plain" })).toThrow(ArtifactError);
  });

  it("falls back to extension when content type is octet-stream", () => {
    const saved = saveArtifact({ root: tmp(), taskId: "t", name: "r.md", bytes: enc.encode("x"), contentType: "application/octet-stream" });
    expect(saved.contentType).toBe("text/markdown");
  });
});

describe("defaultReportsRoot", () => {
  it("uses Application Support on macOS and XDG elsewhere", () => {
    expect(defaultReportsRoot({}, "darwin", "/Users/y")).toBe("/Users/y/Library/Application Support/Heybe/reports");
    expect(defaultReportsRoot({ XDG_DATA_HOME: "/d" }, "linux", "/home/y")).toBe("/d/heybe/reports");
    expect(defaultReportsRoot({}, "linux", "/home/y")).toBe("/home/y/.local/share/heybe/reports");
  });
});

describe("assertPublicHttpUrl", () => {
  it("accepts public http(s)", () => {
    expect(assertPublicHttpUrl("https://example.com/a").hostname).toBe("example.com");
  });
  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "http://localhost:8080",
    "http://127.0.0.1",
    "http://10.1.2.3",
    "http://192.168.1.1",
    "http://172.16.0.1",
    "http://169.254.169.254/latest",
    "http://100.64.0.1",
    "http://[::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://user:pw@example.com",
    "not a url",
  ])("rejects %s", (u) => {
    expect(() => assertPublicHttpUrl(u)).toThrow();
  });
  it("prompt pins the single URL and report.md", () => {
    const p = buildWebReportPrompt({ url: "https://example.com", goal: "总结" });
    expect(p).toContain("https://example.com/");
    expect(p).toContain(WEB_REPORT_FILE);
    expect(() => buildWebReportPrompt({ url: "http://127.0.0.1", goal: "x" })).toThrow();
  });
});

function sse(chunks: unknown[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify(ch)}\n\n`));
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const doneWith = (files: unknown[]) => ({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], files });
const reportFile = { name: "report.md", path: "report.md", size: 6, content_type: "text/markdown", url: "/v1/agents/agent-1/sessions/s/files/report.md" };

function run(files: unknown[], download: () => Response) {
  const root = tmp();
  const calls: string[] = [];
  const fetchImpl = (async (url: string | URL | Request) => {
    calls.push(new URL(String(url)).pathname);
    return calls.length === 1 ? sse([{ choices: [{ index: 0, delta: { content: "ok" } }] }, doneWith(files)]) : download();
  }) as typeof fetch;
  const client = new FastClawClient({ baseUrl: "http://127.0.0.1:18953", token: TOKEN, fetchImpl, retry: { maxAttempts: 1 } });
  const db = openTaskDb(":memory:");
  const executor = new FastClawNodeExecutor(db, {
    client,
    defaultAgentId: "agent-1",
    artifacts: { root, expected: () => [WEB_REPORT_FILE], maxBytes: 1024 },
  });
  new TaskRepository(db).create({ goal: "读网页", nodes: [{ id: "n1" }] });
  return { root, calls, db, go: () => dispatchOnce(db, executor, { owner: "s", agentId: "agent-1" }) };
}

describe("FastClawNodeExecutor artifacts (#12)", () => {
  it("downloads report.md over /v1 and saves it locally", async () => {
    const t = run([reportFile], () => new Response("# 报告", { status: 200, headers: { "Content-Type": "text/markdown" } }));
    const r = await t.go();
    if (!r.claimed) throw new Error("claim");
    expect(r.node.status).toBe("awaiting_review");
    expect(t.calls[1]).toMatch(/^\/v1\/agents\/agent-1\/sessions\/.+\/files\/report\.md$/);
    const saved = new EventRepository(t.db).listByTask(r.request.taskId).find((e) => e.type === FastClawEventType.ArtifactSaved);
    const path = (saved?.data as { path: string }).path;
    expect(path).toBe(join(t.root, r.request.taskId, "report.md"));
    expect(readFileSync(path, "utf8")).toBe("# 报告");
  });

  it("fails with artifact_missing when files[] lacks report.md", async () => {
    const t = run([], () => new Response("x"));
    const r = await t.go();
    if (!r.claimed) throw new Error("claim");
    expect(r.node.status).toBe("failed");
    expect(t.calls).toHaveLength(1);
    const ev = new EventRepository(t.db).listByTask(r.request.taskId).find((e) => e.type === FastClawEventType.ArtifactFailed);
    expect((ev?.data as { code: string }).code).toBe("artifact_missing");
  });

  it("fails on 404 download, oversize and wrong type without leaking the token", async () => {
    for (const [resp, code] of [
      [() => new Response(JSON.stringify({ error: { message: "nope" } }), { status: 404, headers: { "Content-Type": "application/json" } }), "artifact_download_failed"],
      [() => new Response("x".repeat(2000), { status: 200, headers: { "Content-Type": "text/markdown" } }), "artifact_too_large"],
      [() => new Response("<html>", { status: 200, headers: { "Content-Type": "text/html" } }), "artifact_bad_type"],
    ] as const) {
      const t = run([reportFile], resp);
      const r = await t.go();
      if (!r.claimed) throw new Error("claim");
      expect(r.node.status).toBe("failed");
      const events = new EventRepository(t.db).listByTask(r.request.taskId);
      expect((events.find((e) => e.type === FastClawEventType.ArtifactFailed)?.data as { code: string }).code).toBe(code);
      expect(JSON.stringify(events)).not.toContain(TOKEN);
    }
  });
});
