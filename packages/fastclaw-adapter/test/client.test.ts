import { describe, expect, it } from "vitest";
import { FastClawClient, assertV1Path } from "../src/index.js";

describe("FastClawClient", () => {
  it("rejects non-/v1 paths", () => {
    expect(() => assertV1Path("/api/agents")).toThrow();
    expect(() => assertV1Path("/v1/agents")).not.toThrow();
  });

  it("calls /v1/agents with bearer auth", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ id: "a1", name: "Researcher" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = new FastClawClient({ baseUrl: "http://127.0.0.1:18953/", apiKey: "test-placeholder", fetchImpl: fakeFetch });
    const out = await c.listAgents();
    expect(out.data[0].name).toBe("Researcher");
    expect(calls[0].url).toBe("http://127.0.0.1:18953/v1/agents");
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe("Bearer test-placeholder");
  });

  it("refuses /api/* even through request()", async () => {
    const c = new FastClawClient({ baseUrl: "http://x", apiKey: "k", fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch });
    await expect(c.request("GET", "/api/skills")).rejects.toThrow(/v1/);
  });
});
