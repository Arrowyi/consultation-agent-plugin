// Runtime-detected SQLite driver: prefers bun:sqlite, falls back to node:sqlite.
// Both are behind a local structural interface; the cast through unknown is the
// one place this codebase is allowed to paper over a missing shared type.

export interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[]
  get(...params: unknown[]): Record<string, unknown> | null
  run(...params: unknown[]): { lastInsertRowid: number | bigint; changes: number }
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement
  exec(sql: string): void
  close(): void
}

export type SqliteDatabaseConstructor = new (path: string) => SqliteDatabase

export async function loadSqliteDriver(): Promise<SqliteDatabaseConstructor> {
  if (typeof process !== "undefined" && typeof process.versions === "object" && process.versions !== null && "bun" in process.versions) {
    const mod = (await import("bun:sqlite")) as { Database: unknown }
    return mod.Database as unknown as SqliteDatabaseConstructor
  }
  const mod = (await import("node:sqlite")) as { DatabaseSync: unknown }
  return mod.DatabaseSync as unknown as SqliteDatabaseConstructor
}

export const BUSY_TIMEOUT_MS = 5000

// Per-connection settings for safe multi-process access: contended locks wait
// instead of failing, WAL lets readers run beside a writer, and foreign keys
// are enforced. busy_timeout and foreign_keys are per connection, so this must
// run on every open, not only when a migration happens to apply.
export function configureConnection(db: SqliteDatabase): void {
  db.exec(`PRAGMA busy_timeout=${BUSY_TIMEOUT_MS}`)
  enableWal(db)
  db.exec("PRAGMA synchronous=NORMAL")
  db.exec("PRAGMA foreign_keys=ON")
}

// Switching a database into WAL needs an exclusive lock and SQLite returns
// SQLITE_BUSY for it without consulting busy_timeout, so processes racing to
// open a brand-new database must retry. Once the database is WAL (the mode is
// persistent) the read below short-circuits and no lock is needed.
function enableWal(db: SqliteDatabase): void {
  const deadline = Date.now() + BUSY_TIMEOUT_MS
  for (;;) {
    try {
      const current = db.prepare("PRAGMA journal_mode").get()
      if (current !== null && Object.values(current)[0] === "wal") return
      db.exec("PRAGMA journal_mode=WAL")
      return
    } catch (error) {
      if (!isBusyError(error) || Date.now() >= deadline) throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5)
    }
  }
}

function isBusyError(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false
  const { code, message } = error as { code?: unknown; message?: unknown }
  return (typeof code === "string" && code.startsWith("SQLITE_BUSY")) || (typeof message === "string" && message.includes("database is locked"))
}

// Portable transaction helper: BEGIN/COMMIT/ROLLBACK work on both drivers
// (bun:sqlite also ships db.transaction, but node:sqlite does not).
export function runInTransaction<T>(db: SqliteDatabase, work: () => T): T {
  db.exec("BEGIN IMMEDIATE")
  try {
    const result = work()
    db.exec("COMMIT")
    return result
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }
}
