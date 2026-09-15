// Schema migrations: copy the db file to a backup BEFORE applying any pending
// migration, record each applied version in schema_migrations, and on failure
// restore the backup and rethrow. Idempotent: already-applied versions are skipped.

import { copyFileSync, existsSync, renameSync, unlinkSync } from "node:fs"
import type { SqliteDatabase } from "./driver.ts"
import { SCHEMA_DDL } from "./schema.ts"

export type Migration = { readonly version: number; readonly sql: string }

export const MIGRATIONS: readonly Migration[] = [{ version: 1, sql: SCHEMA_DDL }]

export type MigrationOptions = {
  readonly dbPath: string
  readonly backupPath: string
  readonly now?: () => string
}

export function runMigrations(db: SqliteDatabase, options: MigrationOptions): void {
  const now = options.now ?? (() => new Date().toISOString())
  db.exec("PRAGMA foreign_keys=ON")
  const applied = appliedVersions(db)
  const pending = MIGRATIONS.filter((migration) => !applied.has(migration.version))
  if (pending.length === 0) return

  const dbPath = options.dbPath
  const isMemory = dbPath === ":memory:" || dbPath.length === 0
  if (!isMemory && existsSync(dbPath)) {
    copyFileSync(dbPath, options.backupPath)
  }

  try {
    for (const migration of pending) {
      db.exec(migration.sql)
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)").run(migration.version, now())
    }
  } catch (error) {
    if (!isMemory && existsSync(options.backupPath)) {
      if (existsSync(dbPath)) unlinkSync(dbPath)
      renameSync(options.backupPath, dbPath)
    }
    throw error
  }
}

function appliedVersions(db: SqliteDatabase): Set<number> {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get()
  if (table === null) return new Set()
  const rows = db.prepare("SELECT version FROM schema_migrations").all() as { version: number }[]
  return new Set(rows.map((row) => row.version))
}
