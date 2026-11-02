// CLI entry for the BoxLite proxy (used by scripts/poc/boxlite-poc.sh; the product starts it in-process
// from sandbox.ts). Everything comes from the environment so no key ever appears in argv:
//   HEYBE_BOXLITE_PROXY_UPSTREAM   http://127.0.0.1:8100 (loopback only)
//   HEYBE_BOXLITE_PROXY_PORT       listen port on 127.0.0.1 (0 = random)
//   HEYBE_BOXLITE_PROXY_STRIP_AUTO_REMOVE  1 = drop auto_remove (fc-compat reject_auto_remove)
//   HEYBE_BOXLITE_CLIENT_KEY       required Bearer from FastClaw (its BOXLITE_API_KEY)
//   HEYBE_BOXLITE_UPSTREAM_KEY     Bearer sent to boxlite serve (its BOXLITE_SERVE_API_KEY); optional
// Prints `READY http://127.0.0.1:<port>` on stdout once listening. Keys are removed from process.env.
import { startBoxliteProxy } from "./boxlite-proxy.js";

async function main(): Promise<void> {
  const env = process.env;
  const clientKey = env.HEYBE_BOXLITE_CLIENT_KEY ?? "";
  const upstreamKey = env.HEYBE_BOXLITE_UPSTREAM_KEY || undefined;
  delete env.HEYBE_BOXLITE_CLIENT_KEY;
  delete env.HEYBE_BOXLITE_UPSTREAM_KEY;
  if (!clientKey) throw new Error("HEYBE_BOXLITE_CLIENT_KEY is required");
  const upstream = env.HEYBE_BOXLITE_PROXY_UPSTREAM ?? "http://127.0.0.1:8100";
  const port = Number(env.HEYBE_BOXLITE_PROXY_PORT ?? "0");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("HEYBE_BOXLITE_PROXY_PORT is not a port");
  const proxy = await startBoxliteProxy({
    upstream,
    upstreamKey,
    clientKey,
    stripAutoRemove: env.HEYBE_BOXLITE_PROXY_STRIP_AUTO_REMOVE === "1",
    port,
  });
  process.stdout.write(`READY ${proxy.url}\n`);
  const stop = () => void proxy.close().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

main().catch((err: unknown) => {
  process.stderr.write(`boxlite-proxy: ${(err as Error).message}\n`);
  process.exit(1);
});
