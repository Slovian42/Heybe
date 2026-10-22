import type Database from "better-sqlite3";
import type {
  ExecutionRequest,
  ExecutionResult,
  NodeExecutor,
  NodeRecord,
} from "@heybe/shared-types/task-manager";

import { applyExecutionResult, claimNextNode, type ClaimOptions } from "./claim.js";
import { IllegalStateTransitionError, StaleExecutionError } from "./errors.js";

export type DispatchOnceResult =
  | { claimed: false }
  | { claimed: true; request: ExecutionRequest; result: ExecutionResult; node: NodeRecord };

/**
 * In-process dispatcher. FastClaw is intentionally not called.
 * Pass a NodeExecutor; MockExecutor is the stand-in until the adapter is wired.
 */
export async function dispatchOnce(
  db: Database.Database,
  executor: NodeExecutor,
  opts: ClaimOptions,
): Promise<DispatchOnceResult> {
  const claimed = claimNextNode(db, opts);
  if (!claimed) return { claimed: false };
  const request: ExecutionRequest = {
    taskId: claimed.task.id,
    nodeId: claimed.node.id,
    attemptId: claimed.attempt.id,
    agentId: claimed.node.assignedAgentId,
    executionVersion: claimed.node.executionVersion,
    goal: claimed.task.goal,
    acceptanceCriteria: claimed.node.acceptanceCriteria,
  };
  try {
    const result = await executor.execute(request);
    const node = applyExecutionResult(db, {
      nodeId: claimed.node.id,
      executionVersion: claimed.node.executionVersion,
      outcome: result.outcome,
      error: result.error,
      checkpoint: result.checkpoint,
      owner: opts.owner,
      now: opts.now,
    });
    return { claimed: true, request, result, node };
  } catch (error) {
    if (error instanceof StaleExecutionError || error instanceof IllegalStateTransitionError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const node = applyExecutionResult(db, {
      nodeId: claimed.node.id,
      executionVersion: claimed.node.executionVersion,
      outcome: "failed",
      error: message,
      owner: opts.owner,
      now: opts.now,
    });
    return { claimed: true, request, result: { outcome: "failed", error: message }, node };
  }
}

export class MockExecutor implements NodeExecutor {
  readonly requests: ExecutionRequest[] = [];

  constructor(
    private readonly handler: (request: ExecutionRequest) => ExecutionResult | Promise<ExecutionResult> = () => ({
      outcome: "awaiting_review",
    }),
  ) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    this.requests.push(request);
    return this.handler(request);
  }
}
