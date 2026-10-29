import { chmodSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Minimal environment for FastClaw gateway / CLI and any other child process
 * Heybe starts. FastClaw v1.4.0 hands its whole environment to stdio MCP servers
 * and plugins (internal/mcp/stdio.go `cmd.Env = os.Environ()`), so whatever the
 * gateway inherits leaks to third-party tools (docs/t043 §6, docs/t032 B2).
 *
 * Allowlist first: only names listed here (or passed in `extra`) survive.
 * Names that look like secrets are dropped even if allowlisted, unless the
 * caller names them explicitly in `extra` (e.g. DEEPSEEK_API_KEY for the one
 * `fastclaw agents init` call that stores the provider key).
 */
export const CHILD_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TZ",
  "TERM",
  "FASTCLAW_HOME",
  "FASTCLAW_PORT",
  "FASTCLAW_BIND",
  "FASTCLAW_SANDBOX_ENABLED",
  "FASTCLAW_SANDBOX_ENFORCE",
  "FASTCLAW_SANDBOX_BACKEND",
  "FASTCLAW_SANDBOX_BOXLITE_URL",
  "FASTCLAW_SANDBOX_BOXLITE_PREFIX",
  "DOCKER_HOST",
];

/** Never forwarded, even if a caller lists them: host_exec escape hatch. */
export const CHILD_ENV_DENY: readonly string[] = ["FASTCLAW_ALLOW_HOST_EXEC"];

const SECRET_PATTERNS: readonly RegExp[] = [
  /KEY/i,
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /PASSWD/i,
  /CREDENTIAL/i,
  /_DSN$/i,
  /^DATABASE_URL$/i,
  /SALT/i,
  /COOKIE/i,
  /SESSION/i,
];

export function isSecretEnvName(name: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(name));
}

export interface ChildEnvOptions {
  /** Extra names to forward. Secret-looking names are forwarded only when listed here. */
  extra?: readonly string[];
  /** Fixed values to set (e.g. FASTCLAW_HOME). Secret-looking keys must also be in `extra`. */
  set?: Record<string, string>;
}

export interface ChildEnvResult {
  env: Record<string, string>;
  /** Names that were present in the source but dropped (names only, never values). */
  dropped: string[];
}

export function buildChildEnv(source: Record<string, string | undefined> = process.env, opts: ChildEnvOptions = {}): ChildEnvResult {
  const extra = new Set(opts.extra ?? []);
  const allow = new Set([...CHILD_ENV_ALLOWLIST, ...extra]);
  const env: Record<string, string> = {};
  const dropped: string[] = [];
  const consider = (name: string, value: string | undefined): void => {
    if (value === undefined) return;
    const ok = allow.has(name) && !CHILD_ENV_DENY.includes(name) && (!isSecretEnvName(name) || extra.has(name));
    if (ok) env[name] = value;
    else dropped.push(name);
  };
  for (const [name, value] of Object.entries(source)) consider(name, value);
  for (const [name, value] of Object.entries(opts.set ?? {})) {
    delete env[name];
    const i = dropped.indexOf(name);
    if (i >= 0) dropped.splice(i, 1);
    consider(name, value);
  }
  return { env, dropped: dropped.sort() };
}

/**
 * FastClaw's data dir holds the provider key in plaintext (fastclaw.db configs.data,
 * docs/t043 §5): treat the whole tree as a secret. Dirs 700, files 600.
 */
export function lockPrivateTree(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const walk = (p: string): void => {
    const st = statSync(p, { throwIfNoEntry: false });
    if (!st || st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      chmodSync(p, 0o700);
      for (const name of readdirSync(p)) walk(join(p, name));
    } else if (st.isFile()) {
      chmodSync(p, 0o600);
    }
  };
  walk(root);
}
