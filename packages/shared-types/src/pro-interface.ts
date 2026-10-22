// Versioned interface between the Community task manager and optional closed Pro modules.
// Pro implements/consumes these; Community only defines them and never imports Pro.
// Bump PRO_INTERFACE_VERSION (semver) on any change; Pro contracts must match.

import type { ArtifactRef, Budget, TaskStatus } from "./index.js";

export const PRO_INTERFACE_VERSION = "0.1.0" as const;

/** Decision advice from a Pro decision source (e.g. Jev) — advisory only. */
export interface DecisionAdvice {
  interfaceVersion: typeof PRO_INTERFACE_VERSION;
  taskId: string;
  nodeId?: string;
  question: "collaborate" | "reuse_or_create" | "select_candidate" | "next_step";
  answer: boolean | string | { candidateId: string; score: number }[];
  source: "jev" | "rules" | "llm";
  confidence?: number;
  /** set when the Pro source failed and the advice comes from fallback */
  fallbackReason?: string;
}

/** Request to create a restricted (task-scoped) member. Validated & executed by the task manager only. */
export interface RestrictedMemberCreateRequest {
  interfaceVersion: typeof PRO_INTERFACE_VERSION;
  dedupeKey: string; // task/node scoped idempotency key
  taskId: string;
  nodeId?: string;
  templateId: string;
  modelConfigRef: string;
  allowedTools: string[];
  memoryScopes: string[];
  budget: Budget;
  expiresAt: string;
}

export interface RunEvent {
  interfaceVersion: typeof PRO_INTERFACE_VERSION;
  eventId: string;
  taskId: string;
  nodeId?: string;
  type: "task_status" | "node_status" | "artifact" | "approval" | "member_lifecycle" | "error";
  status?: TaskStatus;
  at: string;
  data?: Record<string, unknown>;
}

export interface ProArtifactRef extends ArtifactRef {
  interfaceVersion: typeof PRO_INTERFACE_VERSION;
}

/** The only surface Community exposes to an optionally loaded Pro module. */
export interface ProModuleHost {
  interfaceVersion: typeof PRO_INTERFACE_VERSION;
  submitAdvice(advice: DecisionAdvice): Promise<void>;
  requestMember(req: RestrictedMemberCreateRequest): Promise<{ accepted: boolean; reason?: string; memberId?: string }>;
  onEvent(listener: (e: RunEvent) => void): () => void;
}
