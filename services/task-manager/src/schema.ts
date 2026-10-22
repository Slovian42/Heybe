// DRAFT schema for the local task manager's own SQLite DB (separate from FastClaw's DB).
// Never write credentials into any table.
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  deliverables_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  budget_json TEXT NOT NULL DEFAULT '{}',
  authorization_scope_json TEXT NOT NULL DEFAULT '[]',
  routine_run_id TEXT UNIQUE,            -- one task per routine occurrence
  source_event_key TEXT UNIQUE,          -- channel dedupe
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  assigned_agent_id TEXT,
  required_capabilities_json TEXT NOT NULL DEFAULT '[]',
  fallback_agent_ids_json TEXT NOT NULL DEFAULT '[]',
  acceptance_criteria TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  execution_version INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_expires_at TEXT,
  timeout_sec INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id),
  agent_id TEXT NOT NULL,
  execution_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  checkpoint_json TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  invalidated INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_id TEXT,
  attempt_id TEXT,
  type TEXT NOT NULL,
  data_json TEXT,
  at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_id TEXT,
  attempt_id TEXT,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  official INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_id TEXT,
  action_kind TEXT NOT NULL,             -- send / publish / pay / delete ...
  recipient TEXT,
  content_digest TEXT NOT NULL,          -- content changes => re-approve
  status TEXT NOT NULL,                  -- pending / approved / rejected / expired / consumed
  expires_at TEXT NOT NULL,
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_jobs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  node_id TEXT,
  provider TEXT NOT NULL,
  remote_job_id TEXT,
  status TEXT NOT NULL,
  last_checked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  approval_id TEXT REFERENCES approvals(id),
  intent_json TEXT NOT NULL,             -- recorded BEFORE executing
  idempotency_key TEXT UNIQUE,
  status TEXT NOT NULL,                  -- intended / executing / done / unknown_needs_check
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  task_id TEXT REFERENCES tasks(id),
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  dedupe_key TEXT UNIQUE,
  status TEXT NOT NULL,                  -- pending / sending / sent / failed
  receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Long-term shared memory (Community must ship). SQLite + FTS5, no vector DB.
CREATE TABLE IF NOT EXISTS memory_facts (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  writer_agent_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user','project','team')),
  scope_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('candidate','confirmed','deleted')),
  user_set INTEGER NOT NULL DEFAULT 0,   -- explicit user preference beats agent inference
  version INTEGER NOT NULL DEFAULT 1,
  supersedes_id TEXT REFERENCES memory_facts(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_facts_fts USING fts5(content, content='memory_facts', content_rowid='rowid');

CREATE TABLE IF NOT EXISTS memory_access (
  agent_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT,
  can_write INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, scope_kind, scope_id)
);
`;
