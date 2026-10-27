// Typed client for FastClaw v1.4.0. ONLY the /v1/* app-integration API is allowed.
// The internal console API is not called from this package.
// Pinned upstream: docs/phase0-dev-env.md (FastClaw v1.4.0, b5ad3dff).
// The `model` field on chat requests does NOT override an Agent's model config.
// See V1ChatRequest.model in @heybe/shared-types.

export { FastClawConfigError, FastClawError, type FastClawErrorKind } from "./errors.js";
export { assertV1Path, sessionFilePath } from "./paths.js";
export {
  backoffDelayMs,
  isRetryableFastClawError,
  resolveRetry,
  RETRY_HARD_MAX_ATTEMPTS,
  RETRY_HARD_MAX_DELAY_MS,
  type RetryOptions,
} from "./retry.js";
export { parseChatSse, SseTruncatedError } from "./sse.js";
export {
  DEFAULT_FASTCLAW_END_USER,
  HEYBE_FASTCLAW_ADMIN_TOKEN,
  HEYBE_FASTCLAW_BASE_URL,
  HEYBE_FASTCLAW_CHAT_TOKEN,
  HEYBE_FASTCLAW_END_USER,
  HEYBE_FASTCLAW_TOKEN,
  loadFastClawClientConfig,
  type FastClawClientConfig,
  type FastClawClientRole,
} from "./config.js";
export {
  DEFAULT_TIMEOUT_MS,
  FASTCLAW_V1_ADMIN_ROUTES,
  FASTCLAW_V1_CLIENT_ROUTES,
  FastClawClient,
  fastClawAdminClientFromEnv,
  fastClawClientFromEnv,
  type CallOptions,
  type CreateAgentInput,
  type CreateSessionInput,
  type FastClawClientOptions,
  type GetSessionFileInput,
  type ListAgentsOptions,
  type SendMessageInput,
} from "./client.js";

export type {
  FastClawFileDownload,
  FastClawSession,
  V1Agent,
  V1AgentDeleted,
  V1AgentList,
  V1ApiError,
  V1CreateAgentRequest,
  V1ChatChunk,
  V1ChatCompletion,
  V1ChatMessage,
  V1ChatRequest,
  V1ChunkTool,
  V1StreamEvent,
  V1TurnFile,
  V1Usage,
} from "@heybe/shared-types";
