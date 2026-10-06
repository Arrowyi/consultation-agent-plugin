// Schema migrations. Several processes may open the same database at once, so
// pending migrations are checked again inside a BEGIN IMMEDIATE transaction:
// the first process applies them, the others wait on busy_timeout and then find
// nothing left to do. A failure rolls the whole transaction back (SQLite DDL is
// transactional); the db file is never replaced under a live connection. A copy
// of the db file is taken before applying, and removed again when the
// migration fails. Idempotent: already-applied versions are skipped.

import { copyFileSync, existsSync, unlinkSync } from "node:fs"
import { runInTransaction, type SqliteDatabase } from "./driver.ts"
import { SCHEMA_DDL } from "./schema.ts"

export type Migration = { readonly version: number; readonly sql: string }

export const MIGRATIONS: readonly Migration[] = [{ version: 1, sql: SCHEMA_DDL }]

export type MigrationOptions = {
  readonly dbPath: string
  readonly backupPath: string
  readonly now?: () => string
  readonly migrations?: readonly Migration[]
}

export function runMigrations(db: SqliteDatabase, options: MigrationOptions): void {
  const now = options.now ?? (() => new Date().toISOString())
  const migrations = options.migrations ?? MIGRATIONS
  db.exec("PRAGMA foreign_keys=ON")
  if (pendingMigrations(db, migrations).length === 0) return

  const dbPath = options.dbPath
  const isMemory = dbPath === ":memory:" || dbPath.length === 0
  if (!isMemory) db.exec("PRAGMA wal_checkpoint(TRUNCATE)")

  let backupTaken = false
  try {
    runInTransaction(db, () => {
      const pending = pendingMigrations(db, migrations)
      if (pending.length === 0) return
      if (!isMemory && existsSync(dbPath)) {
        copyFileSync(dbPath, options.backupPath)
        backupTaken = true
      }
      for (const migration of pending) {
        db.exec(migration.sql)
        db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, now())
      }
    })
  } catch (error) {
    if (backupTaken && existsSync(options.backupPath)) unlinkSync(options.backupPath)
    throw error
  }
}

function pendingMigrations(db: SqliteDatabase, migrations: readonly Migration[]): readonly Migration[] {
  const applied = appliedVersions(db)
  return migrations.filter((migration) => !applied.has(migration.version))
}

function appliedVersions(db: SqliteDatabase): Set<number> {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (table === null) return new Set()
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]
  return new Set(rows.map((row) => row.version))
}
