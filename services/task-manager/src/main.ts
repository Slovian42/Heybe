// Entry point the desktop shell runs (19-b). Prints one READY line with the port on stdout.
// Exits (stopping the gateway) on SIGTERM/SIGINT, when stdin closes (the shell died), or
// when the owned gateway dies, so the shell's supervisor restarts both.
import { GatewayError } from "./gateway.js";
import { SandboxError } from "./sandbox.js";
import { ERROR_PREFIX, READY_PREFIX, startHeybeService } from "./service.js";

/** Exit code for errors a restart cannot fix (port taken, foreign/mismatched gateway). */
const EXIT_FATAL = 3;

async function main(): Promise<void> {
  const service = await startHeybeService(process.env);
  let exiting = false;
  const shutdown = async (code: number) => {
    if (exiting) return;
    exiting = true;
    await service.stop().catch(() => undefined);
    process.exit(code);
  };
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  if (process.env.HEYBE_SERVICE_WATCH_STDIN === "1") {
    process.stdin.on("end", () => void shutdown(0));
    process.stdin.on("close", () => void shutdown(0));
    process.stdin.resume();
  }
  void service.gatewayExited?.then(() => {
    process.stderr.write("heybe-service: FastClaw gateway exited; stopping\n");
    void shutdown(1);
  });
  process.stdout.write(`${READY_PREFIX}${JSON.stringify({ port: service.port })}\n`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "start failed";
  const code = err instanceof GatewayError || err instanceof SandboxError ? err.code : "E_SERVICE_START";
  // A serve that ignores its key or an incompatible BoxLite won't fix itself on retry.
  const retryable =
    err instanceof GatewayError ? err.retryable : err instanceof SandboxError ? err.code === "E_BOXLITE_EXITED" || err.code === "E_BOXLITE_READY_TIMEOUT" : true;
  process.stderr.write(`heybe-service: ${message}\n`);
  process.stdout.write(`${ERROR_PREFIX}${JSON.stringify({ code, message, retryable })}\n`);
  process.exit(retryable ? 1 : EXIT_FATAL);
});
