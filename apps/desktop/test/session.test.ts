import { describe, expect, it } from "vitest";

import { chatSessionId } from "../src/chat/session";

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("chatSessionId", () => {
  it("is stable across reloads (same storage)", () => {
    const s = mem();
    const a = chatSessionId(s);
    expect(chatSessionId(s)).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("replaces a tampered value and survives blocked storage", () => {
    const s = mem();
    s.setItem("heybe.chat.sessionId", "../evil");
    expect(chatSessionId(s)).not.toBe("../evil");
    const blocked = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); } };
    expect(chatSessionId(blocked)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
