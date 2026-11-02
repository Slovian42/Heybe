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

/**
 * Tool names that must be flagged to the user (single source for UI and task manager).
 * Source: PR/issue #67 (Agent-management tools, verified on FastClaw v1.4.0 b5ad3dff):
 *   create_agent, configure_agent, check_agent, delete_agent, spawn_subagent, delegate_task, install_skill.
 * Plus scheduling tools from docs/t043 §3 (Heybe's task manager must stay the only timer):
 *   create_cron_job, delete_cron_job.
 * `delete_agent` does not exist in v1.4.0; listed in case a later version adds it.
 */
export const FASTCLAW_ALERT_TOOLS = [
  "create_agent",
  "configure_agent",
  "check_agent",
  "delete_agent",
  "spawn_subagent",
  "delegate_task",
  "install_skill",
  "create_cron_job",
  "delete_cron_job",
] as const;
