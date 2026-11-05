import { describe, expect, it } from "vitest";
import { MODEL_LOCALITY_TEXT, chatErrorMessage, modelSourceFromFastClaw, modelSourceText } from "@heybe/shared-types/chat";

describe("model source (from the `model` FastClaw reports per chunk)", () => {
  it("labels cloud providers", () => {
    const s = modelSourceFromFastClaw("deepseek/deepseek-chat")!;
    expect(s).toEqual({ provider: "deepseek", model: "deepseek-chat", label: "DeepSeek", locality: "cloud" });
    expect(modelSourceText(s)).toBe("DeepSeek · deepseek-chat");
    expect(MODEL_LOCALITY_TEXT[s.locality]).toBe("云端");
  });

  it("labels local Ollama (model names with ':' and '/' kept whole)", () => {
    const s = modelSourceFromFastClaw("ollama/qwen2.5:3b")!;
    expect(modelSourceText(s)).toBe("本地 Ollama · qwen2.5:3b");
    expect(s.locality).toBe("local");
    expect(modelSourceFromFastClaw("openrouter/meta-llama/llama-3-8b")).toMatchObject({ label: "OpenRouter", model: "meta-llama/llama-3-8b", locality: "cloud" });
  });

  it("does not guess: unknown providers are 'custom', bare ids have an unknown provider", () => {
    expect(modelSourceFromFastClaw("myproxy/gpt-x")).toMatchObject({ label: "自定义接口 myproxy", locality: "custom" });
    expect(modelSourceFromFastClaw("agt_123")).toMatchObject({ label: "未知提供方", model: "agt_123" });
    expect(modelSourceFromFastClaw("")).toBeUndefined();
    expect(modelSourceFromFastClaw(undefined)).toBeUndefined();
  });

  it("E_FC_* codes get Chinese text with the code", () => {
    expect(chatErrorMessage("runtime_error", "E_FC_READY_TIMEOUT")).toMatch(/E_FC_READY_TIMEOUT/);
    expect(chatErrorMessage("runtime_error", "E_FC_READY_TIMEOUT")).toMatch(/[\u4e00-\u9fff]/);
  });
});
