import type { Budget, TaskStatus } from "@heybe/shared-types";
import {
  isTaskStatus,
  type AttemptRecord,
  type NodeRecord,
  type TaskEventRecord,
  type TaskRecord,
} from "@heybe/shared-types/task-manager";

export interface TaskRow {
  id: string;
  goal: string;
  deliverables_json: string;
  status: string;
  budget_json: string;
  authorization_scope_json: string;
  routine_run_id: string | null;
  source_event_key: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
}

export interface NodeRow {
  id: string;
  task_id: string;
  depends_on_json: string;
  assigned_agent_id: string | null;
  required_capabilities_json: string;
  fallback_agent_ids_json: string;
  acceptance_criteria: string;
  status: string;
  execution_version: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  timeout_sec: number | null;
  created_at: string;
  updated_at: string;
  attempt_count: number;
}

export interface AttemptRow {
  id: string;
  node_id: string;
  agent_id: string;
  execution_version: number;
  status: string;
  checkpoint_json: string | null;
  error: string | null;
  started_at: string;
  ended_at: string | null;
  invalidated: number;
}

export interface EventRow {
  id: number | bigint;
  task_id: string;
  node_id: string | null;
  attempt_id: string | null;
  type: string;
  data_json: string | null;
  at: string;
}

export function parseStringArray(raw: string): string[] {
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return [];
  return value;
}

export function parseBudget(raw: string): Budget {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Budget;
}

export function parseStatus(raw: string): TaskStatus {
  if (!isTaskStatus(raw)) throw new Error(`unknown status in database: ${raw}`);
  return raw;
}

export function parseObject(raw: string | null): Record<string, unknown> | null {
  if (raw == null) return null;
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  return JSON.parse(raw) as unknown;
}

export function asId(value: number | bigint): number {
  return typeof value === "bigint" ? Number(value) : value;
}

export function mapTask(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    goal: row.goal,
    deliverables: parseStringArray(row.deliverables_json),
    status: parseStatus(row.status),
    budget: parseBudget(row.budget_json),
    authorizationScope: parseStringArray(row.authorization_scope_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    idempotencyKey: row.idempotency_key,
    routineRunId: row.routine_run_id,
    sourceEventKey: row.source_event_key,
  };
}

export function mapNode(row: NodeRow): NodeRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    dependsOn: parseStringArray(row.depends_on_json),
    assignedAgentId: row.assigned_agent_id,
    requiredCapabilities: parseStringArray(row.required_capabilities_json),
    fallbackAgentIds: parseStringArray(row.fallback_agent_ids_json),
    acceptanceCriteria: row.acceptance_criteria,
    status: parseStatus(row.status),
    executionVersion: row.execution_version,
    attemptCount: row.attempt_count,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    timeoutSec: row.timeout_sec,
  };
}

export function mapAttempt(row: AttemptRow): AttemptRecord {
  const status = row.status;
  return {
    id: row.id,
    nodeId: row.node_id,
    agentId: row.agent_id,
    executionVersion: row.execution_version,
    status: status as AttemptRecord["status"],
    checkpoint: parseJson(row.checkpoint_json),
    error: row.error,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    invalidated: row.invalidated !== 0,
  };
}

export function mapEvent(row: EventRow): TaskEventRecord {
  return {
    id: asId(row.id),
    taskId: row.task_id,
    nodeId: row.node_id,
    attemptId: row.attempt_id,
    type: row.type,
    data: parseObject(row.data_json),
    at: row.at,
  };
}
