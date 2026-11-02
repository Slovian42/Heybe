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

type Run = (args: string[]) => Promise<{ code: number; stdout: string }>;

const runSecurity: Run = (args) =>
  new Promise((resolve) => {
    execFile("/usr/bin/security", args, { encoding: "utf8" }, (err, stdout) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout ?? "") });
    });
  });

/**
 * macOS login keychain via `/usr/bin/security` generic passwords (service = "heybe", account = ref).
 *
 * Known limit: `add-generic-password -w <value>` puts the key on argv for the
 * lifetime of that process (visible to same-user `ps`). Accepted for v1; see
 * docs/providers/README.md §密钥存储. Errors never include the value.
 */
export class MacKeychainSecretStore implements SecretStore {
  constructor(private readonly service = "heybe", private readonly run: Run = runSecurity) {}

  async get(ref: string): Promise<string | undefined> {
    const r = await this.run(["find-generic-password", "-s", this.service, "-a", ref, "-w"]);
    if (r.code !== 0) return undefined;
    const v = r.stdout.replace(/\n$/, "");
    return v || undefined;
  }
  async set(ref: string, value: string): Promise<void> {
    const r = await this.run(["add-generic-password", "-U", "-s", this.service, "-a", ref, "-w", value]);
    if (r.code !== 0) throw new Error(`钥匙串写入失败（${ref}，退出码 ${r.code}）`);
  }
  async delete(ref: string): Promise<void> {
    await this.run(["delete-generic-password", "-s", this.service, "-a", ref]);
  }
  async status(ref: string): Promise<ProviderKeyStatus> {
    return keyStatus(await this.get(ref));
  }
}
