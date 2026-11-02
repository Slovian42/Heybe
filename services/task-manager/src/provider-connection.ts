import { redactSecrets } from "@heybe/fastclaw-adapter";
import type { FastClawSession, V1ChatCompletion, V1ChatMessage } from "@heybe/shared-types";
import { validateProviderConfig, PROVIDER_PRESETS, type ProviderConfig, type ProviderTestResult } from "@heybe/shared-types";
import { SkillGuardError } from "./fastclaw-skills.js";
import { classifyProviderError, providerMessage } from "./provider-errors.js";
import type { ProviderProvisioner } from "./provider-provisioner.js";
import type { SecretStore } from "./provider-secrets.js";

export const OLLAMA_MIN_CTX = 16384;
export const PROBE_PROMPT = "只回复 OK";
export const PROBE_TIMEOUT_MS = 20_000;

/** The /v1 chat surface we need (FastClawClient satisfies it). */
export interface ProbeChat {
  sendMessage(session: FastClawSession, input: { messages: V1ChatMessage[]; timeoutMs?: number }): Promise<V1ChatCompletion>;
}

export type FetchLike = (url: string, init?: { method?: string; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface TestDeps {
  secrets: SecretStore;
  provisioner: ProviderProvisioner;
  chat: ProbeChat;
  /** Used only for Ollama's native /api endpoints. */
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
  /** Sink for redacted diagnostic lines (tests assert no key reaches it). */
  log?: (line: string) => void;
}

/** Ollama native root from the OpenAI-compatible base (`.../v1` → `...`). */
export function ollamaRoot(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
}

/**
 * Effective context of a model: running value from /api/ps if loaded, else
 * `num_ctx` in /api/show parameters. undefined = unknown (Ollama default 4096 on <24GB VRAM in 0.11+, 2048 older).
 */
export async function ollamaContext(fetchFn: FetchLike, baseUrl: string, model: string): Promise<number | undefined> {
  const root = ollamaRoot(baseUrl);
  try {
    const ps = await fetchFn(`${root}/api/ps`);
    if (ps.ok) {
      const body = (await ps.json()) as { models?: Array<{ name?: string; model?: string; context_length?: number }> };
      const hit = body.models?.find((m) => m.name === model || m.model === model);
      if (hit?.context_length) return hit.context_length;
    }
  } catch {
    /* fall through */
  }
  try {
    const show = await fetchFn(`${root}/api/show`, { method: "POST", body: JSON.stringify({ model }) });
    if (show.ok) {
      const body = (await show.json()) as { parameters?: string };
      const m = /num_ctx\s+(\d+)/.exec(body.parameters ?? "");
      if (m) return Number(m[1]);
    }
  } catch {
    /* unknown */
  }
  return undefined;
}

/** #16 T1.2.3 “测试连接”: provision probe agent, send one /v1 message, classify. Never throws. */
export async function testProviderConnection(cfg: ProviderConfig, deps: TestDeps): Promise<ProviderTestResult> {
  const now = deps.now ?? Date.now;
  const started = now();
  const base = { providerId: cfg.id, kind: cfg.kind };
  const done = (r: Omit<ProviderTestResult, "providerId" | "kind" | "testedAt" | "latencyMs">, latency = true): ProviderTestResult => ({
    ...base,
    ...r,
    ...(latency ? { latencyMs: now() - started } : {}),
    testedAt: new Date(now()).toISOString(),
  });
  const problems = validateProviderConfig(cfg);
  if (problems.length) return done({ status: "failed", code: "config_invalid", message: problems.join("；") }, false);

  const needsKey = PROVIDER_PRESETS[cfg.kind].needsKey;
  const key = cfg.keyRef ? await deps.secrets.get(cfg.keyRef) : undefined;
  if (needsKey && !key) return done({ status: "failed", code: "key_missing", message: providerMessage("key_missing") }, false);
  const secrets = key ? [key] : [];
  const log = (line: string): void => deps.log?.(redactSecrets(line, secrets));

  if (cfg.kind === "ollama" && deps.fetch) {
    try {
      const r = await deps.fetch(`${ollamaRoot(cfg.baseUrl)}/api/tags`);
      if (!r.ok) throw new Error(`status ${r.status}`);
    } catch {
      return done({ status: "failed", code: "ollama_not_running", message: providerMessage("ollama_not_running") });
    }
  }

  let agentId: string;
  try {
    agentId = await deps.provisioner.provision(cfg, key);
  } catch (e) {
    log(`provision failed: ${e instanceof Error ? e.message : String(e)}`);
    if (e instanceof SkillGuardError) {
      return done({ status: "failed", code: "skill_disable_failed", message: providerMessage("skill_disable_failed"), detail: { code: e.code } });
    }
    return done({ status: "failed", code: "fastclaw_error", message: providerMessage("fastclaw_error") });
  }

  try {
    const reply = await deps.chat.sendMessage(
      { agentId, sessionKey: `heybe-probe-${cfg.id}-${started}` },
      { messages: [{ role: "user", content: PROBE_PROMPT }], timeoutMs: deps.timeoutMs ?? PROBE_TIMEOUT_MS },
    );
    const text = reply.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return done({ status: "failed", code: "provider_error", message: providerMessage("provider_error") + "（回复为空）" });
  } catch (e) {
    log(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
    const c = classifyProviderError(e, cfg.kind);
    return done({ status: "failed", code: c.code, message: c.message, ...(c.detail ? { detail: c.detail } : {}) });
  }

  if (cfg.kind === "ollama" && deps.fetch) {
    const ctx = await ollamaContext(deps.fetch, cfg.baseUrl, cfg.model);
    if (ctx === undefined || ctx < OLLAMA_MIN_CTX) {
      const seen = ctx === undefined ? "未知" : String(ctx);
      return done({ status: "warning", code: "context_too_small", message: `${providerMessage("context_too_small")}（当前 ${seen}，需要 ≥ ${OLLAMA_MIN_CTX}；可设 OLLAMA_CONTEXT_LENGTH=16384 后重启 Ollama）` });
    }
  }
  return done({ status: "ok", code: "ok", message: providerMessage("ok") });
}
