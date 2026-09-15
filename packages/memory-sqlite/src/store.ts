// openMemoryStore: opens the SQLite database, acquires the writer lock, runs
// migrations, and returns a MemoryStore backed by the modular commit/recall/
// manage/expand helpers. The concrete type also exposes db, reindexFts, and
// integrityCheck for the CLI and tests.

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { computePreviewToken, containsSecret, MemoryError } from "@consultation-agent/memory-core"
import type {
  CommitInput,
  CommitResult,
  ExpandInput,
  ExpandResult,
  ManageInput,
  ManageResult,
  MemoryStore,
  PrepareInput,
  PrepareResult,
  RecallQuery,
  RecallResult,
} from "@consultation-agent/memory-core"
import { loadSqliteDriver, runInTransaction, type SqliteDatabase } from "./driver.ts"
import { acquireWriterLock, type ReleaseLock } from "./writer-lock.ts"
import { resolveStoragePaths, type StoragePaths } from "./paths.ts"
import { runMigrations } from "./migrations.ts"
import { REINDEX_FTS_SQL } from "./schema.ts"
import { type EmbeddingProvider } from "./embedding.ts"
import { allText, runCommit } from "./commit.ts"
import { runRecall } from "./recall.ts"
import { runManage } from "./manage.ts"
import { runExpand } from "./expand.ts"

export type { EmbeddingProvider } from "./embedding.ts"
export { createOpenAICompatibleEmbeddingProvider } from "./embedding.ts"
export { acquireWriterLock } from "./writer-lock.ts"
export { resolveStoragePaths } from "./paths.ts"
export { runMigrations } from "./migrations.ts"

export type OpenStoreOptions = {
  readonly dataDir?: string
  readonly stateDir?: string
  readonly cacheDir?: string
  readonly dbPath?: string
  readonly embedding?: EmbeddingProvider | null
  readonly now?: () => string
}

export type OpenedMemoryStore = MemoryStore & {
  readonly db: SqliteDatabase
  readonly embedding: EmbeddingProvider | null
  reindexFts(): void
  integrityCheck(): string
}

export async function openMemoryStore(options: OpenStoreOptions = {}): Promise<OpenedMemoryStore> {
  const defaults = resolveStoragePaths()
  const paths: StoragePaths = {
    dataDir: options.dataDir ?? defaults.dataDir,
    stateDir: options.stateDir ?? defaults.stateDir,
    cacheDir: options.cacheDir ?? defaults.cacheDir,
  }
  for (const path of Object.values(paths)) mkdirSync(path, { recursive: true })
  const release = acquireWriterLock(paths.stateDir)
  const dbPath = options.dbPath ?? join(paths.dataDir, "memory.sqlite3")
  const Driver = await loadSqliteDriver()
  let db: SqliteDatabase
  try {
    db = new Driver(dbPath)
    const backupPath = `${dbPath}.backup-${new Date().toISOString().replace(/[:.]/g, "-")}`
    runMigrations(db, { dbPath, backupPath })
  } catch (error) {
    release()
    throw error
  }
  const embedding = options.embedding ?? null
  const clock = options.now ?? (() => new Date().toISOString())
  return new SqliteMemoryStore(db, release, embedding, clock)
}

class SqliteMemoryStore implements OpenedMemoryStore {
  #closed = false

  constructor(
    readonly db: SqliteDatabase,
    private readonly release: ReleaseLock,
    readonly embedding: EmbeddingProvider | null,
    private readonly clock: () => string,
  ) {}

  async prepare(input: PrepareInput): Promise<PrepareResult> {
    this.assertOpen()
    const warnings: string[] = []
    for (const text of allText(input)) {
      if (containsSecret(text)) {
        warnings.push("SECRET_DETECTED")
        break
      }
    }
    return {
      previewToken: computePreviewToken(input),
      warnings,
      preview: {
        title: input.title,
        itemCount: input.items.length,
        items: input.items.map((item) => ({
          topicKey: item.topicKey,
          title: item.title,
          oneLineSummary: item.oneLineSummary,
          claims: item.claims?.length ?? 0,
          evidence: item.evidence?.length ?? 0,
          hasDecision: item.decision !== undefined,
          sensitiveFields: item.sensitiveFields ?? [],
          taxonomyNodeIds: item.taxonomyNodeIds ?? [],
        })),
        preferences: (input.preferences ?? []).map((preference) => ({
          key: preference.key,
          value: preference.value,
          sensitive: preference.sensitive,
          confirmed: preference.confirmed ?? false,
        })),
      },
    }
  }

  async commit(input: CommitInput): Promise<CommitResult> {
    this.assertOpen()
    return runCommit(this.db, input, this.embedding, this.clock)
  }

  async recall(query: RecallQuery): Promise<RecallResult> {
    this.assertOpen()
    return runRecall(this.db, query, this.embedding)
  }

  async expand(input: ExpandInput): Promise<ExpandResult> {
    this.assertOpen()
    return runExpand(this.db, input)
  }

  async manage(input: ManageInput): Promise<ManageResult> {
    this.assertOpen()
    return runManage(this.db, input)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    this.db.close()
    this.release()
  }

  reindexFts(): void {
    this.assertOpen()
    runInTransaction(this.db, () => this.db.exec(REINDEX_FTS_SQL))
  }

  integrityCheck(): string {
    this.assertOpen()
    const row = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check: string } | null
    return row === null ? "unknown" : String(row.integrity_check)
  }

  private assertOpen(): void {
    if (this.#closed) throw new MemoryError("STORE_CLOSED", "store is closed")
  }
}
