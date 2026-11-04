// #16 T1.2.1 model provider config. Pure types + validation; no secrets here.
// `keyRef` is only the name of a keychain entry; the key itself never enters this shape.

export const PROVIDER_KINDS = ["deepseek", "openai", "anthropic", "openrouter", "ollama", "openai_compatible"] as const;
export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface ProviderConfig {
  /** Stable id, `[a-z0-9-]{1,40}`. Also the FastClaw provider name for openai_compatible. */
  id: string;
  kind: ProviderKind;
  /** http(s) only. */
  baseUrl: string;
  /** Model id at the provider, e.g. `deepseek-chat`, `qwen2.5:3b`. */
  model: string;
  /** Keychain entry name. Absent for Ollama (no key). */
  keyRef?: string;
  label?: string;
}

export interface ProviderPreset {
  kind: ProviderKind;
  /** FastClaw `--provider` name (openai_compatible uses the config id instead). */
  fastclawProvider: string;
  baseUrl: string;
  defaultModel: string;
  needsKey: boolean;
  /** Hidden behind “高级” in the settings UI (16-e). */
  advanced: boolean;
  docsUrl: string;
}

/** Base URLs match FastClaw v1.4.0 `providerPreset` (internal/agentcli/agentcli.go). */
export const PROVIDER_PRESETS: Readonly<Record<ProviderKind, ProviderPreset>> = {
  deepseek: { kind: "deepseek", fastclawProvider: "deepseek", baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-chat", needsKey: true, advanced: false, docsUrl: "https://api-docs.deepseek.com/" },
  openai: { kind: "openai", fastclawProvider: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", needsKey: true, advanced: false, docsUrl: "https://platform.openai.com/docs/api-reference/chat" },
  anthropic: { kind: "anthropic", fastclawProvider: "anthropic", baseUrl: "https://api.anthropic.com", defaultModel: "claude-3-5-haiku-latest", needsKey: true, advanced: false, docsUrl: "https://docs.anthropic.com/en/api/messages" },
  openrouter: { kind: "openrouter", fastclawProvider: "openrouter", baseUrl: "https://openrouter.ai/api/v1", defaultModel: "openai/gpt-4o-mini", needsKey: true, advanced: false, docsUrl: "https://openrouter.ai/docs/api-reference/overview" },
  ollama: { kind: "ollama", fastclawProvider: "ollama", baseUrl: "http://127.0.0.1:11434/v1", defaultModel: "qwen2.5:3b", needsKey: false, advanced: true, docsUrl: "https://github.com/ollama/ollama/blob/main/docs/openai.md" },
  openai_compatible: { kind: "openai_compatible", fastclawProvider: "", baseUrl: "", defaultModel: "", needsKey: true, advanced: true, docsUrl: "https://platform.openai.com/docs/api-reference/chat" },
};

/** Default preset shipped on first launch (D3/D4). */
export const DEFAULT_PROVIDER: ProviderConfig = {
  id: "deepseek",
  kind: "deepseek",
  baseUrl: PROVIDER_PRESETS.deepseek.baseUrl,
  model: PROVIDER_PRESETS.deepseek.defaultModel,
  keyRef: "heybe.provider.deepseek",
};

/**
 * FastClaw v1.4.0 stores provider config (key + base) globally **by provider name**:
 * every agent using `--provider deepseek` shares whatever the last `agents init`
 * wrote. So Heybe allows one config per preset kind (one key per provider), while
 * openai_compatible configs use their own id as provider name and may be many.
 * Decision confirmed by Yang 2026-11-02.
 */
export function fastclawProviderName(cfg: Pick<ProviderConfig, "id" | "kind">): string {
  return cfg.kind === "openai_compatible" ? cfg.id : PROVIDER_PRESETS[cfg.kind].fastclawProvider;
}

/** Provider names owned by presets; an openai_compatible id must not reuse them. */
export const RESERVED_PROVIDER_NAMES: readonly string[] = PROVIDER_KINDS.filter((k) => k !== "openai_compatible").map(
  (k) => PROVIDER_PRESETS[k].fastclawProvider,
);

/** Conventional keychain entry for a provider: one key per FastClaw provider name. */
export function providerKeyRef(cfg: Pick<ProviderConfig, "id" | "kind">): string {
  return `heybe.provider.${fastclawProviderName(cfg)}`;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MODEL_RE = /^[\w.:/@-]{1,128}$/;
const KEYREF_RE = /^[\w.-]{1,128}$/;

/** Returns a list of problems (Chinese, user-facing). Empty → valid. */
export function validateProviderConfig(cfg: ProviderConfig): string[] {
  const errors: string[] = [];
  if (!ID_RE.test(cfg.id)) errors.push("提供方 id 只能用小写字母、数字和 -，最多 40 个字符");
  if (!(PROVIDER_KINDS as readonly string[]).includes(cfg.kind)) errors.push("不支持的提供方类型");
  let url: URL | null = null;
  try {
    url = new URL(cfg.baseUrl);
  } catch {
    errors.push("接口地址格式不对");
  }
  if (url) {
    if (url.protocol !== "http:" && url.protocol !== "https:") errors.push("接口地址只支持 http/https");
    if (url.username || url.password) errors.push("接口地址里不能带用户名或密码");
    if (url.search || url.hash) errors.push("接口地址不能带查询参数");
  }
  if (!MODEL_RE.test(cfg.model)) errors.push("模型名不合法");
  const preset = PROVIDER_PRESETS[cfg.kind];
  if (preset?.needsKey && !cfg.keyRef) errors.push("这个提供方需要密钥");
  if (cfg.keyRef !== undefined && !KEYREF_RE.test(cfg.keyRef)) errors.push("密钥引用名不合法");
  if (cfg.kind === "openai_compatible" && RESERVED_PROVIDER_NAMES.includes(cfg.id))
    errors.push(`自定义兼容接口的 id 不能用“${cfg.id}”：这是内置提供方的名字，会覆盖它的密钥和接口地址`);
  return errors;
}

/**
 * Problems with a whole set of configs (Chinese, user-facing). Empty → valid.
 * Rule (2026-11-02): at most one config per FastClaw provider name, because
 * FastClaw shares provider config globally by name; a second one would silently
 * overwrite the first one's key and base URL.
 */
export function validateProviderSet(configs: readonly ProviderConfig[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const byName = new Map<string, string>();
  for (const cfg of configs) {
    for (const e of validateProviderConfig(cfg)) errors.push(`${cfg.id}：${e}`);
    if (ids.has(cfg.id)) errors.push(`提供方 id “${cfg.id}” 重复`);
    ids.add(cfg.id);
    const name = fastclawProviderName(cfg);
    const first = byName.get(name);
    if (first !== undefined && first !== cfg.id) errors.push(duplicateProviderMessage(cfg, first));
    else byName.set(name, cfg.id);
  }
  return errors;
}

function duplicateProviderMessage(cfg: ProviderConfig, existingId: string): string {
  return `已经配置过 ${fastclawProviderName(cfg)}（配置 “${existingId}”）。每种提供方只能配一个密钥：FastClaw 按提供方名称全局共享配置，再加一个会覆盖前一个。请修改已有配置；需要多个端点请用“自定义兼容接口”。`;
}

export class DuplicateProviderError extends Error {
  constructor(
    message: string,
    readonly existingId: string,
  ) {
    super(message);
    this.name = "DuplicateProviderError";
  }
}

/**
 * Add or update one config in a list. Invalid config → throws Error (Chinese).
 * Same id → overwrite (update in place).
 * Different id but same FastClaw provider name → throws DuplicateProviderError.
 * Never mutates `configs`.
 */
export function upsertProviderConfig(configs: readonly ProviderConfig[], cfg: ProviderConfig): ProviderConfig[] {
  const problems = validateProviderConfig(cfg);
  if (problems.length) throw new Error(problems.join("；"));
  const name = fastclawProviderName(cfg);
  const clash = configs.find((c) => c.id !== cfg.id && fastclawProviderName(c) === name);
  if (clash) throw new DuplicateProviderError(duplicateProviderMessage(cfg, clash.id), clash.id);
  const i = configs.findIndex((c) => c.id === cfg.id);
  return i >= 0 ? configs.map((c, j) => (j === i ? cfg : c)) : [...configs, cfg];
}

/** What the API returns about a key: never the key, at most its last 4 chars. */
export interface ProviderKeyStatus {
  set: boolean;
  last4?: string;
}

export type ProviderTestCode =
  | "ok"
  | "key_missing"
  | "key_invalid"
  | "model_not_found"
  | "rate_limited"
  | "network_unreachable"
  | "timeout"
  | "ollama_not_running"
  | "context_too_small"
  | "provider_error"
  | "fastclaw_error"
  /** camoufox-cli browser skill could not be turned off / read back as false (E_FC_SKILL_DISABLE_FAILED). */
  | "skill_disable_failed"
  | "config_invalid";

export interface ProviderTestResult {
  providerId: string;
  kind: ProviderKind;
  /** ok = passed; warning = reply received but setup will misbehave (e.g. Ollama ctx < 16k). */
  status: "ok" | "warning" | "failed";
  code: ProviderTestCode;
  /** Chinese reason for the UI. */
  message: string;
  /** Upstream status / provider code only; never response bodies. */
  detail?: { status?: number; code?: string };
  latencyMs?: number;
  testedAt: string;
}
