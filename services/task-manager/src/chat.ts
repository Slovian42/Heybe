// Chat API for the desktop UI (#19, 19-d / 19-e; part 2: resumable turns).
//
//   POST /chat/sessions/:sid/messages      start a turn, SSE of its events (same as /events?after=0)
//   GET  /chat/sessions/:sid               JSON snapshot of the session's turns (from SQLite)
//   GET  /chat/turns/:tid/events?after=n   SSE: events with seq > n, then live, then [DONE]
//   POST /chat/turns/:tid/stop             drop the upstream connection, mark the turn stopped
//
// A turn runs in the service, not in the HTTP request: closing the window, reloading the UI or
// losing the connection does not abort it (#19 part 2 item 2). Only an explicit stop does.
// FastClaw v1.4.0 has no /v1 stop: stop only drops Heybe's upstream connection; whether the
// server stopped is unknown (#9 / #58 wording lives in the UI).
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type Database from "better-sqlite3";
import type { FastClawClient } from "@heybe/fastclaw-adapter";
import type { V1StreamEvent } from "@heybe/shared-types";
import {
  CHAT_SESSION_KEY_PREFIX,
  modelSourceFromFastClaw,
  type ChatServiceEvent,
  type ChatTurnSnapshot,
  type ChatWireEvent,
} from "@heybe/shared-types/chat";

import { classifyChatError } from "./chat-errors.js";
import { ChatTurnStore } from "./chat-store.js";

export { classifyChatError } from "./chat-errors.js";

export interface ChatStreamInput {
  sessionKey: string;
  content: string;
  signal: AbortSignal;
  /** Called with FastClaw's chunk `model` (`<provider>/<model>`): what this turn really used. */
  onModel?: (model: string) => void;
}

/** Injected so tests use a mock; production wraps FastClawClient.streamMessage. */
export type ChatStreamFn = (input: ChatStreamInput) => AsyncIterable<V1StreamEvent>;

/** FastClaw sends `: ping` every 15 s while busy; this long with no bytes at all = hung. */
export const CHAT_IDLE_TIMEOUT_MS = 120_000;
/** FastClaw writes the SSE headers before the agent turn starts. */
export const CHAT_HEADER_TIMEOUT_MS = 60_000;

/** Production stream: FastClaw /v1/chat/completions only (no web/ console, no /api). */
export function fastClawChatStream(client: FastClawClient, agentId: string): ChatStreamFn {
  return ({ sessionKey, content, signal, onModel }) =>
    client.streamMessage(client.createSession({ agentId, sessionKey }), {
      messages: [{ role: "user", content }],
      signal,
      timeoutMs: CHAT_HEADER_TIMEOUT_MS,
      idleTimeoutMs: CHAT_IDLE_TIMEOUT_MS,
      onModel,
    });
}

/** Webview origins allowed to call the chat API (Tauri 2 macOS + vite dev). */
export const CHAT_ALLOWED_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "http://localhost:1420"];

export function corsHeaders(origin: string | undefined): Record<string, string> {
  if (!origin || !CHAT_ALLOWED_ORIGINS.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization",
    Vary: "Origin",
  };
}

const ID = "[A-Za-z0-9_-]{1,128}";
export const CHAT_PATH = new RegExp(`^/chat/sessions/(${ID})/messages$`);
export const CHAT_SESSION_PATH = new RegExp(`^/chat/sessions/(${ID})$`);
export const CHAT_TURN_EVENTS_PATH = new RegExp(`^/chat/turns/(${ID})/events$`);
export const CHAT_TURN_STOP_PATH = new RegExp(`^/chat/turns/(${ID})/stop$`);
const MAX_CONTENT = 100_000;

/** Any chat route (for CORS preflight and the 405 check). */
export function isChatPath(pathname: string): boolean {
  return [CHAT_PATH, CHAT_SESSION_PATH, CHAT_TURN_EVENTS_PATH, CHAT_TURN_STOP_PATH].some((re) => re.test(pathname));
}

export function chatSessionKey(id: string): string {
  return `${CHAT_SESSION_KEY_PREFIX}${id}`;
}

export function toServiceEvent(ev: V1StreamEvent): ChatServiceEvent {
  if (ev.type === "delta") return { type: "delta", content: ev.content };
  if (ev.type === "tool") {
    return { type: "tool", id: ev.tool.id, name: ev.tool.name, status: ev.tool.status === "running" ? "running" : "done" };
  }
  return { type: "done", finishReason: ev.finishReason };
}

const TERMINAL = new Set<ChatServiceEvent["type"]>(["done", "error", "stopped"]);

