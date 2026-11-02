// #19 Mac 复验问题 2：模型调用失败要说清原因。
// Fixtures are the exact `error.message` strings FastClaw v1.4.0 relayed on 2026-11-02 (real gateway,
// fake key, mock OpenAI-compatible upstream; see docs/t19-desktop-chat.md). They go through the real
// adapter (SSE parse + sseFailure / 502 JSON) before classification, like production.
import { describe, expect, it } from "vitest";
import { FastClawClient } from "@heybe/fastclaw-adapter";
import { CHAT_ERROR_MESSAGES, chatErrorMessage } from "@heybe/shared-types/chat";

import { classifyChatError, classifyUpstreamStatus, fastClawChatStream } from "../src/index.js";

const TOKEN = "heybe-test-token-0123456789abcdef";
const OBSERVED = {
  key401: 'API error 401: {"error": {"message": "Authentication Fails, Your api key: ****KEYZ is invalid", "type": "authentication_error", "param": null, "code": "invalid_request_error"}}',
  balance402: 'API error 402: {"error": {"message": "Insufficient Balance", "type": "unknown_error", "param": null, "code": "invalid_request_error"}}',
  model400: 'API error 400: {"error": {"message": "Model Not Exist", "type": "invalid_request_error", "param": null, "code": "invalid_request_error"}}',
  model404: 'API error 404: {"error": {"message": "The model `x` does not exist", "type": "invalid_request_error", "param": null, "code": "model_not_found"}}',
  rate429: 'API error 429: {"error": {"message": "Rate limit reached for requests", "type": "rate_limit_reached_error", "param": null, "code": "rate_limit_exceeded"}}',
  server500: 'API error 500: {"error": {"message": "internal", "type": "server_error"}}',
  refused: 'send request: Post "http://127.0.0.1:9/v1/chat/completions": dial tcp 127.0.0.1:9: connect: connection refused',
  eof: 'send request: Post "http://127.0.0.1:18999/v1/chat/completions": EOF',
  headerTimeout: 'send request: Post "https://api.deepseek.com/v1/chat/completions": net/http: timeout awaiting response headers',
} as const;

/** Stream body exactly as FastClaw v1.4.0 sends it: role delta, then a stop chunk carrying `error`, then [DONE]. */
function sseBody(message: string): string {
  const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model: "agt_x" };
  const role = { ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] };
  const last = { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], error: { type: "server_error", code: "agent_error", message } };
  return `data: ${JSON.stringify(role)}\n\n: ping\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`;
}

async function failureOf(res: () => Response): Promise<unknown> {
  const client = new FastClawClient({ baseUrl: "http://127.0.0.1:1", token: TOKEN, fetchImpl: async () => res(), retry: { maxAttempts: 1 } });
  const stream = fastClawChatStream(client, "agt_x");
  try {
    for await (const ev of stream({ sessionKey: "heybe:chat:s", content: "hi", signal: new AbortController().signal })) void ev;
  } catch (err) {
    return err;
  }
  throw new Error("expected the stream to fail");
}

const viaStream = (m: string) => failureOf(() => new Response(sseBody(m), { headers: { "content-type": "text/event-stream" } }));
const via502 = (m: string) =>
  failureOf(
    () =>
      new Response(JSON.stringify({ error: { code: "agent_error", message: m, type: "server_error" } }), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
  );

const cases: Array<[keyof typeof OBSERVED, string, string | undefined]> = [
  ["key401", "key_invalid", "upstream_401"],
  ["balance402", "insufficient_balance", "upstream_402"],
  ["model400", "model_not_found", "upstream_400"],
  ["model404", "model_not_found", "upstream_404"],
  ["rate429", "rate_limited", "upstream_429"],
  ["refused", "network", "upstream_unreachable"],
  ["eof", "network", "upstream_unreachable"],
  ["headerTimeout", "timeout", "upstream_timeout"],
  ["server500", "unknown", "upstream_500"],
];

describe("classifyChatError on observed FastClaw v1.4.0 errors", () => {
  for (const via of [
    ["stream in-band error", viaStream],
    ["non-stream 502", via502],
  ] as const) {
    for (const [name, reason, code] of cases) {
      it(`${via[0]}: ${name} → ${reason}`, async () => {
        const c = classifyChatError(await via[1](OBSERVED[name]));
        expect(c.reason).toBe(reason);
        expect(c.code).toBe(code);
        expect(c.kind).toBe("failed");
        expect(c.message).toBe(chatErrorMessage(c.reason, c.code));
      });
    }
  }

  it("401 shows exactly 「模型密钥无效，请到设置里更换」", async () => {
    expect(classifyChatError(await viaStream(OBSERVED.key401)).message).toBe("模型密钥无效，请到设置里更换");
  });

  it("unmapped errors show a generic reason plus a short code", async () => {
    const c = classifyChatError(await viaStream(OBSERVED.server500));
    expect(c.message).toBe(`${CHAT_ERROR_MESSAGES.unknown}（错误码 upstream_500）`);
    expect(classifyChatError(await viaStream("something odd happened")).message).toBe(`${CHAT_ERROR_MESSAGES.unknown}（错误码 agent_error）`);
    expect(classifyUpstreamStatus(400, 'API error 400: {"error": {"message": "bad", "type": "invalid_request_error"}}').code).toBe(
      "upstream_400/invalid_request_error",
    );
  });

  it("never leaks the key, the masked key, the token or upstream text", async () => {
    const real = "sk-0123456789abcdefREALKEY";
    const nasty = `API error 401: {"error": {"message": "bad key ${real} ****KEYZ", "type": "authentication_error\\"${real}"}}`;
    for (const m of [...Object.values(OBSERVED), nasty, `weird ${real} ${TOKEN}`]) {
      for (const err of [await viaStream(m), await via502(m)]) {
        const out = JSON.stringify(classifyChatError(err));
        expect(out).not.toContain(real);
        expect(out).not.toContain(TOKEN);
        expect(out).not.toContain("KEYZ");
        expect(out).not.toMatch(/sk-|Authentication Fails|Insufficient Balance|Rate limit|127\.0\.0\.1|deepseek/i);
      }
    }
  });

  it("other mappings: truncated stream, local gateway down / token refused, 429 insufficient_quota", () => {
    expect(classifyChatError({ kind: "network", code: "stream_truncated" })).toMatchObject({ kind: "interrupted", reason: "interrupted" });
    expect(classifyChatError({ kind: "network", message: "FastClaw POST /v1/chat/completions failed (network): fetch failed" })).toMatchObject({
      kind: "unavailable",
      reason: "runtime_unavailable",
      message: "本地运行时未响应",
    });
    expect(classifyChatError({ kind: "timeout" }).reason).toBe("runtime_unavailable");
    expect(classifyChatError({ kind: "4xx", status: 401, code: "unauthorized", message: "FastClaw POST /v1/chat/completions failed (4xx): unauthorized: invalid api key" })).toMatchObject({
      reason: "runtime_unavailable",
      code: "fastclaw_401",
    });
    expect(classifyUpstreamStatus(429, 'API error 429: {"error": {"type": "insufficient_quota", "code": "insufficient_quota"}}').reason).toBe("insufficient_balance");
    expect(classifyChatError(null)).toMatchObject({ reason: "unknown", code: "unknown" });
  });
});
