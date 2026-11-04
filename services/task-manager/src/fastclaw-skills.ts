// v1 turns off FastClaw's bundled camoufox-cli browser skill (Refs #7 #12).
//
// Second approved exception to "Heybe only talks to FastClaw over /v1" (Yang, 2026-11-02;
// docs/architecture.md §3.10): FastClaw v1.4.0 has no /v1 route for skills, and `skills.entries`
// is a system-scope setting (FC:internal/agentcli/agentcli.go systemSettingNamespaces) that only
// the CLI (or /api/*) writes. The only CLI calls allowed here are
//   fastclaw agents config <agent> get skills.entries.camoufox-cli.enabled
//   fastclaw agents config <agent> set skills.entries.camoufox-cli.enabled false
// and nothing else: no other key, no other value.
//
// Why: v1 ships no browser capability. A browser skill could fetch the web from the host side of
// the sandbox story (P-SAFE-1); the hard boundary stays the proxy's network.mode=disabled, this is
// the second layer. enabled:false makes FastClaw's skill loader treat the skill as disabled
// (FC:internal/agent/skills.go "global entries for enabled: false").
//
// Idempotent: read first; write only when it is not already false; always read back after a write.
// Child env: the generic allowlist only (FASTCLAW_HOME etc.). No key is needed or forwarded, and
// argv never carries anything but the fixed words above plus the agent id.
import { spawn } from "node:child_process";

import { buildChildEnv } from "./child-env.js";

export const CAMOUFOX_SKILL = "camoufox-cli";
export const CAMOUFOX_ENABLED_KEY = `skills.entries.${CAMOUFOX_SKILL}.enabled`;

export type SkillGuardErrorCode = "E_FC_SKILL_DISABLE_FAILED";

/** Chinese text for the UI / HEYBE_SERVICE_ERROR line. */
export const SKILL_DISABLE_FAILED_MESSAGE =
  "没能关闭 FastClaw 的浏览器技能（camoufox-cli）。为了安全，Heybe 不在这种状态下运行；请重启 Heybe，仍失败请把日志发给我们";

export class SkillGuardError extends Error {
  readonly code: SkillGuardErrorCode = "E_FC_SKILL_DISABLE_FAILED";
  /** Short, secret-free reason for logs (exit code / what was read back). */
  readonly reason: string;
  constructor(reason: string) {
    super(`${SKILL_DISABLE_FAILED_MESSAGE}（${reason}）`);
    this.name = "SkillGuardError";
    this.reason = reason;
  }
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type CliRunner = (args: string[], env: Record<string, string>) => Promise<CliResult>;

/** Spawn `bin` with an explicit env and no shell. */
export const spawnCliRunner = (bin: string): CliRunner => (args, env) =>
  new Promise((resolve) => {
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += String(d)));
    child.stderr.on("data", (d) => (stderr += String(d)));
    child.on("error", (e) => resolve({ code: 127, stdout, stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

// An agt_ id or agent name; never something the CLI could read as a flag.
const AGENT_REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

export function camoufoxGetArgs(agent: string): string[] {
  return ["agents", "config", agent, "get", CAMOUFOX_ENABLED_KEY];
}
export function camoufoxSetArgs(agent: string): string[] {
  return ["agents", "config", agent, "set", CAMOUFOX_ENABLED_KEY, "false"];
}

/** `get` prints `false` for the bool (FC printValue). Anything else (true / null / error text) is "not off". */
export function readBackIsFalse(stdout: string): boolean {
  return stdout.trim() === "false";
}

/** Short description of what was read back, for the error (never full CLI output). */
function describe(r: CliResult): string {
  if (r.code !== 0) return `get 退出码 ${r.code}`;
  const v = r.stdout.trim();
  return `读回 ${/^[a-z]{1,8}$/.test(v) ? v : v ? "非预期内容" : "空"}`;
}

export type CamoufoxOutcome = "already_disabled" | "disabled";

export interface SkillGuardOptions {
  /** fastclaw binary (same one as the gateway). */
  bin?: string;
  run?: CliRunner;
  /** Parent env; filtered through buildChildEnv (allowlist only, no secrets). */
  env?: Record<string, string | undefined>;
}

/**
 * Make sure camoufox-cli is disabled (system scope; `agent` only has to exist).
 * Resolves with what happened; throws SkillGuardError (E_FC_SKILL_DISABLE_FAILED) when the
 * write fails or the read-back is not `false`.
 */
export async function ensureCamoufoxDisabled(agent: string, opts: SkillGuardOptions = {}): Promise<CamoufoxOutcome> {
  if (!AGENT_REF.test(agent)) throw new SkillGuardError("Agent 标识不合法");
  const run = opts.run ?? spawnCliRunner(opts.bin ?? "fastclaw");
  const { env } = buildChildEnv(opts.env ?? process.env);

  const before = await run(camoufoxGetArgs(agent), env);
  if (before.code === 0 && readBackIsFalse(before.stdout)) return "already_disabled";

  const set = await run(camoufoxSetArgs(agent), env);
  if (set.code !== 0) throw new SkillGuardError(`set 退出码 ${set.code}`);

  const after = await run(camoufoxGetArgs(agent), env);
  if (after.code !== 0 || !readBackIsFalse(after.stdout)) throw new SkillGuardError(describe(after));
  return "disabled";
}

/** One log line (stderr) for the startup check; Mac recheck greps for `camoufox-cli`. */
export function camoufoxLogLine(outcome: CamoufoxOutcome | "skipped_no_agent", agent?: string): string {
  if (outcome === "skipped_no_agent") return `heybe-service: camoufox-cli 检查跳过：还没有 Agent（建 Agent 时会关闭）`;
  const what = outcome === "already_disabled" ? "已是关闭状态" : "已关闭";
  return `heybe-service: camoufox-cli 技能${what}（读回 ${CAMOUFOX_ENABLED_KEY}=false，agent ${agent}）`;
}
