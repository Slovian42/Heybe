import { describe, expect, it } from "vitest";

import { chatReducer, initialChatState, STATUS_TEXT, statusText } from "../src/chat/state";

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

  it("shows the specific failure reason instead of a bare 「没做成」 (#19 Mac 复验问题 2)", () => {
    const err = chatReducer(sent, {
      type: "event",
      assistantId: "a1",
      event: { type: "error", kind: "failed", reason: "key_invalid", code: "upstream_401", message: "模型密钥无效，请到设置里更换" },
    });
    expect(a1(err).status).toBe("failed");
    expect(a1(err).error).toEqual({ reason: "key_invalid", code: "upstream_401", message: "模型密钥无效，请到设置里更换" });
    expect(statusText(a1(err))).toBe("模型密钥无效，请到设置里更换");
    // Older service without reason/message text: fall back to the generic status text.
    const bare = chatReducer(sent, { type: "event", assistantId: "a1", event: { type: "error", kind: "failed", message: "" } });
    expect(statusText(a1(bare))).toBe("没做成");
    expect(statusText({ status: "stopped" })).toBe(STATUS_TEXT.stopped);
  });

  it("keeps HTML as plain text in state (rendered as a text node)", () => {
    const s = chatReducer(sent, { type: "event", assistantId: "a1", event: { type: "delta", content: "<img src=x onerror=alert(1)>" } });
    expect(a1(s).text).toBe("<img src=x onerror=alert(1)>");
  });
});

import { FASTCLAW_ALERT_TOOLS } from "@heybe/shared-types/chat";
import { WARN_TOOLS } from "../src/chat/state";

describe("WARN_TOOLS (#67)", () => {
  it("matches the #67 Agent-management list plus the t043 cron tools", () => {
    expect([...WARN_TOOLS].sort()).toEqual([...FASTCLAW_ALERT_TOOLS].sort());
    for (const t of ["create_agent", "configure_agent", "check_agent", "delete_agent", "spawn_subagent", "delegate_task", "install_skill", "create_cron_job", "delete_cron_job"]) {
      expect(WARN_TOOLS.has(t)).toBe(true);
    }
    expect(WARN_TOOLS.has("web_fetch")).toBe(false);
  });
});
