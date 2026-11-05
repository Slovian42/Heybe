import { memo, useCallback, useDeferredValue, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MODEL_LOCALITY_TEXT, modelSourceText } from "@heybe/shared-types/chat";

import { loadSession, resumeTurn, stopTurn, streamChat, type ChatStreamItem } from "./chat/client";
import { Markdown } from "./chat/Markdown";
import {
  STOPPED_HINT,
  WARN_TOOLS,
  chatReducer,
  initialChatState,
  runningMessage,
  statusText,
  type ChatMessage,
} from "./chat/state";
import { chatSessionId } from "./chat/session";
import { bannerText, inTauri, loadServiceInfo, type ServiceInfo } from "./config";

// The UI talks only to the local Heybe service, never to FastClaw's web/ console.
let idSeq = 0;
const nextId = () => `m${++idSeq}`;

const MessageText = memo(function MessageText({ m }: { m: ChatMessage }) {
  // Re-parse long streaming replies at React's pace, not on every delta (10k chars stay smooth).
  const text = useDeferredValue(m.text);
  if (m.role === "user") return <div className="text">{m.text}</div>;
  if (!text) return <div className="text">{m.status === "streaming" ? "…" : ""}</div>;
  return <Markdown text={text} />;
});

function SourceLine({ m }: { m: ChatMessage }) {
  if (m.role !== "assistant") return null;
  if (m.source) {
    return (
      <div className="source" data-locality={m.source.locality}>
        {modelSourceText(m.source)}
        <span className="tag">{MODEL_LOCALITY_TEXT[m.source.locality]}</span>
      </div>
    );
  }
  // Failed before the gateway sent any chunk: say so rather than guess a model.
  if (m.status !== "streaming") return <div className="source" data-locality="unknown">模型来源未知（这一轮没收到模型信息）</div>;
  return null;
}

function Message({ m }: { m: ChatMessage }) {
  return (
    <div className={`msg ${m.role}`} data-status={m.status}>
      {m.tools.length > 0 && (
        <details className="tools">
          <summary>工具步骤（{m.tools.length}）</summary>
          <ul>
            {m.tools.map((t) => (
              <li key={t.id} className={WARN_TOOLS.has(t.name) ? "warn" : undefined}>
                {WARN_TOOLS.has(t.name) ? "⚠ " : ""}
                {t.name} · {t.status === "running" ? "进行中" : "完成"}
              </li>
            ))}
          </ul>
        </details>
      )}
      <MessageText m={m} />
      <SourceLine m={m} />
      {statusText(m) && (
        <div className="status" data-reason={m.error?.reason}>
          {statusText(m)}
        </div>
      )}
    </div>
  );
}

interface Follow {
  assistantId: string;
  ctl: AbortController;
}

