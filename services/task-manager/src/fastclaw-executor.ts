import type Database from "better-sqlite3";
import type { ExecutionRequest, ExecutionResult, NodeExecutor } from "@heybe/shared-types/task-manager";
import {
  FastClawClient,
  FastClawConfigError,
  FastClawError,
  fastClawClientFromEnv,
} from "@heybe/fastclaw-adapter";

import { insertEvent } from "./events.js";
import { cancelTask, type CancelTaskOptions } from "./tasks.js";
import { isoNow } from "./time.js";

/** Optional agent id used when a node has no assigned agent. */
export const HEYBE_FASTCLAW_AGENT_ID = "HEYBE_FASTCLAW_AGENT_ID";
/** Per-node stream timeout in ms (0 disables). Default 600000. */
export const HEYBE_FASTCLAW_TIMEOUT_MS = "HEYBE_FASTCLAW_TIMEOUT_MS";

export const FastClawEventType = {
  DispatchStarted: "fastclaw_dispatch_started",
  Tool: "fastclaw_tool",
  StreamError: "fastclaw_stream_error",
  StreamDone: "fastclaw_stream_done",
  ConnectionAborted: "fastclaw_connection_aborted",
} as const;

/** Wording required by #58: we only know the client connection was dropped. */
export const ABORT_NOTE = "连接已断开，服务端是否停止未知";

/**
 * #9: the stream ended without [DONE] (gateway stopped / restarted, or the connection broke).
 * v1.4.0 keeps the user message but drops the partial reply, and the next turn on the same
 * session answers that orphan message — so do not auto-retry on the same session key.
 */
export const TRUNCATED_NOTE = "流被中断（未收到 [DONE]），服务端执行结果未知，需人工核查；不要在同一会话自动重试";

export interface FastClawNodeExecutorOptions {
  client: FastClawClient;
  defaultAgentId?: string;
  timeoutMs?: number;
  buildPrompt?: (request: ExecutionRequest) => string;
  now?: () => string;
}

export function sessionKeyFor(request: Pick<ExecutionRequest, "taskId" | "nodeId">): string {
  return `heybe:task:${request.taskId}:node:${request.nodeId}`;
}

export function defaultPrompt(request: ExecutionRequest): string {
  const lines = [`任务目标：${request.goal}`];
  if (request.acceptanceCriteria) lines.push(`验收标准：${request.acceptanceCriteria}`);
  return lines.join("\n");
}

/**
 * NodeExecutor backed by FastClaw /v1 streamMessage.
 * Completion only reaches awaiting_review; a person still accepts it.
 * Cancel aborts the HTTP request; FastClaw v1.4.0 has no /v1 stop, so the
 * server-side state is recorded as unknown.
 */
export class FastClawNodeExecutor implements NodeExecutor {
  readonly #inflight = new Map<string, { taskId: string; nodeId: string; controller: AbortController }>();
  readonly #now: () => string;

  constructor(
    private readonly db: Database.Database,
    private readonly opts: FastClawNodeExecutorOptions,
  ) {
    this.#now = opts.now ?? isoNow;
  }

