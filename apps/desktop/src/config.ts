// Local Heybe service URL. 19-b will hand over a random port + token via Tauri IPC;
// until then dev/acceptance set VITE_HEYBE_SERVICE_URL (must be http://127.0.0.1:<port>).
export const DEFAULT_SERVICE_URL = "http://127.0.0.1:18790";

export function serviceUrl(raw: string | undefined = import.meta.env.VITE_HEYBE_SERVICE_URL as string | undefined): string {
  if (raw && /^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(raw)) return raw.replace(/\/$/, "");
  return DEFAULT_SERVICE_URL;
}
