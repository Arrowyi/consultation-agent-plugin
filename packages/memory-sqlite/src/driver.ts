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