  /** Number of requests currently streaming. */
  get inflightCount(): number {
    return this.#inflight.size;
  }

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    const base = { taskId: request.taskId, nodeId: request.nodeId, attemptId: request.attemptId };
    const agentId = request.agentId ?? this.opts.defaultAgentId ?? null;
    if (!agentId) {
      const error = `节点未指定 agent，且未设置 ${HEYBE_FASTCLAW_AGENT_ID}`;
      insertEvent(this.db, { ...base, type: FastClawEventType.StreamError, data: { code: "no_agent", message: error }, at: this.#now() });
      return { outcome: "failed", error };
    }
    const session = this.opts.client.createSession({ agentId, sessionKey: sessionKeyFor(request) });
    const controller = new AbortController();
    this.#inflight.set(request.attemptId, { taskId: request.taskId, nodeId: request.nodeId, controller });
    insertEvent(this.db, {
      ...base,
      type: FastClawEventType.DispatchStarted,
      data: { agentId, sessionKey: session.sessionKey, executionVersion: request.executionVersion },
      at: this.#now(),
    });
    let chars = 0;
    try {
      for await (const event of this.opts.client.streamMessage(session, {
        messages: [{ role: "user", content: (this.opts.buildPrompt ?? defaultPrompt)(request) }],
        signal: controller.signal,
        timeoutMs: this.opts.timeoutMs ?? 600_000,
      })) {
        if (event.type === "delta") chars += event.content.length;
        else if (event.type === "tool") {
          insertEvent(this.db, {
            ...base,
            type: FastClawEventType.Tool,
            data: { id: event.tool.id, name: event.tool.name, status: event.tool.status },
            at: this.#now(),
          });
        } else if (event.type === "done") {
          insertEvent(this.db, {
            ...base,
            type: FastClawEventType.StreamDone,
            data: { finishReason: event.finishReason, chars, usage: event.usage ?? null, files: event.files?.length ?? 0 },
            at: this.#now(),
          });
        }
      }
      return { outcome: "awaiting_review", checkpoint: { sessionKey: session.sessionKey, chars } };
    } catch (err) {
      if (controller.signal.aborted) {
        // Event already written by abortTask; outcome needs a human check.
        return { outcome: "needs_check", error: ABORT_NOTE };
      }
      const data =
        err instanceof FastClawError
          ? { kind: err.kind, status: err.status ?? null, code: err.code ?? null, message: err.message }
          : { kind: "unknown", status: null, code: null, message: err instanceof Error ? err.message : String(err) };
      if (err instanceof FastClawError && err.code === "stream_truncated") {
        insertEvent(this.db, {
          ...base,
          type: FastClawEventType.StreamError,
          data: { ...data, chars, note: TRUNCATED_NOTE, serverStopped: "unknown" },
          at: this.#now(),
        });
        return { outcome: "needs_check", error: TRUNCATED_NOTE };
      }
      insertEvent(this.db, { ...base, type: FastClawEventType.StreamError, data, at: this.#now() });
      return { outcome: "failed", error: `FastClaw ${data.kind}${data.code ? ` ${data.code}` : ""}: ${data.message}` };
    } finally {
      this.#inflight.delete(request.attemptId);
    }
  }

  /** Abort in-flight requests for a task. Returns how many were aborted. */
  abortTask(taskId: string): number {
    let n = 0;
    for (const [attemptId, entry] of this.#inflight) {
      if (entry.taskId !== taskId || entry.controller.signal.aborted) continue;
      insertEvent(this.db, {
        taskId,
        nodeId: entry.nodeId,
        attemptId,
        type: FastClawEventType.ConnectionAborted,
        data: { note: ABORT_NOTE, serverStopped: "unknown" },
        at: this.#now(),
      });
      entry.controller.abort();
      n++;
    }
    return n;
  }
}

/** Cancel = stop new dispatch (task status) + drop in-flight connections. */
export function cancelTaskLive(
  db: Database.Database,
  executor: FastClawNodeExecutor,
  taskId: string,
  opts?: CancelTaskOptions,
) {
  const task = cancelTask(db, taskId, opts);
  const aborted = executor.abortTask(taskId);
  return { task, aborted };
}

/**
 * Build the executor from HEYBE_FASTCLAW_* variables.
 * Throws FastClawConfigError (listing variable names only) when unset.
 */
export function fastClawExecutorFromEnv(
  db: Database.Database,
  env: Record<string, string | undefined> = process.env,
  extra: Partial<Omit<FastClawNodeExecutorOptions, "client">> = {},
): FastClawNodeExecutor {
  const client = fastClawClientFromEnv(env, { retry: { maxAttempts: 1 } });
  const rawTimeout = env[HEYBE_FASTCLAW_TIMEOUT_MS]?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : undefined;
  if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs < 0)) {
    throw new FastClawConfigError([`${HEYBE_FASTCLAW_TIMEOUT_MS} must be a non-negative number`]);
  }
  return new FastClawNodeExecutor(db, {
    client,
    defaultAgentId: env[HEYBE_FASTCLAW_AGENT_ID]?.trim() || undefined,
    timeoutMs,
    ...extra,
  });
}
