import type Database from "better-sqlite3";
import type { NodeExecutor } from "@heybe/shared-types/task-manager";

import { DEFAULT_WORKER_SLOTS } from "./constants.js";
import { dispatchOnce } from "./dispatch.js";

export interface DispatchLoopOptions {
  /** Scheduler identity for leases. Not an agent id. */
  owner: string;
  /** Optional FastClaw agent id to backfill on unassigned nodes. */
  agentId?: string;
  workerSlots?: number;
  leaseMs?: number;
  /** Idle poll interval in ms. Default 1000. */
  idleMs?: number;
  onError?: (error: unknown) => void;
}

export interface DispatchLoop {
  /** Stop claiming new nodes and wait for in-flight ones to settle. */
  stop(): Promise<void>;
  readonly inflight: number;
}

/**
 * Resident dispatcher: keeps up to workerSlots nodes running at once.
 * Concurrency is also enforced by claimNextNode's lease count.
 */
export function startDispatchLoop(
  db: Database.Database,
  executor: NodeExecutor,
  opts: DispatchLoopOptions,
): DispatchLoop {
  const slots = opts.workerSlots ?? DEFAULT_WORKER_SLOTS;
  const idleMs = opts.idleMs ?? 1000;
  const running = new Set<Promise<void>>();
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let wake: (() => void) | undefined;

  const sleep = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, idleMs);
    });

  const loop = (async () => {
    while (!stopped) {
      while (!stopped && running.size < slots) {
        // dispatchOnce claims synchronously and calls execute() before its first await,
        // so this flag tells us right away whether a node was taken.
        let claimed = false;
        const wrapped: NodeExecutor = {
          execute: (req) => {
            claimed = true;
            return executor.execute(req);
          },
        };
        let p: Promise<void>;
        try {
          p = dispatchOnce(db, wrapped, {
            owner: opts.owner,
            agentId: opts.agentId,
            workerSlots: slots,
            leaseMs: opts.leaseMs,
          }).then(
            () => undefined,
            (e: unknown) => opts.onError?.(e),
          );
        } catch (e) {
          opts.onError?.(e);
          break;
        }
        if (!claimed) break;
        const tracked = p.finally(() => {
          running.delete(tracked);
          wake?.();
        });
        running.add(tracked);
      }
      if (stopped) break;
      await sleep();
      if (timer) clearTimeout(timer);
    }
  })();

  return {
    get inflight() {
      return running.size;
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      wake?.();
      await loop;
      await Promise.allSettled([...running]);
    },
  };
}
