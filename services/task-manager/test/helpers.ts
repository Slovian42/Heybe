import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type Database from "better-sqlite3";

import { openTaskDb } from "../src/index.js";

export function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "heybe-tm-"));
  return {
    path: join(dir, "tasks.db"),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function openTemp(): { db: Database.Database; cleanup: () => void } {
  const file = tempDb();
  const db = openTaskDb(file.path);
  return {
    db,
    cleanup: () => {
      db.close();
      file.cleanup();
    },
  };
}
