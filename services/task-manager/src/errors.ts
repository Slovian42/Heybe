import Database from "better-sqlite3";

export class TaskManagerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class IllegalStateTransitionError extends TaskManagerError {
  readonly code = "ILLEGAL_STATE_TRANSITION" as const;
  constructor(readonly from: string, readonly to: string) {
    super(`illegal state transition: ${from} -> ${to}`);
  }
}

export class StaleExecutionError extends TaskManagerError {
  readonly code = "STALE_EXECUTION" as const;
  constructor(
    message: string,
    readonly nodeId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(message);
  }
}

export class IdempotencyConflictError extends TaskManagerError {
  readonly code = "IDEMPOTENCY_CONFLICT" as const;
  constructor(readonly idempotencyKey: string) {
    super(`idempotency key already exists with a different payload: ${idempotencyKey}`);
  }
}

export class NotFoundError extends TaskManagerError {
  readonly code = "NOT_FOUND" as const;
  constructor(message: string) {
    super(message);
  }
}

export class ValidationError extends TaskManagerError {
  readonly code = "VALIDATION" as const;
  constructor(message: string) {
    super(message);
  }
}

export class ConflictError extends TaskManagerError {
  readonly code = "CONFLICT" as const;
  constructor(message: string) {
    super(message);
  }
}

export function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Database.SqliteError
    && (error.code === "SQLITE_CONSTRAINT_UNIQUE" || error.code === "SQLITE_CONSTRAINT_PRIMARYKEY");
}
