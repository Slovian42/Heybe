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
  /** The sandbox refused to run a step (no sandbox available / host execution not allowed). */
  | "sandbox_denied"
  /** The local runtime itself failed (an `E_FC_*` service error code). */
  | "runtime_error"
  /** The local service was restarted while this turn was running; the outcome is unknown. */
  | "service_restarted"
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
  sandbox_denied: "沙箱拒绝执行这一步（没有可用的沙箱，或不允许在本机直接执行），没做成",
  runtime_error: "本地运行时出错",
  service_restarted: "本地服务重启过，这一轮中断了，结果未知",
  unknown: "没做成，请稍后再试",
};

/**
 * Chinese text for the local service / FastClaw gateway error codes (`HEYBE_SERVICE_ERROR`, see
 * services/task-manager/src/gateway.ts). Used when a chat turn fails with one of them.
 */
export const SERVICE_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  E_FC_PORT_BUSY: "FastClaw 端口被别的程序占用，本地运行时起不来",
  E_FC_FOREIGN_GATEWAY: "端口上已经有一个不是 Heybe 启动的 FastClaw，本地运行时起不来",
  E_FC_VERSION_MISMATCH: "FastClaw 版本和 Heybe 要求的不一致，请重新安装同一版本",
  E_FC_READY_TIMEOUT: "FastClaw 启动超时，本地运行时没有就绪",
  E_FC_EXITED: "FastClaw 意外退出了，本地运行时不可用",
  E_FC_SKILL_DISABLE_FAILED: "关闭 FastClaw 内置技能失败，本地运行时没有启动",
};

/** Text for a reason; `unknown` / `runtime_error` (given a code) show `（错误码 …）`. */
export function chatErrorMessage(reason: ChatErrorReason, code?: string): string {
  if (reason === "runtime_error" && code) {
    const known = SERVICE_ERROR_MESSAGES[code];
    return `${known ?? CHAT_ERROR_MESSAGES.runtime_error}（错误码 ${code}）`;
  }
  const base = CHAT_ERROR_MESSAGES[reason];
  return reason === "unknown" && code ? `${base}（错误码 ${code}）` : base;
}

/** Where a reply came from: cloud provider, local Ollama, or a custom OpenAI-compatible endpoint. */
export type ModelLocality = "cloud" | "local" | "custom";

/** The model FastClaw actually used for a turn (#19 part 2, item 4). */
export interface ChatModelSource {
  /** FastClaw provider name, e.g. `deepseek`, `ollama`, or an openai_compatible config id. */
  provider: string;
  /** Model id at the provider, e.g. `deepseek-chat`, `qwen2.5:3b`. */
  model: string;
  /** Display name of the provider, e.g. `DeepSeek`, `本地 Ollama`. */
  label: string;
  locality: ModelLocality;
}

const PROVIDER_LABELS: Readonly<Record<string, { label: string; locality: ModelLocality }>> = {
  deepseek: { label: "DeepSeek", locality: "cloud" },
  openai: { label: "OpenAI", locality: "cloud" },
  anthropic: { label: "Anthropic", locality: "cloud" },
  openrouter: { label: "OpenRouter", locality: "cloud" },
  ollama: { label: "本地 Ollama", locality: "local" },
};

const MODEL_TEXT = /^[\w.:/@+-]{1,160}$/;

/**
 * Parse the `model` FastClaw puts on every /v1 SSE chunk. It is the agent's configured
 * `<provider>/<model>` (agentcli normalizeProviderModel), i.e. what the turn really used.
 * Returns undefined for anything that does not look like a model id.
 */
export function modelSourceFromFastClaw(raw: string | undefined | null): ChatModelSource | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !MODEL_TEXT.test(text)) return undefined;
  const slash = text.indexOf("/");
  if (slash <= 0 || slash === text.length - 1) {
    return { provider: "", model: text, label: "未知提供方", locality: "custom" };
  }
  const provider = text.slice(0, slash).toLowerCase();
  const model = text.slice(slash + 1);
  const known = PROVIDER_LABELS[provider];
  if (known) return { provider, model, ...known };
  return { provider, model, label: `自定义接口 ${provider}`, locality: "custom" };
}

export const MODEL_LOCALITY_TEXT: Readonly<Record<ModelLocality, string>> = {
  cloud: "云端",
  local: "本地",
  custom: "自定义接口",
};

/** `DeepSeek · deepseek-chat`, `本地 Ollama · qwen2.5:3b`. */
export function modelSourceText(src: Pick<ChatModelSource, "label" | "model">): string {
  return `${src.label} · ${src.model}`;
}

export type ChatServiceEvent =
  /** First event of a turn stream: the turn id (for resume / stop) — #19 part 2. */
  | { type: "turn"; turnId: string }
  /** The model this turn used, from FastClaw's own chunk `model` field. */
  | { type: "source"; source: ChatModelSource }
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
    }
  /** Stopped by the user (POST /chat/turns/:id/stop). The server-side outcome is unknown. */
  | { type: "stopped" }
  /** Resume of a turn that already ended: its final state from SQLite. */
  | { type: "snapshot"; turn: ChatTurnSnapshot };

/** Every event on the wire carries `seq` (1, 2, …) so a resumed stream can skip what it has. */
export type ChatWireEvent = ChatServiceEvent & { seq?: number };

export type ChatTurnStatus = "streaming" | "done" | "stopped" | "interrupted" | "failed" | "unavailable";

/** One turn as stored in the task-manager SQLite (`chat_turns`), for restore after reopen/refresh. */
export interface ChatTurnSnapshot {
  id: string;
  sessionId: string;
  userContent: string;
  status: ChatTurnStatus;
  text: string;
  tools: Array<{ id: string; name: string; status: "running" | "done" }>;
  error?: { reason: ChatErrorReason; code?: string; message: string };
  source?: ChatModelSource;
  /** Last event seq folded into this snapshot; resume with `?after=<lastSeq>`. */
  lastSeq: number;
  createdAt: string;
  updatedAt: string;
}

/** GET /chat/sessions/:id */
export interface ChatSessionSnapshot {
  sessionId: string;
  turns: ChatTurnSnapshot[];
}

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
