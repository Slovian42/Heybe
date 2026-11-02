// Where the local Heybe service is and its startup token (19-b).
// In the Tauri app both come from the `service_info` command (random port + token,
// never in the URL or env of the webview). In plain `vite dev` (no Tauri) they come
// from VITE_HEYBE_SERVICE_URL / VITE_HEYBE_SERVICE_TOKEN for browser-only debugging.

export type ServiceStatus = "starting" | "ready" | "reconnecting" | "failed";

export interface ServiceInfo {
  status: ServiceStatus;
  url: string | null;
  token: string;
  restarts: number;
}

export type Invoke = (cmd: string) => Promise<unknown>;

const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/;

export function loopbackUrl(raw: string | null | undefined): string | null {
  return raw && LOOPBACK.test(raw) ? raw.replace(/\/$/, "") : null;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadServiceInfo(
  invoke?: Invoke,
  env: Record<string, string | undefined> = import.meta.env as Record<string, string | undefined>,
): Promise<ServiceInfo> {
  if (invoke) {
    const raw = (await invoke("service_info")) as Partial<ServiceInfo>;
    const status = raw.status ?? "failed";
    return {
      status,
      url: status === "ready" ? loopbackUrl(raw.url) : null,
      token: typeof raw.token === "string" ? raw.token : "",
      restarts: raw.restarts ?? 0,
    };
  }
  const url = loopbackUrl(env.VITE_HEYBE_SERVICE_URL);
  return { status: url ? "ready" : "failed", url, token: env.VITE_HEYBE_SERVICE_TOKEN ?? "", restarts: 0 };
}

export const STATUS_BANNER: Record<ServiceStatus, string> = {
  starting: "正在启动本地服务…",
  ready: "",
  reconnecting: "本地服务断开，正在重连…",
  failed: "本地服务没有启动，请退出后重开 Heybe",
};
