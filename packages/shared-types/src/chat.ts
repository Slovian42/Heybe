// Wire format between the Heybe local service and the desktop UI (#19, 19-d).
// The service re-emits FastClaw /v1 SSE as these events, one JSON object per `data:` line,
// and always ends with `data: [DONE]` (also after an error).

export type ChatErrorKind =
  /** Upstream stream was cut before [DONE]: the server-side outcome is unknown (#9). */
  | "interrupted"
  /** Upstream answered with an error (4xx/5xx/in-band error). */
  | "failed"
  /** Gateway unreachable or timed out before any reply. */
  | "unavailable";

export type ChatServiceEvent =
  | { type: "delta"; content: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" }
  | { type: "done"; finishReason: string | null }
  | { type: "error"; kind: ChatErrorKind; message: string };

export interface ChatSendRequest {
  content: string;
}

export const CHAT_SESSION_KEY_PREFIX = "heybe:chat:";
