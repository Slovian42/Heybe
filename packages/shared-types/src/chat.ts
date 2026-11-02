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

/**
 * Why a chat turn failed (#19 Mac 复验问题 2). FastClaw v1.4.0 relays model failures as
 * `agent_error` whose message is `API error <status>: <upstream body>` (stream: an in-band
 * `error` on the last chunk; non-stream: HTTP 502), or `send request: Post "…": <Go error>`
 * when the upstream cannot be reached. Rules live in services/task-manager/src/chat-errors.ts;
 * observed bodies are listed in docs/t19-desktop-chat.md.
 */
export type ChatErrorReason =
  /** Upstream 401/403 or authentication_error: the model key is wrong, expired or revoked. */
  | "key_invalid"
  /** Upstream 402, "Insufficient Balance", or insufficient_quota. */
  | "insufficient_balance"
  /** Upstream 429 (FastClaw already retried ~60s). */
  | "rate_limited"
  /** Upstream unreachable: DNS, refused, reset, EOF (FastClaw already retried ~60s). */
  | "network"
  /** Upstream too slow: header timeout / deadline exceeded. */
  | "timeout"
  /** Upstream 404 / model_not_found / "Model Not Exist". */
  | "model_not_found"
  /** Stream cut before [DONE]; the server-side outcome is unknown (#9). */
  | "interrupted"
  /** The local FastClaw gateway did not answer, or rejected Heybe's own token. */
  | "runtime_unavailable"
  /** Anything else; `code` carries a short error code. */
  | "unknown";

/** Chinese text shown in the UI for each reason (`unknown` gets the code appended). */
export const CHAT_ERROR_MESSAGES: Readonly<Record<ChatErrorReason, string>> = {
  key_invalid: "模型密钥无效，请到设置里更换",
  insufficient_balance: "模型账户余额不足，请充值后再试",
  rate_limited: "模型服务限流了（请求太频繁），请稍等一会儿再试",
  network: "连不上模型服务，请检查网络后再试",
  timeout: "模型服务响应超时，请稍后再试",
  model_not_found: "模型不存在，请到设置里检查模型名",
  interrupted: "中断，结果未知",
  runtime_unavailable: "本地运行时未响应",
  unknown: "没做成，请稍后再试",
};

/** Text for a reason; `unknown` (and any reason given a code) shows `（错误码 …）`. */
export function chatErrorMessage(reason: ChatErrorReason, code?: string): string {
  const base = CHAT_ERROR_MESSAGES[reason];
  return reason === "unknown" && code ? `${base}（错误码 ${code}）` : base;
}

export type ChatServiceEvent =
  | { type: "delta"; content: string }
  | { type: "tool"; id: string; name: string; status: "running" | "done" }
  | { type: "done"; finishReason: string | null }
  | {
      type: "error";
      kind: ChatErrorKind;
      /** Specific cause; absent from older services (treat as `unknown`). */
      reason?: ChatErrorReason;
      /** Short machine code, e.g. `upstream_500`, `agent_error`; never contains upstream text or keys. */
      code?: string;
      /** Ready-to-show Chinese text (see CHAT_ERROR_MESSAGES). */
      message: string;
    };

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
