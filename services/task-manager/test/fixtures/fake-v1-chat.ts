// Minimal FastClaw /v1/chat/completions stand-in for #19 part 2 (streaming only).
// The user message picks the scenario; chunks follow FastClaw v1.4.0 (model = "provider/model",
// `: ping` comments, in-band `error` on the last chunk with HTTP 200).
import http from "node:http";
import type { AddressInfo } from "node:net";

const chunk = (model: string, delta: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: extra.finish ?? null }], ...(extra.error ? { error: extra.error } : {}) })}\n\n`;

export interface FakeV1 {
  baseUrl: string;
  /** Requests whose client went away before the response ended. */
  aborted: number;
  close(): Promise<void>;
}

export async function startFakeV1(model = "deepseek/deepseek-chat"): Promise<FakeV1> {
  const state = { aborted: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c: Buffer) => (body += c.toString()));
    req.on("end", () => {
      const msg = (JSON.parse(body) as { messages: Array<{ content: string }> }).messages.at(-1)?.content ?? "";
      res.on("close", () => {
        if (!res.writableEnded) state.aborted += 1;
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(chunk(model, { role: "assistant" }));
      res.write(": ping\n\n");
      if (msg === "ok") {
        for (const part of ["# 标题\n\n", "第一段", "，第二段"]) res.write(chunk(model, { content: part }));
        res.write(chunk(model, {}, { finish: "stop" }));
        res.end("data: [DONE]\n\n");
      } else if (msg === "error") {
        res.write(chunk(model, { content: "写到一半" }));
        res.write(chunk(model, {}, { finish: "stop", error: { type: "server_error", code: "agent_error", message: 'API error 402: {"error": {"message": "Insufficient Balance"}}' } }));
        res.end("data: [DONE]\n\n");
      } else if (msg === "cut") {
        res.write(chunk(model, { content: "半句" }));
        setTimeout(() => res.destroy(), 10);
      } else {
        // "slow": keep pinging until the client goes away.
        res.write(chunk(model, { content: "慢" }));
        const t = setInterval(() => res.write(": ping\n\n"), 20);
        res.on("close", () => clearInterval(t));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    get aborted() {
      return state.aborted;
    },
    close: () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}