export function App() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [input, setInput] = useState("");
  const following = useRef<Follow | null>(null);
  const running = runningMessage(state);
  const busy = running !== undefined;
  const [service, setService] = useState<ServiceInfo>({ status: "starting", url: null, token: "", restarts: 0, error: null });
  const [sessionId] = useState(() => chatSessionId());

  // 19-b: poll the shell for the service URL/token; shows "正在重连" while it restarts.
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const info = await loadServiceInfo(inTauri() ? (cmd) => invoke(cmd) : undefined);
        if (alive) setService(info);
      } catch {
        if (alive) setService((s) => ({ ...s, status: "failed", url: null }));
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  /**
   * Read a turn's events into one assistant message. When the local connection drops (`cut`),
   * re-attach with after=lastSeq: the turn runs in the service, independent of this window.
   */
  const follow = useCallback(
    async (
      assistantId: string,
      open: (signal: AbortSignal) => AsyncGenerator<ChatStreamItem>,
      conn: { baseUrl: string; token: string },
    ) => {
      const ctl = new AbortController();
      following.current?.ctl.abort();
      following.current = { assistantId, ctl };
      let gen = open(ctl.signal);
      let resuming = false;
      let retries = 0;
      try {
        for (;;) {
          let cut = false;
          for await (const item of gen) {
            // While re-attaching, "service unreachable" is just another drop: retry, then give up.
            if (item.type === "cut" || (resuming && item.type === "error" && item.seq === undefined)) cut = true;
            else dispatch({ type: "event", assistantId, event: item });
          }
          if (ctl.signal.aborted || !cut) break;
          const m = stateRef.current.messages.find((x) => x.id === assistantId);
          if (!m?.turnId || m.status !== "streaming" || retries >= 3) break;
          retries += 1;
          await new Promise((r) => setTimeout(r, 300 * retries));
          if (ctl.signal.aborted) break;
          resuming = true;
          gen = resumeTurn({ ...conn, turnId: m.turnId, after: m.lastSeq ?? 0, signal: ctl.signal });
        }
        // Ended without done/error/stopped: interrupted, never success.
        if (!ctl.signal.aborted) dispatch({ type: "end", assistantId });
      } finally {
        if (following.current?.ctl === ctl) following.current = null;
      }
    },
    [],
  );

  // Window reopened, UI reloaded or service reconnected: rebuild from the service's SQLite and
  // re-attach to a running turn. A restarted service reports that turn as interrupted.
  useEffect(() => {
    if (!service.url) return;
    const conn = { baseUrl: service.url, token: service.token };
    let alive = true;
    void (async () => {
      try {
        const s = await loadSession({ ...conn, sessionId });
        if (!alive) return;
        dispatch({ type: "load", turns: s.turns });
        if (s.activeTurnId && following.current === null) {
          const turn = s.turns.find((t) => t.id === s.activeTurnId);
          const local = stateRef.current.messages.find((m) => m.turnId === s.activeTurnId && m.role === "assistant");
          const assistantId = local?.id ?? `a-${s.activeTurnId}`;
          const turnId = s.activeTurnId;
          void follow(assistantId, (signal) => resumeTurn({ ...conn, turnId, after: turn?.lastSeq ?? 0, signal }), conn);
        }
      } catch {
        // Older service without the session route, or it went away again: keep what is on screen.
      }
    })();
    return () => {
      alive = false;
    };
  }, [service.url, service.token, sessionId, follow]);

  const send = useCallback(() => {
    const content = input.trim();
    if (!content || busy || !service.url) return;
    const conn = { baseUrl: service.url, token: service.token };
    setInput("");
    const assistantId = nextId();
    dispatch({ type: "send", userId: nextId(), assistantId, content });
    void follow(assistantId, (signal) => streamChat({ ...conn, sessionId, content, signal }), conn);
  }, [input, busy, service, sessionId, follow]);

  const stop = useCallback(() => {
    const m = runningMessage(stateRef.current);
    if (!m) return;
    // 19-e: show 「已停止」 at once; the service then drops the gateway connection.
    dispatch({ type: "stop", assistantId: m.id });
    following.current?.ctl.abort();
    if (!service.url) return;
    const conn = { baseUrl: service.url, token: service.token };
    if (m.turnId) {
      void stopTurn({ ...conn, turnId: m.turnId });
    } else {
      // Stopped before the turn id arrived: find the running turn and stop that.
      void loadSession({ ...conn, sessionId })
        .then((s) => (s.activeTurnId ? stopTurn({ ...conn, turnId: s.activeTurnId }) : undefined))
        .catch(() => undefined);
    }
  }, [service, sessionId]);

  return (
    <main className="app">
      <header>
        <h1>Heybe</h1>
        <p>说一句，剩下的交给它。</p>
      </header>
      {bannerText(service) && <p className="banner" data-status={service.status}>{bannerText(service)}</p>}
      <section className="messages">
        {state.messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </section>
      {state.stoppedBefore && !busy && <p className="hint">{STOPPED_HINT}</p>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="说一句…" rows={3} />
        {busy ? (
          <button type="button" onClick={stop}>停止</button>
        ) : (
          <button type="submit" disabled={!input.trim() || !service.url}>发送</button>
        )}
      </form>
    </main>
  );
}
