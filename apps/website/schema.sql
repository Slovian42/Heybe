-- D1 schema for the heybe.dev waitlist (database: heybe-waitlist, binding: DB)
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,          -- UTC, SQLite datetime('now')
  lang TEXT NOT NULL DEFAULT 'en',   -- 'en' | 'zh-Hans'
  source TEXT NOT NULL DEFAULT 'other', -- 'hero' | 'footer' | 'other'
  ip_hash TEXT                       -- salted SHA-256 of the IP (first 32 hex), for rate limiting only
);
CREATE TABLE IF NOT EXISTS waitlist_attempts (
  ip_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON waitlist_attempts (ip_hash, created_at);
