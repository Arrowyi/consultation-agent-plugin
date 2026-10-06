import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { exists } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadSqliteDriver } from "./driver.ts"
import { runMigrations } from "./migrations.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consultation-migration-"))
  directories.push(dir)
  return dir
}

describe("runMigrations", () => {
  test("creates a .backup-<timestamp> copy before applying migrations", async () => {
    // given
    const dir = await tempDir()
    const dbPath = join(dir, "memory.sqlite3")
    const Driver = await loadSqliteDriver()
    const db = new Driver(dbPath)
    db.exec("CREATE TABLE preexisting (x INTEGER)")
    db.exec("INSERT INTO preexisting VALUES (1)")
    db.close()
    const beforeContent = await readFile(dbPath)
    // when — reopen and run migrations
    const db2 = new Driver(dbPath)
    const now = "2026-08-16T12-00-00-000Z"
    const backupPath = `${dbPath}.backup-${now}`
    runMigrations(db2, { dbPath, backupPath, now: () => now })
    db2.close()
    // then — backup exists and matches the pre-migration content
    expect(await exists(backupPath)).toBe(true)
    const backupContent = await readFile(backupPath)
    expect(backupContent.equals(beforeContent)).toBe(true)
  })

  test("records the applied version in schema_migrations", async () => {
    // given
    const dir = await tempDir()
    const dbPath = join(dir, "memory.sqlite3")
    const Driver = await loadSqliteDriver()
    const db = new Driver(dbPath)
    // when
    runMigrations(db, { dbPath, backupPath: `${dbPath}.backup-init`, now: () => "2026-08-16T00-00-00-000Z" })
    // then
    const row = db.prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").get() as { version: number } | null
    expect(row?.version).toBe(1)
    db.close()
  })

  test("a failing migration leaves the connection's database unchanged and keeps no partial state", async () => {
    // given
    const dir = await tempDir()
    const dbPath = join(dir, "memory.sqlite3")
    const backupPath = `${dbPath}.backup-fail`
    const Driver = await loadSqliteDriver()
    const db = new Driver(dbPath)
    db.exec("CREATE TABLE preexisting (x INTEGER)")
    db.exec("INSERT INTO preexisting VALUES (1)")
    const failing = [{ version: 1, sql: "CREATE TABLE half_applied (x INTEGER); INSERT INTO missing_table VALUES (1);" }]
    // when
    const attempt = (): void => runMigrations(db, { dbPath, backupPath, migrations: failing })
    // then — the same connection sees neither the partial DDL nor a recorded version
    expect(attempt).toThrow()
    const partial = db.prepare("SELECT name FROM sqlite_master WHERE name = 'half_applied'").get()
    expect(partial).toBeNull()
    const preserved = db.prepare("SELECT x FROM preexisting").get() as { x: number } | null
    expect(preserved?.x).toBe(1)
    expect(await exists(backupPath)).toBe(false)
    db.close()
  })

  test("is idempotent: running twice does not re-apply or error", async () => {
    // given
    const dir = await tempDir()
    const dbPath = join(dir, "memory.sqlite3")
    const Driver = await loadSqliteDriver()
    const db = new Driver(dbPath)
    runMigrations(db, { dbPath, backupPath: `${dbPath}.backup-1`, now: () => "2026-08-16T00-00-00-000Z" })
    // when
    runMigrations(db, { dbPath, backupPath: `${dbPath}.backup-2`, now: () => "2026-08-16T00-00-01-000Z" })
    const count = db.prepare("SELECT count(*) AS c FROM schema_migrations").get() as { c: number }
    // then
    expect(count.c).toBe(1)
    db.close()
  })
})
