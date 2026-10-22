// Shared domain types for Community (and consumed read-only by Pro).
// Community MUST NOT import anything from Pro.

export type TaskStatus =
  | "pending" | "running" | "awaiting_review" | "completed"
  | "waiting_user" | "retry_wait" | "needs_check" | "failed" | "cancelled";

export type NodeStatus = TaskStatus;

export interface Budget {
  maxDurationSec?: number;
  maxModelRounds?: number;
  maxReworks?: number;
  maxGenerations?: number;
  maxParallel?: number;
  /** true when no verifiable hard limit exists and the number is only an estimate */
  estimated?: boolean;
}

export interface Task {
  id: string;
  goal: string;
  deliverables: string[];
  status: TaskStatus;
  budget: Budget;
  authorizationScope: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskNode {
  id: string;
  taskId: string;
  dependsOn: string[];
  assignedAgentId: string;
  requiredCapabilities: string[];
  fallbackAgentIds: string[];
  acceptanceCriteria: string;
  status: NodeStatus;
  executionVersion: number;
  attemptCount: number;
}

export interface ArtifactRef {
  id: string;
  taskId: string;
  nodeId?: string;
  attemptId?: string;
  path: string;
  sha256: string;
  version: number;
  official: boolean;
}

export type MemoryScope =
  | { kind: "user" }
  | { kind: "project"; projectId: string }
  | { kind: "team"; teamId: string };

export interface SharedMemoryFact {
  id: string;
  content: string;
  source: string;
  writerAgentId: string;
  scope: MemoryScope;
  /** candidate = inferred, awaiting confirmation; confirmed = long-term */
  state: "candidate" | "confirmed" | "deleted";
  version: number;
  supersedesId?: string;
  createdAt: string;
  updatedAt: string;
}

export * from "./pro-interface.js";
export * from "./fastclaw.js";
