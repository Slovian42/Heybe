// One chat session per installation profile, kept across window close/reopen and UI reloads
// (the turns themselves live in the task-manager SQLite, not here).
const KEY = "heybe.chat.sessionId";
const VALID = /^[A-Za-z0-9_-]{1,128}$/;

export function chatSessionId(storage: Pick<Storage, "getItem" | "setItem"> | undefined = globalThis.localStorage): string {
  try {
    const saved = storage?.getItem(KEY);
    if (saved && VALID.test(saved)) return saved;
  } catch {
    // storage blocked: fall through to a fresh id
  }
  const id = crypto.randomUUID();
  try {
    storage?.setItem(KEY, id);
  } catch {
    // not persisted: this window still works, a reload starts a new session
  }
  return id;
}