/** Fold one event into a turn snapshot (same rules as the UI reducer). */
export function foldTurn(turn: ChatTurnSnapshot, ev: ChatWireEvent): ChatTurnSnapshot {
  const next = { ...turn, lastSeq: ev.seq ?? turn.lastSeq };
  switch (ev.type) {
    case "delta":
      return { ...next, text: turn.text + ev.content };
    case "tool": {
      const step = { id: ev.id, name: ev.name, status: ev.status };
      const known = turn.tools.some((t) => t.id === ev.id);
      return { ...next, tools: known ? turn.tools.map((t) => (t.id === ev.id ? step : t)) : [...turn.tools, step] };
    }
    case "source":
      return { ...next, source: ev.source };
    case "done":
      return { ...next, status: "done" };
    case "stopped":
      return { ...next, status: "stopped" };
    case "error":
      return {
        ...next,
        status: ev.kind,
        error: { reason: ev.reason ?? "unknown", ...(ev.code ? { code: ev.code } : {}), message: ev.message },
      };
    default:
      return next;
  }
}

type Listener = (ev: ChatWireEvent | "end") => void;

interface ActiveTurn {
  turn: ChatTurnSnapshot;
  events: ChatWireEvent[];
  listeners: Set<Listener>;
  ctl: AbortController;
  ended: boolean;
  lastFlush: number;
}

export interface ChatRunnerOptions {
  /** Max delay before streamed text is written to SQLite (terminal events are written at once). */
  flushMs?: number;
}

/**
 * Runs chat turns independently of HTTP connections and keeps them in SQLite.
 * Every turn ends with exactly one terminal event (done / error / stopped).
 */
export class ChatRunner {
  readonly store: ChatTurnStore;
  readonly #active = new Map<string, ActiveTurn>();
  readonly #flushMs: number;

  constructor(db: Database.Database, private readonly stream: ChatStreamFn, opts: ChatRunnerOptions = {}) {
    this.store = new ChatTurnStore(db);
    this.#flushMs = opts.flushMs ?? 250;
    this.store.interruptOrphans();
  }

  /** True while the turn runs (or just ended) in this service process. */
  isLive(turnId: string): boolean {
    return this.#active.has(turnId);
  }

  /** Stored turns of a session, with running turns taken from memory (SQLite lags by up to flushMs). */
  listSession(sessionId: string): ChatTurnSnapshot[] {
    return this.store.listBySession(sessionId).map((t) => this.#active.get(t.id)?.turn ?? t);
  }

  /** Running turn of a session, if any. */
  activeTurnOf(sessionId: string): string | undefined {
    for (const a of this.#active.values()) if (a.turn.sessionId === sessionId && !a.ended) return a.turn.id;
    return undefined;
  }

  start(sessionId: string, content: string): { turnId: string } | { busy: string } {
    const busy = this.activeTurnOf(sessionId);
    if (busy) return { busy };
    const turn = this.store.create({ id: randomUUID(), sessionId, userContent: content });
    const active: ActiveTurn = { turn, events: [], listeners: new Set(), ctl: new AbortController(), ended: false, lastFlush: Date.now() };
    this.#active.set(turn.id, active);
    this.#emit(active, { type: "turn", turnId: turn.id });
    void this.#run(active, content);
    return { turnId: turn.id };
  }

  /**
   * Replay events with seq > after, then call `listener` live. Returns undefined when the turn is
   * not running in this process (ended, or from an earlier service run): read the snapshot instead.
   */
  subscribe(turnId: string, after: number, listener: Listener): (() => void) | undefined {
    const a = this.#active.get(turnId);
    if (!a) return undefined;
    for (const ev of a.events) if ((ev.seq ?? 0) > after) listener(ev);
    if (a.ended) {
      listener("end");
      return () => undefined;
    }
    a.listeners.add(listener);
    return () => a.listeners.delete(listener);
  }

  /** Stop: mark stopped right away and drop the upstream connection. */
  stop(turnId: string): ChatTurnSnapshot | undefined {
    const a = this.#active.get(turnId);
    if (!a) return this.store.get(turnId);
    if (!a.ended) {
      this.#emit(a, { type: "stopped" });
      a.ctl.abort();
    }
    return a.turn;
  }

  /** Service shutdown: running turns end as interrupted (outcome unknown). */
  shutdown(): void {
    for (const a of this.#active.values()) {
      if (a.ended) continue;
      this.#emit(a, { type: "error", ...classifyChatError({ code: "stream_truncated" }) });
      a.ctl.abort();
    }
  }

  async #run(a: ActiveTurn, content: string): Promise<void> {
    const signal = a.ctl.signal;
    try {
      const events = this.stream({
        sessionKey: chatSessionKey(a.turn.sessionId),
        content,
        signal,
        onModel: (model) => {
          const source = modelSourceFromFastClaw(model);
          if (source && !a.turn.source) this.#emit(a, { type: "source", source });
        },
      });
      for await (const ev of events) {
        if (signal.aborted || a.ended) continue; // drain quietly; nothing after a terminal event
        this.#emit(a, toServiceEvent(ev));
      }
      if (!a.ended) {
        // [DONE] without a finish chunk: never show it as success.
        this.#emit(a, { type: "error", ...classifyChatError({ code: "stream_truncated" }) });
      }
    } catch (err) {
      if (!a.ended) this.#emit(a, { type: "error", ...classifyChatError(err) });
    } finally {
      this.#active.delete(a.turn.id);
    }
  }

  #emit(a: ActiveTurn, event: ChatServiceEvent): void {
    if (a.ended) return;
    const ev: ChatWireEvent = { ...event, seq: a.turn.lastSeq + 1 };
    a.turn = foldTurn(a.turn, ev);
    a.events.push(ev);
    const terminal = TERMINAL.has(event.type);
    if (terminal) a.ended = true;
    const now = Date.now();
    if (terminal || event.type !== "delta" || now - a.lastFlush >= this.#flushMs) {
      this.store.save(a.turn);
      a.lastFlush = now;
    }
    for (const l of [...a.listeners]) {
      l(ev);
      if (terminal) l("end");
    }
    if (terminal) a.listeners.clear();
  }
}

