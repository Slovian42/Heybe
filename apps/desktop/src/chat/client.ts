import {
  chatErrorMessage,
  type ChatServiceEvent,
  type ChatTurnSnapshot,
  type ChatWireEvent,
} from "@heybe/shared-types/chat";

import { parseServiceSse } from "./sse";

/**
 * What a chat stream yields: service events (with `seq`), or `cut` when the connection to the
 * local service dropped before [DONE]. `cut` is not an outcome: the turn keeps running in the
 * service (closing the window never stops it), so the UI resumes it with `after = lastSeq`.
 */
export type ChatStreamItem = ChatWireEvent | { type: "cut" };

interface Conn {
  baseUrl: string;
  /** Startup token from service_info; sent as Bearer. */
  token: string;
  fetchImpl?: typeof fetch;
}

export interface StreamChatInput extends Conn {
  sessionId: string;
  content: string;
  signal?: AbortSignal;
}

export interface ResumeTurnInput extends Conn {
  turnId: string;
  /** Last `seq` the UI has; the service replays everything after it. */
  after: number;
  signal?: AbortSignal;
}

export interface ChatSessionResponse {
  sessionId: string;
  turns: ChatTurnSnapshot[];
  activeTurnId: string | null;
}

const base = (u: string) => u.replace(/\/$/, "");
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** The local service answered with an HTTP error before streaming: say which, in Chinese. */
export function serviceHttpError(status: number): ChatServiceEvent {
  if (status === 401) {
    return { type: "error", kind: "unavailable", reason: "runtime_unavailable", code: "service_401", message: "本地服务拒绝了这次请求（启动令牌不对），请退出后重开 Heybe" };
  }
  if (status === 409) {
    return {
      type: "error",
      kind: "failed",
      reason: "unknown",
      code: "service_409",
      message: "这个会话上一轮还没结束，请等它结束或先停止",
    };
  }
  const code = `service_${status}`;
  return { type: "error", kind: "failed", reason: "unknown", code, message: chatErrorMessage("unknown", code) };
}

async function* consume(doFetch: () => Promise<Response>, signal: AbortSignal | undefined): AsyncGenerator<ChatStreamItem> {
  let res: Response;
  try {
    res = await doFetch();
  } catch {
    if (signal?.aborted) return;
    yield { type: "error", kind: "unavailable", reason: "runtime_unavailable", message: "连不上本地服务" };
    return;
  }
  if (!res.ok || !res.body) {
    yield res.ok
      ? { type: "error", kind: "failed", reason: "unknown", code: "service_empty_body", message: chatErrorMessage("unknown", "service_empty_body") }
      : serviceHttpError(res.status);
    return;
  }
  try {
    yield* parseServiceSse(res.body);
  } catch {
    if (signal?.aborted) return;
    // Truncated body or socket error: the local connection is gone, not necessarily the turn.
    yield { type: "cut" };
  }
}

/**
 * POST to the local Heybe service (never FastClaw directly, never its web/).
 * Aborting `signal` only stops reading here; use `stopTurn` to stop the turn itself.
 */
export function streamChat(input: StreamChatInput): AsyncGenerator<ChatStreamItem> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${base(input.baseUrl)}/chat/sessions/${encodeURIComponent(input.sessionId)}/messages`;
  return consume(
    () =>
      doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream", ...auth(input.token) },
        body: JSON.stringify({ content: input.content }),
        signal: input.signal,
      }),
    input.signal,
  );
}

/** Re-attach to a turn (window reopened, page reloaded, local connection dropped). */
export function resumeTurn(input: ResumeTurnInput): AsyncGenerator<ChatStreamItem> {
  const doFetch = input.fetchImpl ?? fetch;
  const url = `${base(input.baseUrl)}/chat/turns/${encodeURIComponent(input.turnId)}/events?after=${Math.max(0, Math.floor(input.after))}`;
  return consume(() => doFetch(url, { headers: { accept: "text/event-stream", ...auth(input.token) }, signal: input.signal }), input.signal);
}

/** Turns kept in the service's SQLite for this session (newest 200) and the running one, if any. */
export async function loadSession(input: Conn & { sessionId: string }): Promise<ChatSessionResponse> {
  const doFetch = input.fetchImpl ?? fetch;
  const res = await doFetch(`${base(input.baseUrl)}/chat/sessions/${encodeURIComponent(input.sessionId)}`, { headers: auth(input.token) });
  if (!res.ok) throw new Error(`load session failed: ${res.status}`);
  const body = (await res.json()) as Partial<ChatSessionResponse>;
  return {
    sessionId: input.sessionId,
    turns: Array.isArray(body.turns) ? body.turns : [],
    activeTurnId: typeof body.activeTurnId === "string" ? body.activeTurnId : null,
  };
}

/**
 * Ask the service to stop a turn. Best effort: the UI already shows 「已停止」; FastClaw has no
 * /v1 stop, so whether the server really stopped stays unknown either way.
 */
export async function stopTurn(input: Conn & { turnId: string }): Promise<void> {
  const doFetch = input.fetchImpl ?? fetch;
  try {
    await doFetch(`${base(input.baseUrl)}/chat/turns/${encodeURIComponent(input.turnId)}/stop`, { method: "POST", headers: auth(input.token) });
  } catch {
    // service gone: the turn ends as interrupted on its side anyway
  }
}
