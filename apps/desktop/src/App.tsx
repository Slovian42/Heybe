import { useCallback, useReducer, useRef, useState } from "react";

import { streamChat } from "./chat/client";
import { STATUS_TEXT, WARN_TOOLS, chatReducer, initialChatState, type ChatMessage } from "./chat/state";
import { serviceUrl } from "./config";

// The UI talks only to the local Heybe service, never to FastClaw's web/ console.
const SESSION_ID = crypto.randomUUID();
let seq = 0;
const nextId = () => `m${++seq}`;

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
      {/* Rendered as plain text: no raw HTML ever reaches the DOM (XSS-safe). */}
      <div className="text">{m.text || (m.status === "streaming" ? "…" : "")}</div>
      {STATUS_TEXT[m.status] && <div className="status">{STATUS_TEXT[m.status]}</div>}
    </div>
  );
}

export function App() {
  const [state, dispatch] = useReducer(chatReducer, initialChatState);
  const [input, setInput] = useState("");
  const running = useRef<{ id: string; ctl: AbortController } | null>(null);
  const busy = state.messages.some((m) => m.status === "streaming");

  const send = useCallback(async () => {
    const content = input.trim();
    if (!content || running.current) return;
    setInput("");
    const assistantId = nextId();
    const ctl = new AbortController();
    running.current = { id: assistantId, ctl };
    dispatch({ type: "send", userId: nextId(), assistantId, content });
    try {
      for await (const event of streamChat({ baseUrl: serviceUrl(), sessionId: SESSION_ID, content, signal: ctl.signal })) {
        dispatch({ type: "event", assistantId, event });
      }
    } finally {
      if (!ctl.signal.aborted) dispatch({ type: "end", assistantId });
      running.current = null;
    }
  }, [input]);

  const stop = useCallback(() => {
    const cur = running.current;
    if (!cur) return;
    dispatch({ type: "stop", assistantId: cur.id });
    cur.ctl.abort();
  }, []);

  return (
    <main className="app">
      <header>
        <h1>Heybe</h1>
        <p>说一句，剩下的交给它。</p>
      </header>
      <section className="messages">
        {state.messages.map((m) => (
          <Message key={m.id} m={m} />
        ))}
      </section>
      {state.stoppedBefore && !busy && (
        <p className="hint">上一轮已停止，服务端可能仍会补完那一轮的回答。</p>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="说一句…" rows={3} />
        {busy ? (
          <button type="button" onClick={stop}>停止</button>
        ) : (
          <button type="submit" disabled={!input.trim()}>发送</button>
        )}
      </form>
    </main>
  );
}
