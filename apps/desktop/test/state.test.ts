import { describe, expect, it } from "vitest";

import { chatReducer, initialChatState, STATUS_TEXT } from "../src/chat/state";

const sent = chatReducer(initialChatState, { type: "send", userId: "u1", assistantId: "a1", content: "hi" });
const a1 = (s: typeof sent) => s.messages.find((m) => m.id === "a1")!;

describe("chatReducer", () => {
  it("appends deltas and updates tool steps in place", () => {
    let s = chatReducer(sent, { type: "event", assistantId: "a1", event: { type: "delta", content: "你" } });
    s = chatReducer(s, { type: "event", assistantId: "a1", event: { type: "tool", id: "t", name: "web_fetch", status: "running" } });
    s = chatReducer(s, { type: "event", assistantId: "a1", event: { type: "tool", id: "t", name: "web_fetch", status: "done" } });
    s = chatReducer(s, { type: "event", assistantId: "a1", event: { type: "delta", content: "好" } });
    s = chatReducer(s, { type: "event", assistantId: "a1", event: { type: "done", finishReason: "stop" } });
    expect(a1(s)).toMatchObject({ text: "你好", status: "done", tools: [{ id: "t", status: "done" }] });
  });

  it("stop freezes the message and drops late deltas", () => {
    let s = chatReducer(sent, { type: "stop", assistantId: "a1" });
    s = chatReducer(s, { type: "event", assistantId: "a1", event: { type: "delta", content: "late" } });
    expect(a1(s).text).toBe("");
    expect(a1(s).status).toBe("stopped");
    expect(STATUS_TEXT.stopped).toBe("已停止（服务端是否停止未知）");
    expect(s.stoppedBefore).toBe(true);
  });

  it("errors and silent endings are never shown as success", () => {
    const err = chatReducer(sent, { type: "event", assistantId: "a1", event: { type: "error", kind: "interrupted", message: "x" } });
    expect(a1(err).status).toBe("interrupted");
    expect(a1(chatReducer(sent, { type: "end", assistantId: "a1" })).status).toBe("interrupted");
  });

  it("keeps HTML as plain text in state (rendered as a text node)", () => {
    const s = chatReducer(sent, { type: "event", assistantId: "a1", event: { type: "delta", content: "<img src=x onerror=alert(1)>" } });
    expect(a1(s).text).toBe("<img src=x onerror=alert(1)>");
  });
});
