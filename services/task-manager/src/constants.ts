export const DEFAULT_WORKER_SLOTS = 2;
export const DEFAULT_LEASE_MS = 30_000;
export const LOOPBACK_HOST = "127.0.0.1";

export const EventType = {
  TaskCreated: "task_created",
  TaskStatus: "task_status",
  TaskCancelled: "task_cancelled",
  NodeClaimed: "node_claimed",
  NodeStatus: "node_status",
  AttemptFinished: "attempt_finished",
  StaleResultRejected: "stale_result_rejected",
} as const;
