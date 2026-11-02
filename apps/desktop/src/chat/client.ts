import type { ChatServiceEvent } from "@heybe/shared-types/chat";

import { parseServiceSse, StreamTruncatedError } from "./sse";

export interface StreamChatInput {
  baseUrl: string;
  sessionId: string;
  content: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * POST to the local Heybe service (never FastClaw directly, never its web/).
 * Transport problems become `error` events so the UI has one code path.
 * Aborting `signal` (stop button) ends the generator quietly.
 */
export async function* streamChat(input: StreamChatInput): AsyncGenerator<ChatServiceEvent> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/$/, "")}/chat/sessions/${encodeURIComponent(input.sessionId)}/messages`;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ content: input.content }),
      signal: input.signal,
    });
  } catch {
    if (input.signal?.aborted) return;
    yield { type: "error", kind: "unavailable", message: "连不上本地服务" };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", kind: "failed", message: "没做成" };
    return;
  }
  try {
    yield* parseServiceSse(res.body);
  } catch (err) {
    if (input.signal?.aborted) return;
    // StreamTruncatedError or a socket error mid-body: outcome unknown (#9).
    void (err instanceof StreamTruncatedError);
    yield { type: "error", kind: "interrupted", message: "中断，结果未知" };
  }
}
