// Entry point the desktop shell runs (19-b). Prints one READY line with the port on stdout.
// Exits (stopping the gateway) on SIGTERM/SIGINT, when stdin closes (the shell died), or
// when the owned gateway dies, so the shell's supervisor restarts both.
import { READY_PREFIX, startHeybeService } from "./service.js";

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
  process.stderr.write(`heybe-service: ${err instanceof Error ? err.message : "start failed"}\n`);
  process.exit(1);
});
