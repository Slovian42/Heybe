import type Database from "better-sqlite3";
import type { ExecutionRequest, ExecutionResult, NodeExecutor } from "@heybe/shared-types/task-manager";
import {
  FastClawClient,
  FastClawConfigError,
  FastClawError,
  fastClawClientFromEnv,
} from "@heybe/fastclaw-adapter";

import type { V1TurnFile } from "@heybe/shared-types";

import { ArtifactError, saveArtifact } from "./artifacts.js";
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
  /** A tool that can create/change/delete Agents or start other Agents appeared in the stream. */
  ToolAlert: "fastclaw_tool_alert",
  /** Inferred from the stream: a tool reported a status other than running/done (e.g. error/failed). */
  ToolFailed: "fastclaw_tool_failed",
  /** Inferred at stream end: a tool started (running) but never reported done. */
  ToolUnfinished: "fastclaw_tool_unfinished",
  StreamError: "fastclaw_stream_error",
  StreamDone: "fastclaw_stream_done",
  ConnectionAborted: "fastclaw_connection_aborted",
  /** #12: a declared artifact was downloaded over /v1 and written locally. */
  ArtifactSaved: "artifact_saved",
  /** #12: a declared artifact was missing or rejected (name/size/type/download). */
  ArtifactFailed: "artifact_failed",
} as const;

export const TOOL_FAILED_NOTE = "流中有工具报告了非正常状态，需人工检查";
/** FastClaw v1.4.0 only emits running → done; it has no result/error field, so errors returned to the model stay invisible. */
const TOOL_OK_STATUSES: ReadonlySet<string> = new Set(["running", "done"]);

/** Wording required by #58: we only know the client connection was dropped. */
export const ABORT_NOTE = "连接已断开，服务端是否停止未知";

/**
 * FastClaw v1.4.0 tools that create/configure Agents or hand work to other Agents
 * (internal/agent/tools/agent_admin.go, subagent.go, delegate.go, skill_install.go),
 * plus the scheduling tools (internal/agent/tools/cron.go): FastClaw registers
 * create_cron_job / delete_cron_job on every Agent with a store and they cannot be
 * turned off; Heybe's task manager must stay the only timer (docs/t043 §3).
 * `delete_agent` does not exist in v1.4.0; it is listed in case a later version adds it.
 * Over /v1 chat the runtime refuses the admin ones (chatter is never the operator),
 * but the stream only carries `status`, not the result, so every sighting is alerted.
 */
export const FASTCLAW_ALERT_TOOL_NAMES: ReadonlySet<string> = new Set([
  "create_agent",
  "configure_agent",
  "check_agent",
  "delete_agent",
  "spawn_subagent",
  "delegate_task",
  "install_skill",
  "create_cron_job",
  "delete_cron_job",
]);

export const TOOL_ALERT_NOTE = "对话中出现了建/改/删 Agent、委派或定时类工具调用，需人工确认是否生效";

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
  /** #12: fetch declared files from the stream's final `files[]` and save them locally. */
  artifacts?: ArtifactCollectOptions;
}

