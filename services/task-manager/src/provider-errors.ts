import { FastClawError } from "@heybe/fastclaw-adapter";
import type { ProviderKind, ProviderTestCode } from "@heybe/shared-types";

export interface ClassifiedProviderError {
  code: ProviderTestCode;
  message: string;
  detail?: { status?: number; code?: string };
}

const CHANGED = "如果确认配置无误，可能是提供方接口有变化，请查看 docs/providers。";

const MESSAGES: Record<ProviderTestCode, string> = {
  ok: "连接正常",
  key_missing: "还没有填写密钥",
  key_invalid: "密钥无效或没有权限，请检查密钥是否正确、是否已过期",
  model_not_found: "找不到这个模型，请检查模型名",
  rate_limited: "请求太频繁或额度不足，请稍后再试或检查账户余额",
  network_unreachable: "连不上提供方，请检查网络或接口地址",
  timeout: "等待回复超时，请检查网络或稍后再试",
  ollama_not_running: "Ollama 没有在运行，请先打开 Ollama",
  context_too_small: "Ollama 上下文长度不足 16k，回答可能被截断",
  provider_error: "提供方返回了错误",
  fastclaw_error: "本地 FastClaw 服务出错，请重启 Heybe 后再试",
  skill_disable_failed: "没能关闭 FastClaw 的浏览器技能（camoufox-cli），为了安全先不用这个 Agent；请重启 Heybe 后再试",
  config_invalid: "配置不完整或格式不对",
};

export function providerMessage(code: ProviderTestCode): string {
  return MESSAGES[code];
}

/**
 * FastClaw v1.4.0 relays upstream failures as HTTP 502 `agent_error` with message
 * `API error <status>: <upstream body>` (observed 2026-11-02 with a bad DeepSeek key).
 * Unreachable upstreams (DNS / refused) are retried inside FastClaw and surface to
 * us as a client timeout, so a timeout is ambiguous; for Ollama we pre-check /api/tags.
 */
export function classifyProviderError(err: unknown, kind: ProviderKind): ClassifiedProviderError {
  const make = (code: ProviderTestCode, detail?: ClassifiedProviderError["detail"]): ClassifiedProviderError => ({
    code,
    message: code === "provider_error" || code === "model_not_found" ? `${MESSAGES[code]}。${CHANGED}` : MESSAGES[code],
    ...(detail ? { detail } : {}),
  });
  if (err instanceof FastClawError) {
    if (err.kind === "timeout") return make("timeout");
    if (err.kind === "network") return make("fastclaw_error");
    const text = err.message ?? "";
    const m = /API error (\d{3})/.exec(text);
    if (m) {
      const up = Number(m[1]);
      const detail = { status: up, code: upstreamCode(text) };
      if (up === 401 || up === 403) return make("key_invalid", detail);
      if (up === 404 || /model/i.test(text) && /not.?(found|exist)|does not exist|invalid model/i.test(text)) return make("model_not_found", detail);
      if (up === 429 || up === 402) return make("rate_limited", detail);
      return make("provider_error", detail);
    }
    if (/model/i.test(text) && /not.?(found|exist)/i.test(text)) return make("model_not_found", { status: err.status });
    if (/ECONNREFUSED|connection refused/i.test(text)) return make(kind === "ollama" ? "ollama_not_running" : "network_unreachable", { status: err.status });
    if (/no such host|ENOTFOUND|dial tcp|i\/o timeout/i.test(text)) return make("network_unreachable", { status: err.status });
    // 401/403 without "API error" = FastClaw rejected Heybe's own token.
    if (err.status === 401 || err.status === 403) return make("fastclaw_error", { status: err.status });
    if (err.status === 429) return make("rate_limited", { status: err.status });
    return make(err.status && err.status >= 500 ? "provider_error" : "fastclaw_error", { status: err.status, code: err.code });
  }
  const text = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED/i.test(text)) return make(kind === "ollama" ? "ollama_not_running" : "network_unreachable");
  if (/ENOTFOUND|EAI_AGAIN/i.test(text)) return make("network_unreachable");
  if (/timeout|aborted/i.test(text)) return make("timeout");
  return make("fastclaw_error");
}

function upstreamCode(text: string): string | undefined {
  const m = /\\?"type\\?"\s*:\s*\\?"([a-z_]{1,40})\\?"/.exec(text);
  return m?.[1];
}
