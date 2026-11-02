import type { ChatServiceEvent } from "@heybe/shared-types/chat";

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
}

export interface ChatState {
  messages: ChatMessage[];
  /** Set after a stop: FastClaw v1.4.0 may still answer the orphaned turn (#9). */
  stoppedBefore: boolean;
}

export type ChatAction =
  | { type: "send"; userId: string; assistantId: string; content: string }
  | { type: "event"; assistantId: string; event: ChatServiceEvent }
  | { type: "stop"; assistantId: string }
  | { type: "end"; assistantId: string };

export const initialChatState: ChatState = { messages: [], stoppedBefore: false };

/** Tools that touch the network or host; shown with a warning (#67 list). */
export const WARN_TOOLS = new Set(["web_fetch", "exec", "shell", "write_file", "edit_file"]);

export const STATUS_TEXT: Record<MessageStatus, string> = {
  streaming: "",
  done: "",
  stopped: "已停止（服务端是否停止未知）",
  interrupted: "中断，结果未知",
  failed: "没做成",
  unavailable: "本地服务未响应",
};

function update(state: ChatState, id: string, fn: (m: ChatMessage) => ChatMessage): ChatState {
  return { ...state, messages: state.messages.map((m) => (m.id === id ? fn(m) : m)) };
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send":
      return {
        stoppedBefore: state.stoppedBefore,
        messages: [
          ...state.messages,
          { id: action.userId, role: "user", text: action.content, status: "done", tools: [] },
          { id: action.assistantId, role: "assistant", text: "", status: "streaming", tools: [] },
        ],
      };
    case "event":
      return update(state, action.assistantId, (m) => {
        if (m.status !== "streaming") return m; // late events after stop are dropped
        const ev = action.event;
        if (ev.type === "delta") return { ...m, text: m.text + ev.content };
        if (ev.type === "tool") {
          const step = { id: ev.id, name: ev.name, status: ev.status };
          const known = m.tools.some((t) => t.id === ev.id);
          return { ...m, tools: known ? m.tools.map((t) => (t.id === ev.id ? step : t)) : [...m.tools, step] };
        }
        if (ev.type === "done") return { ...m, status: "done" };
        return { ...m, status: ev.kind };
      });
    case "stop": {
      const next = update(state, action.assistantId, (m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m));
      return { ...next, stoppedBefore: true };
    }
    case "end":
      // Stream closed without a done/error event: treat as interrupted, never as success.
      return update(state, action.assistantId, (m) => (m.status === "streaming" ? { ...m, status: "interrupted" } : m));
  }
}
