// Chat API for the desktop UI (#19, 19-d / 19-e).
// POST /chat/sessions/:id/messages -> SSE re-emitting FastClaw /v1/chat/completions.
// FastClaw v1.4.0 has no /v1 stop: when the UI disconnects we only drop the upstream
// connection; whether the server stopped is unknown (#9 / #58 wording lives in the UI).
import type { IncomingMessage, ServerResponse } from "node:http";

import type { FastClawClient } from "@heybe/fastclaw-adapter";
import type { V1StreamEvent } from "@heybe/shared-types";
import { CHAT_SESSION_KEY_PREFIX, type ChatErrorKind, type ChatServiceEvent } from "@heybe/shared-types/chat";

export interface ChatStreamInput {
  sessionKey: string;
  content: string;
  signal: AbortSignal;
}

/** Injected so tests use a mock; production wraps FastClawClient.streamMessage. */
export type ChatStreamFn = (input: ChatStreamInput) => AsyncIterable<V1StreamEvent>;

/** Production stream: FastClaw /v1/chat/completions only (no web/ console, no /api). */
export function fastClawChatStream(client: FastClawClient, agentId: string): ChatStreamFn {
  return ({ sessionKey, content, signal }) =>
    client.streamMessage(client.createSession({ agentId, sessionKey }), {
      messages: [{ role: "user", content }],
      signal,
      timeoutMs: 0,
    });
}

/** Webview origins allowed to call the chat API (Tauri 2 macOS + vite dev). */
export const CHAT_ALLOWED_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"];

export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !CHAT_ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    Vary: "Origin",
  };
}

export const CHAT_PATH = /^\/chat\/sessions\/([A-Za-z0-9_-]{1,128})\/messages$/;
const MAX_CONTENT = 100_000;

export function chatSessionKey(id: string): string {
  return `${CHAT_SESSION_KEY_PREFIX}${id}`;
}

/** Map FastClaw adapter errors to UI kinds without leaking upstream text. */
export function classifyChatError(err: unknown): { kind: ChatErrorKind; message: string } {
  const e = err as { code?: string; kind?: string } | null;
  if (e?.code === "stream_truncated") return { kind: "interrupted", message: "中断，结果未知" };
  if (e?.kind === "network" || e?.kind === "timeout") return { kind: "unavailable", message: "本地运行时未响应" };
  return { kind: "failed", message: "没做成" };
}

export function toServiceEvent(ev: V1StreamEvent): ChatServiceEvent {
  if (ev.type === "delta") return { type: "delta", content: ev.content };
  if (ev.type === "tool") {
    return { type: "tool", id: ev.tool.id, name: ev.tool.name, status: ev.tool.status === "running" ? "running" : "done" };
  }
  return { type: "done", finishReason: ev.finishReason };
}

function write(res: ServerResponse, event: ChatServiceEvent | "[DONE]"): void {
  res.write(`data: ${event === "[DONE]" ? event : JSON.stringify(event)}\n\n`);
}

export async function handleChatMessage(
  req: IncomingMessage,
  res: ServerResponse,
  id: string,
  rawBody: string,
  stream: ChatStreamFn,
): Promise<void> {
  const parsed = JSON.parse(rawBody || "{}") as { content?: unknown };
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!content || content.length > MAX_CONTENT) {
    res.writeHead(400, { ...corsHeaders(req.headers.origin), "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "content must be a non-empty string" }));
    return;
  }

  const upstream = new AbortController();
  // UI pressed stop (or closed): drop the upstream connection right away.
  res.on("close", () => {
    if (!res.writableFinished) upstream.abort();
  });

  res.writeHead(200, {
    ...corsHeaders(req.headers.origin),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  try {
    for await (const ev of stream({ sessionKey: chatSessionKey(id), content, signal: upstream.signal })) {
      if (upstream.signal.aborted) break;
      write(res, toServiceEvent(ev));
    }
  } catch (err) {
    if (upstream.signal.aborted) return;
    write(res, { type: "error", ...classifyChatError(err) });
  }
  if (!upstream.signal.aborted) {
    write(res, "[DONE]");
    res.end();
  }
}
