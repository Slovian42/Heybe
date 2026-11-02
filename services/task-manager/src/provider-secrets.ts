import { execFile } from "node:child_process";
import type { ProviderKeyStatus } from "@heybe/shared-types";

/**
 * Where provider API keys live (#16 T1.2.2). Keys never enter SQLite, logs, events
 * or HTTP responses; callers only ever see `status()` (set + last 4 chars).
 */
export interface SecretStore {
  get(ref: string): Promise<string | undefined>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
  status(ref: string): Promise<ProviderKeyStatus>;
}

export function keyStatus(value: string | undefined): ProviderKeyStatus {
  if (!value) return { set: false };
  return value.length >= 12 ? { set: true, last4: value.slice(-4) } : { set: true };
}

/** For tests and non-mac dev. */
export class MemorySecretStore implements SecretStore {
  private readonly map = new Map<string, string>();
  async get(ref: string): Promise<string | undefined> {
    return this.map.get(ref);
  }
  async set(ref: string, value: string): Promise<void> {
    this.map.set(ref, value);
  }
  async delete(ref: string): Promise<void> {
    this.map.delete(ref);
  }
  async status(ref: string): Promise<ProviderKeyStatus> {
    return keyStatus(this.map.get(ref));
  }
}

/** Runs `/usr/bin/security`. `stdin`, when given, is written to the child's stdin and closed. */
export type SecurityRun = (args: string[], stdin?: string) => Promise<{ code: number; stdout: string }>;

const runSecurity: SecurityRun = (args, stdin) =>
  new Promise((resolve) => {
    const child = execFile("/usr/bin/security", args, { encoding: "utf8" }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(stdin ?? "");
  });

/** Chars that would break `security -i` line parsing / quoting. */
// eslint-disable-next-line no-control-regex -- deliberately rejecting control chars
const UNSAFE_SECRET = /["\\\x00-\x1f\x7f]/;
const SAFE_NAME = /^[\w.-]{1,128}$/;

/**
 * The `security -i` command line that stores a secret. Sent on stdin only, so the
 * secret never appears in any process argv (`ps`).
 */
export function keychainAddCommand(service: string, ref: string, value: string): string {
  if (!SAFE_NAME.test(service) || !SAFE_NAME.test(ref)) throw new Error("钥匙串条目名不合法");
  if (!value || UNSAFE_SECRET.test(value)) throw new Error("密钥里有不支持的字符（引号、反斜杠或控制字符）");
  return `add-generic-password -U -s "${service}" -a "${ref}" -w "${value}"\n`;
}

/**
 * macOS login keychain via `/usr/bin/security` generic passwords (service = "heybe", account = ref).
 *
 * Writes go through `security -i` (interactive mode) with the command on stdin,
 * so the key is never on any argv. Reads use `find-generic-password -w`, whose
 * value arrives on stdout only. Errors never include the value.
 */
export class MacKeychainSecretStore implements SecretStore {
  constructor(private readonly service = "heybe", private readonly run: SecurityRun = runSecurity) {}

  async get(ref: string): Promise<string | undefined> {
    const r = await this.run(["find-generic-password", "-s", this.service, "-a", ref, "-w"]);
    if (r.code !== 0) return undefined;
    const v = r.stdout.replace(/\n$/, "");
    return v || undefined;
  }
  async set(ref: string, value: string): Promise<void> {
    const r = await this.run(["-i"], keychainAddCommand(this.service, ref, value));
    // `security -i` exits 0 even if the inner command fails; verify by reading back.
    if (r.code !== 0 || (await this.get(ref)) !== value) throw new Error(`钥匙串写入失败（${ref}，退出码 ${r.code}）`);
  }
  async delete(ref: string): Promise<void> {
    await this.run(["delete-generic-password", "-s", this.service, "-a", ref]);
  }
  async status(ref: string): Promise<ProviderKeyStatus> {
    return keyStatus(await this.get(ref));
  }
}
