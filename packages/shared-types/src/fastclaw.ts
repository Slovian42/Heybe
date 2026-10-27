// Wire types for the FastClaw v1.4.0 app-integration API (/v1/* only).
// Shapes follow tag v1.4.0 (commit b5ad3dff1f230d692e4e1d5ad9ce486f24749964):
// internal/api/server.go RegisterRoutes, openai.go, agents.go, files.go.
// Runtime behavior against a live process is still unverified.

/** Upstream tag these types were read from. Not a live compatibility guarantee. */
export const FASTCLAW_WIRE_VERSION = "v1.4.0" as const;

/**
 * Agent record returned by GET /v1/agents and GET /v1/agents/{id}.
 * `name` is deprecated upstream and equals `id`; show `display_name`.
 */
export interface V1Agent {
  id: string;
  display_name: string;
  /** @deprecated Equals `id`. Use `display_name` for the human-readable name. */
  name: string;
  description: string;
  /** Agent-configured model override. Empty string means the account default. */
  model: string;
  metadata: Record<string, string>;
  created_at: string;
  updated_at: string;
}

/** POST /v1/agents body (`createAgentRequest` in internal/api/agents.go). */
export interface V1CreateAgentRequest {
  name: string;
  description?: string;
  instructions?: string;
  model?: string;
  metadata?: Record<string, string>;
}

/** DELETE /v1/agents/{id} body. */
export interface V1AgentDeleted {
  id: string;
  deleted: true;
}

/** GET /v1/agents body. Newest first. */
export interface V1AgentList {
  agents: V1Agent[];
  has_more: boolean;
  next_cursor?: string;
}

export interface V1ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  /**
   * Plain text. FastClaw keeps history itself and only sends the last
   * user message to the agent. Do not resend old turns.
   */
  content: string;
}

/**
 * Body of POST /v1/chat/completions.
 * Sessions are not a separate resource: the client sends
 * `X-Fastclaw-Session-Key` (and optionally `user` / `X-Fastclaw-End-User`).
 */
export interface V1ChatRequest {
  /** Selects the agent. Wins over the `X-Fastclaw-Agent-ID` header. */
  agent_id?: string;
  /**
   * Optional OpenAI-compatible model id echoed in the response.
   *
   * This field does not override the Agent's model configuration.
   * 该字段不会覆盖 Agent 自身的模型配置。
   *
   * In FastClaw v1.4.0 `HandleChatCompletions` (`internal/api/openai.go`)
   * a non-empty `model` is copied only into the response object's `model`
   * field. The agent turn is `ag.HandleMessage` and does not receive this
   * value, so the agent's own configuration decides which model runs.
   * To switch or fall back, change the agent configuration or call a
   * different agent. Do not use this field for that.
   */
  model?: string;
  messages: V1ChatMessage[];
  stream?: boolean;
  /** End-user id. Wins over `X-Fastclaw-End-User`. Not an email or display name. */
  user?: string;
  /** Per-turn structured context. Not persisted. */
  params?: Record<string, unknown>;
  project_id?: string;
  /** `"inline"` adds `data_url` on produced files (size limits apply upstream). */
  return_files?: "inline";
}

export interface V1Usage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens?: number };
  input_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  model_calls?: number;
}

/** A file the agent produced during a turn. `url` is a /v1 download URL. */
export interface V1TurnFile {
  name: string;
  path: string;
  size: number;
  content_type: string;
  url: string;
  data_url?: string;
}

export interface V1ApiError {
  type: string;
  code: string;
  message: string;
}

export interface V1ChatCompletion {
  id: string;
  object: string;
  created: number;
  /**
   * Response echo. When the request set `model`, this is that echo and
   * not proof that the agent's configured model changed. See `V1ChatRequest.model`.
   */
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: V1Usage;
  files?: V1TurnFile[];
}

/** One tool step on a streaming chunk (`running` then `done`). */
export interface V1ChunkTool {
  id: string;
  name: string;
  status: string;
}

/** One SSE JSON payload from a streaming chat completion. */
export interface V1ChatChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Array<{
    index?: number;
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
  usage?: V1Usage;
  files?: V1TurnFile[];
  tool?: V1ChunkTool;
  /** Present on the final chunk when the turn failed. HTTP status is still 200. */
  error?: V1ApiError;
}

/** Events parsed from a chat SSE stream. In-band `error` chunks are not included; the client throws. */
export type V1StreamEvent =
  | { type: "delta"; content: string }
  | { type: "tool"; tool: V1ChunkTool }
  | {
      type: "done";
      finishReason: string | null;
      usage?: V1Usage;
      files?: V1TurnFile[];
    };

/**
 * Local handle for a FastClaw conversation.
 * v1.4.0 has no POST /v1/sessions. The server creates the session when the
 * first POST /v1/chat/completions carries `X-Fastclaw-Session-Key`.
 */
export interface FastClawSession {
  agentId: string;
  sessionKey: string;
  endUser?: string;
  projectId?: string;
}

/** Bytes from GET /v1/agents/{id}/sessions/{session}/files/{path}. */
export interface FastClawFileDownload {
  bytes: Uint8Array;
  contentType: string | null;
  fileName: string | null;
}
