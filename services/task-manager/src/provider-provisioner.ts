import { fastclawProviderName, type ProviderConfig } from "@heybe/shared-types";
import { buildChildEnv } from "./child-env.js";
import { ensureCamoufoxDisabled, spawnCliRunner, type CliRunner } from "./fastclaw-skills.js";

export type { CliResult, CliRunner } from "./fastclaw-skills.js";

/** Creates/updates the FastClaw agent bound to a provider. Returns the agent id. */
export interface ProviderProvisioner {
  provision(cfg: ProviderConfig, key: string | undefined): Promise<string>;
}

export const PROVIDER_KEY_ENV = "HEYBE_PROVIDER_KEY";

export function probeAgentName(cfg: ProviderConfig): string {
  return `heybe-probe-${cfg.id}`;
}

/** Build `fastclaw agents init` args. The key is never on argv; only the env var name is. */
export function initArgs(cfg: ProviderConfig, hasKey: boolean, agentId?: string): string[] {
  const provider = fastclawProviderName(cfg);
  const args = ["agents", "init", probeAgentName(cfg), "--provider", provider, "--model", cfg.kind === "ollama" ? `ollama/${cfg.model}` : cfg.model, "--api-base", cfg.baseUrl];
  if (hasKey) args.push("--api-key-env", PROVIDER_KEY_ENV);
  if (agentId) args.push("--id", agentId);
  return args;
}

export function parseAgentId(stdout: string): string | undefined {
  return /^Agent ID:\s*(agt_[A-Za-z0-9]+)/m.exec(stdout)?.[1];
}

export function parseExistingId(text: string): string | undefined {
  return /already exists \(id (agt_[A-Za-z0-9]+)\)/.exec(text)?.[1];
}

/**
 * FastClaw v1.4.0 has no /v1 route to set an agent's provider, so this uses the CLI
 * (`fastclaw agents init`, exception 1). stdout may contain an admin password: we keep
 * only the `Agent ID:` line and never log or return the rest.
 *
 * After every init (new or existing agent) it also makes sure the camoufox-cli browser
 * skill is off (`fastclaw agents config <id> get|set skills.entries.camoufox-cli.enabled`,
 * exception 2, fastclaw-skills.ts); a failed write or read-back throws SkillGuardError.
 */
export class FastClawCliProvisioner implements ProviderProvisioner {
  private readonly run: CliRunner;
  constructor(opts: { bin?: string; run?: CliRunner; env?: Record<string, string | undefined> } = {}) {
    this.run = opts.run ?? spawnCliRunner(opts.bin ?? "fastclaw");
    this.baseEnv = opts.env ?? process.env;
  }
  private readonly baseEnv: Record<string, string | undefined>;

  async provision(cfg: ProviderConfig, key: string | undefined): Promise<string> {
    const id = await this.init(cfg, key);
    // No key in this env: the skill check needs none (allowlist only).
    await ensureCamoufoxDisabled(id, { run: this.run, env: this.baseEnv });
    return id;
  }

  private async init(cfg: ProviderConfig, key: string | undefined): Promise<string> {
    const k = key;
    const { env } = buildChildEnv(this.baseEnv, k ? { extra: [PROVIDER_KEY_ENV], set: { [PROVIDER_KEY_ENV]: k } } : {});
    let r = await this.run(initArgs(cfg, !!k), env);
    if (r.code !== 0) {
      const existing = parseExistingId(r.stdout + r.stderr);
      if (!existing) throw new Error(`fastclaw agents init 失败（退出码 ${r.code}）`);
      r = await this.run(initArgs(cfg, !!k, existing), env);
      if (r.code !== 0) throw new Error(`fastclaw agents init --id 失败（退出码 ${r.code}）`);
      return parseAgentId(r.stdout) ?? existing;
    }
    const id = parseAgentId(r.stdout);
    if (!id) throw new Error("fastclaw agents init 没有返回 Agent ID");
    return id;
  }
}
