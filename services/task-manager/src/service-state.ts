// Startup report for the local service (Refs #6 #12, Mac recheck of #90):
// - one stderr line with the sandbox mode and FastClaw deploy mode (the desktop dev terminal shows it);
// - optional state dir (HEYBE_SERVICE_STATE_DIR) for scripts/dev/product-sandbox-check.sh and a precise
//   kill: task-manager.pid, service-state.json (pids/ports/modes only, never keys) and sandbox.log
//   (the BoxLite proxy's lines, also on stderr). Removed again on a clean stop.
import { appendFileSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STATE_PID_FILE = "task-manager.pid";
export const STATE_JSON_FILE = "service-state.json";
export const STATE_SANDBOX_LOG = "sandbox.log";
/** argv marker on the service process (package.json start script) so `pkill -f` can match it exactly. */
export const ROLE_MARKER = "--heybe-role=task-manager";

export type SandboxMode = "boxlite" | "none" | "not_owned";

export interface ServiceState {
  pid: number;
  service_port: number;
  /** boxlite: our gateway runs in the BoxLite sandbox; none: our gateway without a sandbox; not_owned: no gateway started here. */
  sandbox: SandboxMode;
  /** FastClaw deploy mode we gave our gateway ("hosted" only with the sandbox). */
  deploy: "hosted" | "self-hosted" | "unknown";
  gateway_port?: number;
  serve_port?: number;
  proxy_port?: number;
  started_at: string;
}

const portOf = (url: string | undefined): number | undefined => {
  if (!url) return undefined;
  const p = Number(new URL(url).port);
  return Number.isInteger(p) && p > 0 ? p : undefined;
};

export function sandboxPorts(s: { proxyUrl: string; serveUrl: string } | undefined): { serve_port?: number; proxy_port?: number } {
  return { serve_port: portOf(s?.serveUrl), proxy_port: portOf(s?.proxyUrl) };
}

/** The stderr line printed once at startup. Contains no key. */
export function serviceModeLine(st: Pick<ServiceState, "sandbox" | "deploy" | "proxy_port" | "serve_port" | "gateway_port">): string {
  if (st.sandbox === "boxlite") {
    return (
      `heybe-service: 沙箱=boxlite（FastClaw 127.0.0.1:${st.gateway_port} → 代理 127.0.0.1:${st.proxy_port}，` +
      `强制 outbound=disabled → serve 127.0.0.1:${st.serve_port}）部署模式=${st.deploy}`
    );
  }
  if (st.sandbox === "none") {
    return `heybe-service: 沙箱=无（未设 HEYBE_BOXLITE_BIN，FastClaw 127.0.0.1:${st.gateway_port} 不在沙箱里）部署模式=${st.deploy}（未设 FASTCLAW_DEPLOY）`;
  }
  return "heybe-service: 沙箱=未知（本服务不启动 FastClaw，未设 HEYBE_FASTCLAW_GATEWAY_BIN）部署模式=unknown";
}

export interface StateDir {
  write(st: ServiceState): void;
  /** Appends to sandbox.log (and nothing else). */
  sandboxLog(line: string): void;
  remove(): void;
}

export function openStateDir(dir: string): StateDir {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const write600 = (name: string, body: string) => {
    const f = join(dir, name);
    writeFileSync(f, body, { mode: 0o600 });
    chmodSync(f, 0o600);
  };
  write600(STATE_SANDBOX_LOG, "");
  return {
    write(st) {
      write600(STATE_JSON_FILE, `${JSON.stringify(st)}\n`);
      write600(STATE_PID_FILE, `${st.pid}\n`);
    },
    sandboxLog(line) {
      try {
        appendFileSync(join(dir, STATE_SANDBOX_LOG), `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
      } catch {
        // the log is a diagnostic aid only
      }
    },
    remove() {
      for (const f of [STATE_PID_FILE, STATE_JSON_FILE]) rmSync(join(dir, f), { force: true });
    },
  };
}
