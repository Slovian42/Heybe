import {
  FASTCLAW_ALERT_TOOLS,
  chatErrorMessage,
  type ChatErrorReason,
  type ChatModelSource,
  type ChatTurnSnapshot,
  type ChatWireEvent,
} from "@heybe/shared-types/chat";

export type MessageStatus = "streaming" | "done" | "stopped" | "interrupted" | "failed" | "unavailable";

export interface ToolStep {
  id: string;
  name: string;
  status: "running" | "done";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  status: MessageStatus;
  tools: ToolStep[];
  /** Why it failed, from the service's error event (e.g. 「模型密钥无效，请到设置里更换」). */
  error?: { reason: ChatErrorReason; code?: string; message: string };
  /** Service turn id (assistant messages), for resume and stop. */
  turnId?: string;
  /** Highest event `seq` applied; replayed events at or below it are skipped (no double text). */
  lastSeq?: number;
  /** Provider and model the gateway reported for this turn. */
  source?: ChatModelSource;
}

export interface ChatState {
  messages: ChatMessage[];
  /** Set after a stop: FastClaw v1.4.0 may still answer the orphaned turn (#9). */
  stoppedBefore: boolean;
}

export type ChatAction =
  | { type: "send"; userId: string; assistantId: string; content: string }
  | { type: "event"; assistantId: string; event: ChatWireEvent }
  | { type: "stop"; assistantId: string }
  | { type: "end"; assistantId: string }
  | { type: "load"; turns: ChatTurnSnapshot[] };

export const initialChatState: ChatState = { messages: [], stoppedBefore: false };

/**
 * Tools shown with a warning: same list the task manager alerts on
 * (#67 Agent-management tools + docs/t043 §3 cron tools; see shared-types/chat.ts).
 */
export const WARN_TOOLS: ReadonlySet<string> = new Set(FASTCLAW_ALERT_TOOLS);

export const STATUS_TEXT: Record<MessageStatus, string> = {
  streaming: "",
  done: "",
  stopped: "已停止（服务端是否停止未知）",
  interrupted: "中断，结果未知",
  // Only when an old service sent no reason: still says what to do, never a bare 「没做成」.
  failed: chatErrorMessage("unknown"),
  unavailable: "本地服务未响应",
};

/** Shown under the conversation after a stop (FastClaw has no /v1 stop, #9). */
export const STOPPED_HINT = "上一轮已停止，服务端可能仍会补完";

/** Text under a message: the specific failure reason when the service sent one, else the generic status text. */
export function statusText(m: Pick<ChatMessage, "status" | "error">): string {
  if (m.error && (m.status === "failed" || m.status === "unavailable" || m.status === "interrupted")) return m.error.message;
  return STATUS_TEXT[m.status];
}

function update(state: ChatState, id: string, fn: (m: ChatMessage) => ChatMessage): ChatState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? fn(m) : m)) };
}

export const userIdOf = (turnId: string) => `u-${turnId}`;
export const assistantIdOf = (turnId: string) => `a-${turnId}`;

function fromSnapshot(t: ChatTurnSnapshot): [ChatMessage, ChatMessage] {
  return [
    { id: userIdOf(t.id), role: "user", text: t.userContent, status: "done", tools: [], turnId: t.id },
    {
      id: assistantIdOf(t.id),
      role: "assistant",
      text: t.text,
      status: t.status,
      tools: t.tools,
      turnId: t.id,
      lastSeq: t.lastSeq,
      ...(t.error ? { error: t.error } : {}),
      ...(t.source ? { source: t.source } : {}),
    },
  ];
}

function applyEvent(m: ChatMessage, ev: ChatWireEvent): ChatMessage {
  if (ev.seq !== undefined && m.lastSeq !== undefined && ev.seq <= m.lastSeq) return m; // replayed: already applied
  const next: ChatMessage = ev.seq !== undefined ? { ...m, lastSeq: ev.seq } : m;
  if (ev.type === "snapshot") {
    // The turn ended while we were away: take the stored final state as is.
    const [, a] = fromSnapshot(ev.turn);
    return { ...a, id: m.id };
  }
  if (ev.type === "turn") return { ...next, turnId: ev.turnId };
  if (m.status !== "streaming") return next; // late events after stop / end are dropped
  switch (ev.type) {
    case "source":
      return { ...next, source: ev.source };
    case "delta":
      return { ...next, text: m.text + ev.content };
    case "tool": {
      const step = { id: ev.id, name: ev.name, status: ev.status };
      const known = m.tools.some((t) => t.id === ev.id);
      return { ...next, tools: known ? m.tools.map((t) => (t.id === ev.id ? step : t)) : [...m.tools, step] };
    }
    case "done":
      return { ...next, status: "done" };
    case "stopped":
      return { ...next, status: "stopped" };
    case "error":
      return {
        ...next,
        status: ev.kind,
        error: { reason: ev.reason ?? "unknown", ...(ev.code ? { code: ev.code } : {}), message: ev.message || STATUS_TEXT[ev.kind] },
      };
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        stoppedBefore: state.stoppedBefore,
        messages: [
          ...state.messages,
          { id: action.userId, role: "user", text: action.content, status: "done", tools: [] },
          { id: action.assistantId, role: "assistant", text: "", status: "streaming", tools: [], lastSeq: 0 },
        ],
      };
    case "event": {
      const next = update(state, action.assistantId, (m) => applyEvent(m, action.event));
      return action.event.type === "stopped" ? { ...next, stoppedBefore: true } : next;
    }
    case "stop": {
      const next = update(state, action.assistantId, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m));
      return { ...next, stoppedBefore: true };
    }
    case "end":
      // Stream closed without a done/error event: treat as interrupted, never as success.
      return update(state, action.assistantId, (m) => (m.status === "streaming" ? { ...m, status: "interrupted" } : m));
    case "load": {
      // Rebuild from the service's SQLite (window reopened / UI reloaded / service reconnected).
      // A message we already have further along (live stream racing the load) is kept as is.
      const local = new Map(state.messages.filter((m) => m.turnId && m.role === "assistant").map((m) => [m.turnId!, m]));
      const messages = action.turns.flatMap((t) => {
        const [u, a] = fromSnapshot(t);
        const mine = local.get(t.id);
        if (!mine) return [u, a];
        // Keep the local id: a live stream may still dispatch to it. The stored state wins unless
        // ours is further along; a stored final status (e.g. service restarted) always wins over
        // a local "still streaming".
        const mineAhead = (mine.lastSeq ?? 0) > t.lastSeq;
        if (mineAhead && (t.status === "streaming" || mine.status !== "streaming")) return [u, mine];
        return [u, { ...a, id: mine.id, text: mineAhead && mine.text.length > a.text.length ? mine.text : a.text }];
      });
      const last = action.turns.at(-1);
      return { messages, stoppedBefore: last?.status === "stopped" };
    }
  }
}

/** The running assistant message, if any (one turn at a time per session). */
export function runningMessage(state: ChatState): ChatMessage | undefined {
  return state.messages.find((m) => m.role === "assistant" && m.status === "streaming");
}