function sseHead(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    ...corsHeaders(req.headers.origin),
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
}

function write(res: ServerResponse, event: ChatWireEvent | "[DONE]"): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${event === "[DONE]" ? event : JSON.stringify(event)}\n\n`);
}

export function sendChatJson(req: IncomingMessage, res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    ...corsHeaders(req.headers.origin),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(raw),
  });
  res.end(raw);
}

/**
 * Stream a turn's events after `after` to this response. The response closing (window closed,
 * UI reloaded, stop pressed in the UI) only unsubscribes; it never aborts the turn.
 */
export function streamTurn(req: IncomingMessage, res: ServerResponse, runner: ChatRunner, turnId: string, after: number): void {
  if (!runner.isLive(turnId)) {
    const snap = runner.store.get(turnId);
    if (!snap) {
      sendChatJson(req, res, 404, { error: "turn not found" });
      return;
    }
    sseHead(req, res);
    write(res, { type: "snapshot", turn: snap, seq: snap.lastSeq });
    write(res, "[DONE]");
    res.end();
    return;
  }
  sseHead(req, res);
  const unsubscribe = runner.subscribe(turnId, after, (ev) => {
    if (ev === "end") {
      write(res, "[DONE]");
      res.end();
    } else {
      write(res, ev);
    }
  });
  if (!unsubscribe) {
    // Ended between the two calls: fall back to the stored final state.
    const snap = runner.store.get(turnId);
    if (snap) write(res, { type: "snapshot", turn: snap, seq: snap.lastSeq });
    write(res, "[DONE]");
    res.end();
    return;
  }
  res.on("close", unsubscribe);
}

export async function handleChatMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string,
  rawBody: string,
  runner: ChatRunner,
): Promise<void> {
  let parsed: { content?: unknown };
  try {
    parsed = JSON.parse(rawBody || "{}") as { content?: unknown };
  } catch {
    parsed = {};
  }
  const content = typeof parsed.content === "string" ? parsed.content.trim() : "";
  if (!content || content.length > MAX_CONTENT) {
    sendChatJson(req, res, 400, { error: "content must be a non-empty string" });
    return;
  }
  const started = runner.start(sessionId, content);
  if ("busy" in started) {
    sendChatJson(req, res, 409, { error: "a turn is still running in this session", turnId: started.busy });
    return;
  }
  streamTurn(req, res, runner, started.turnId, 0);
}

/** GET/POST on the chat routes other than POST messages. Returns false when the path is not one of them. */
export function handleChatRoute(req: IncomingMessage, res: ServerResponse, url: URL, runner: ChatRunner): boolean {
  const method = req.method ?? "GET";
  const session = CHAT_SESSION_PATH.exec(url.pathname);
  if (session && method === "GET") {
    const sessionId = session[1] ?? "";
    sendChatJson(req, res, 200, {
      sessionId,
      turns: runner.listSession(sessionId),
      activeTurnId: runner.activeTurnOf(sessionId) ?? null,
    });
    return true;
  }
  const events = CHAT_TURN_EVENTS_PATH.exec(url.pathname);
  if (events && method === "GET") {
    const after = Number(url.searchParams.get("after") ?? "0");
    streamTurn(req, res, runner, events[1] ?? "", Number.isInteger(after) && after >= 0 ? after : 0);
    return true;
  }
  const stop = CHAT_TURN_STOP_PATH.exec(url.pathname);
  if (stop && method === "POST") {
    const turn = runner.stop(stop[1] ?? "");
    if (!turn) sendChatJson(req, res, 404, { error: "turn not found" });
    // FastClaw v1.4.0 has no /v1 stop: dropping the connection does not prove the run stopped.
    else sendChatJson(req, res, 200, { turn, serverStopped: "unknown" });
    return true;
  }
  return false;
}