export interface ArtifactCollectOptions {
  /** Local output root; files go to `<root>/<taskId>/<name>`. */
  root: string;
  /** File names this node must produce (e.g. ["report.md"]). Empty → nothing collected. */
  expected: (request: ExecutionRequest) => readonly string[];
  maxBytes?: number;
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
    let turnFiles: V1TurnFile[] = [];
    const alerted = new Set<string>();
    const toolRunning = new Map<string, string>();
    const toolFailed = new Set<string>();
    const flushUnfinished = (where: string) => {
      for (const [id, name] of toolRunning) {
        insertEvent(this.db, { ...base, type: FastClawEventType.ToolUnfinished, data: { id, name, at: where }, at: this.#now() });
      }
      toolRunning.clear();
    };
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
          const alertKey = event.tool.id || event.tool.name;
          const status = String(event.tool.status ?? "");
          if (status === "running") toolRunning.set(alertKey, event.tool.name);
          else toolRunning.delete(alertKey);
          if (!TOOL_OK_STATUSES.has(status) && !toolFailed.has(alertKey)) {
            toolFailed.add(alertKey);
            insertEvent(this.db, {
              ...base,
              type: FastClawEventType.ToolFailed,
              data: { id: event.tool.id, name: event.tool.name, status, note: TOOL_FAILED_NOTE },
              at: this.#now(),
            });
          }
          if (FASTCLAW_ALERT_TOOL_NAMES.has(event.tool.name) && !alerted.has(alertKey)) {
            alerted.add(alertKey);
            insertEvent(this.db, {
              ...base,
              type: FastClawEventType.ToolAlert,
              data: { id: event.tool.id, name: event.tool.name, status: event.tool.status, note: TOOL_ALERT_NOTE },
              at: this.#now(),
            });
          }
        } else if (event.type === "done") {
          if (event.files) turnFiles = event.files;
          insertEvent(this.db, {
            ...base,
            type: FastClawEventType.StreamDone,
            data: { finishReason: event.finishReason, chars, usage: event.usage ?? null, files: event.files?.length ?? 0 },
            at: this.#now(),
          });
        }
      }
      flushUnfinished("stream_end");
      const artifactError = await this.#collectArtifacts(request, base, agentId, session.sessionKey, turnFiles);
      if (artifactError) return { outcome: "failed", error: artifactError };
      if (alerted.size > 0) {
        return { outcome: "needs_check", error: TOOL_ALERT_NOTE, checkpoint: { sessionKey: session.sessionKey, chars } };
      }
      if (toolFailed.size > 0) {
        return { outcome: "needs_check", error: TOOL_FAILED_NOTE, checkpoint: { sessionKey: session.sessionKey, chars } };
      }
      return { outcome: "awaiting_review", checkpoint: { sessionKey: session.sessionKey, chars } };
    } catch (err) {
      flushUnfinished("stream_error");
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

  /** Returns an error string when a declared artifact is missing or rejected; null when all saved. */
  async #collectArtifacts(
    request: ExecutionRequest,
    base: { taskId: string; nodeId: string; attemptId: string },
    agentId: string,
    sessionKey: string,
    files: readonly V1TurnFile[],
  ): Promise<string | null> {
    const opts = this.opts.artifacts;
    if (!opts) return null;
    for (const name of opts.expected(request)) {
      const fail = (code: string, message: string) => {
        insertEvent(this.db, { ...base, type: FastClawEventType.ArtifactFailed, data: { name, code, message }, at: this.#now() });
        return `${code}: ${message}`;
      };
      // Only trust the stream's declared files[]; never guess from the reply text (design §3).
      const file = files.find((f) => f.name === name || f.path === name);
      if (!file) return fail("artifact_missing", `本轮没有产出 ${name}`);
      const remotePath = file.path && !file.path.startsWith("/") ? file.path : file.name;
      try {
        if (typeof file.size === "number" && file.size > (opts.maxBytes ?? Infinity)) {
          throw new ArtifactError("artifact_too_large", `产物超过上限 ${opts.maxBytes} 字节`);
        }
        let download;
        try {
          download = await this.opts.client.getSessionFile({ agentId, sessionKey, path: remotePath });
        } catch (err) {
          const kind = err instanceof FastClawError ? `${err.kind}${err.status ? ` ${err.status}` : ""}` : "unknown";
          throw new ArtifactError("artifact_download_failed", `经 /v1 取回失败（${kind}）`);
        }
        const saved = saveArtifact({
          root: opts.root,
          taskId: request.taskId,
          name,
          bytes: download.bytes,
          contentType: download.contentType ?? file.content_type ?? null,
          maxBytes: opts.maxBytes,
        });
        insertEvent(this.db, {
          ...base,
          type: FastClawEventType.ArtifactSaved,
          data: { name: saved.name, size: saved.size, path: saved.path, contentType: saved.contentType },
          at: this.#now(),
        });
      } catch (err) {
        if (err instanceof ArtifactError) return fail(err.code, err.message);
        return fail("artifact_download_failed", err instanceof Error ? err.message.slice(0, 200) : "unknown");
      }
    }
    return null;
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
