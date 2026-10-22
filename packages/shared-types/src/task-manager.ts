// Additive task-manager types. Kept in a new module so other changes can
// keep editing index.ts and pro-interface.ts without overlapping this file.
import type { Budget, NodeStatus, Task, TaskNode, TaskStatus } from "./index.js";

export type { Budget, NodeStatus, Task, TaskNode, TaskStatus };

/** Every TaskStatus. A new union member must be added here or this stops compiling. */
const STATUS_FLAGS = {
  pending: true,
  running: true,
  awaiting_review: true,
  completed: true,
  waiting_user: true,
  retry_wait: true,
  needs_check: true,
  failed: true,
  cancelled: true,
} as const satisfies Record<TaskStatus, true>;

export const TASK_STATUSES = Object.keys(STATUS_FLAGS) as (keyof typeof STATUS_FLAGS)[];

export function isTaskStatus(value: string): value is TaskStatus {
  return Object.prototype.hasOwnProperty.call(STATUS_FLAGS, value);
}

export interface TaskRecord extends Task {
  idempotencyKey: string | null;
  routineRunId: string | null;
  sourceEventKey: string | null;
}

export interface NodeRecord extends Omit<TaskNode, "assignedAgentId"> {
  assignedAgentId: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  timeoutSec: number | null;
}

export interface CreateNodeInput {
  id?: string;
  dependsOn?: string[];
  assignedAgentId?: string | null;
  requiredCapabilities?: string[];
  fallbackAgentIds?: string[];
  acceptanceCriteria?: string;
  timeoutSec?: number | null;
}

export interface CreateTaskInput {
  goal: string;
  deliverables?: string[];
  budget?: Budget;
  authorizationScope?: string[];
  idempotencyKey?: string;
  routineRunId?: string;
  sourceEventKey?: string;
  nodes?: CreateNodeInput[];
}

export type AttemptStatus =
  | "running"
  | "awaiting_review"
  | "waiting_user"
  | "retry_wait"
  | "needs_check"
  | "failed"
  | "invalidated";

export interface AttemptRecord {
  id: string;
  nodeId: string;
  agentId: string;
  executionVersion: number;
  status: AttemptStatus;
  checkpoint: unknown;
  error: string | null;
  startedAt: string;
  endedAt: string | null;
  invalidated: boolean;
}

export interface TaskEventRecord {
  id: number;
  taskId: string;
  nodeId: string | null;
  attemptId: string | null;
  type: string;
  data: Record<string, unknown> | null;
  at: string;
}

/**
 * What an executor is allowed to report. "completed" is intentionally absent:
 * saying done only moves a node to awaiting_review.
 */
export type ExecutionOutcome =
  | "awaiting_review"
  | "waiting_user"
  | "retry_wait"
  | "needs_check"
  | "failed";

export interface ExecutionRequest {
  taskId: string;
  nodeId: string;
  attemptId: string;
  agentId: string | null;
  executionVersion: number;
  goal: string;
  acceptanceCriteria: string;
}

export interface ExecutionResult {
  outcome: ExecutionOutcome;
  error?: string;
  checkpoint?: unknown;
}

/**
 * Dispatch seam. The task manager calls this; FastClaw is not wired here.
 * A later adapter implements it with FastClaw /v1 for the assigned agent.
 */
export interface NodeExecutor {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}
