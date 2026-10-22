import type { TaskStatus } from "@heybe/shared-types";

import { IllegalStateTransitionError } from "./errors.js";

/**
 * Task and node lifecycle.
 *
 * pending          待执行
 * running          执行中
 * awaiting_review  待验收
 * completed        已完成
 * waiting_user     等待用户
 * retry_wait       重试等待
 * needs_check      需核查
 * failed           失败
 * cancelled        取消
 *
 * An executor that says "done" may only enter awaiting_review.
 * running -> completed is illegal; acceptance is a separate transition.
 */
export const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["running", "waiting_user", "cancelled"],
  running: ["awaiting_review", "waiting_user", "retry_wait", "needs_check", "failed", "cancelled"],
  awaiting_review: ["completed", "pending", "waiting_user", "failed", "needs_check"],
  waiting_user: ["pending", "running", "cancelled", "failed"],
  retry_wait: ["pending", "running", "failed", "needs_check", "cancelled"],
  needs_check: ["pending", "running", "awaiting_review", "completed", "failed", "cancelled"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  const allowed = TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

export function assertTransition(from: TaskStatus, to: TaskStatus): TaskStatus {
  if (!canTransition(from, to)) throw new IllegalStateTransitionError(from, to);
  return to;
}
