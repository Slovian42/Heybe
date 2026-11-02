import { chatErrorMessage, type ChatServiceEvent } from "@heybe/shared-types/chat";

import { parseServiceSse, StreamTruncatedError } from "./sse";

export interface StreamChatInput {
  baseUrl: string;
  /** Startup token from service_info; sent as Bearer. */
  token: string;
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
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        authorization: `Bearer ${input.token}`,
      },
      body: JSON.stringify({ content: input.content }),
      signal: input.signal,
    });
  } catch {
    if (input.signal?.aborted) return;
    yield { type: "error", kind: "unavailable", reason: "runtime_unavailable", message: "连不上本地服务" };
    return;
  }
  if (!res.ok || !res.body) {
    // The local service refused before streaming (bad token, bad request, crash): generic text + code.
    const code = res.ok ? "service_empty_body" : `service_${res.status}`;
    yield { type: "error", kind: "failed", reason: "unknown", code, message: chatErrorMessage("unknown", code) };
    return;
  }
  try {
    yield* parseServiceSse(res.body);
  } catch (err) {
    if (input.signal?.aborted) return;
    // StreamTruncatedError or a socket error mid-body: outcome unknown (#9).
    void (err instanceof StreamTruncatedError);
    yield { type: "error", kind: "interrupted", reason: "interrupted", message: "中断，结果未知" };
  }
}
