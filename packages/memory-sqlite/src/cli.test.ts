import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openMemoryStore } from "./index.ts"
import { runCli } from "./cli.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consultation-cli-"))
  directories.push(dir)
  return dir
}

function envFor(dir: string): NodeJS.ProcessEnv {
  return { CONSULTATION_DATA_DIR: dir, CONSULTATION_STATE_DIR: dir, CONSULTATION_CACHE_DIR: dir }
}

async function seed(dir: string): Promise<void> {
  const store = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir, embedding: null })
  const preview = await store.prepare({
    namespace: "cli",
    hostSessionId: "host",
    title: "CLI Session",
    now: "2026-08-16T00:00:00.000Z",
    items: [
      {
        topicKey: "tea",
        title: "Tea",
        oneLineSummary: "Tea is calming",
        applicability: {},
        claims: [{ claimType: "verifiable_fact", text: "Tea has caffeine." }],
        decision: { conclusion: "choose tea", confidence: "medium", stability: "conditional" },
      },
    ],
  })
  await store.commit({
    namespace: "cli",
    hostSessionId: "host",
    title: "CLI Session",
    now: "2026-08-16T00:00:00.000Z",
    items: [
      {
        topicKey: "tea",
        title: "Tea",
        oneLineSummary: "Tea is calming",
        applicability: {},
        claims: [{ claimType: "verifiable_fact", text: "Tea has caffeine." }],
        decision: { conclusion: "choose tea", confidence: "medium", stability: "conditional" },
      },
    ],
    previewToken: preview.previewToken,
  })
  await store.close()
}

async function captureStdout(fn: () => Promise<number>): Promise<{ code: number; out: string }> {
  const chunks: string[] = []
  const original = process.stdout.write.bind(process.stdout)
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  try {
    const code = await fn()
    return { code, out: chunks.join("") }
  } finally {
    process.stdout.write = original
  }
}

async function itemIdFor(dir: string, topicKey: string): Promise<string> {
  const store = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir, embedding: null })
  const row = store.db.prepare("SELECT id FROM experience_items WHERE topic_key = ?").get(topicKey) as { id: string } | null
  await store.close()
  if (row === null) throw new Error(`no item ${topicKey}`)
  return row.id
}

describe("consultation-memory CLI", () => {
  test("check runs integrity_check and exits 0", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    // when
    const code = await runCli(["check"], envFor(dir))
    // then
    expect(code).toBe(0)
  })

  test("reindex rebuilds FTS from canonical tables and recall still works", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    // when
    const code = await runCli(["reindex"], envFor(dir))
    const store = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir, embedding: null })
    const recalled = await store.recall({ namespace: "cli", text: "tea", tier: "standard" })
    await store.close()
    // then
    expect(code).toBe(0)
    expect(recalled.candidates).toHaveLength(1)
  })

  test("export writes MemoryExport JSON and import round-trips idempotently", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    const outFile = join(dir, "export.json")
    // when
    const exportCode = await runCli(["export", "--out", outFile], envFor(dir))
    const exported = JSON.parse(await readFile(outFile, "utf8")) as { formatVersion: number; items: unknown[] }
    const importCode = await runCli(["import", "--in", outFile], envFor(dir))
    // then
    expect(exportCode).toBe(0)
    expect(exported.formatVersion).toBe(1)
    expect(exported.items).toHaveLength(1)
    expect(importCode).toBe(0)
  })

  test("migrate creates a backup file before applying", async () => {
    // given
    const dir = await tempDir()
    // when
    const code = await runCli(["migrate"], envFor(dir))
    const backups = (await import("node:fs/promises")).readdir(dir)
    const names = (await backups).filter((n) => n.includes(".backup-"))
    // then
    expect(code).toBe(0)
    expect(names.length).toBeGreaterThanOrEqual(1)
  })
})

describe("consultation-memory CLI — browse", () => {
  test("list shows consultations with question and conclusion", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    // when
    const { code, out } = await captureStdout(() => runCli(["list"], envFor(dir)))
    // then
    expect(code).toBe(0)
    expect(out).toContain("Tea")
    expect(out).toContain("choose tea")
  })

  test("show prints the full consultation record", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    const id = await itemIdFor(dir, "tea")
    // when
    const { code, out } = await captureStdout(() => runCli(["show", id], envFor(dir)))
    // then
    expect(code).toBe(0)
    expect(out).toContain("问题: Tea")
    expect(out).toContain("结论: choose tea")
    expect(out).toContain("Tea has caffeine.")
  })

  test("search finds a consultation by keyword", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    // when
    const { code, out } = await captureStdout(() => runCli(["search", "tea"], envFor(dir)))
    // then
    expect(code).toBe(0)
    expect(out).toContain("Tea")
  })

  test("search with no match reports it", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    // when
    const { code, out } = await captureStdout(() => runCli(["search", "zzz-nomatch"], envFor(dir)))
    // then
    expect(code).toBe(0)
    expect(out).toContain("no consultations matching")
  })

  test("delete retires a consultation and list no longer shows it", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    const id = await itemIdFor(dir, "tea")
    // when
    const delCode = await runCli(["delete", id], envFor(dir))
    const { out } = await captureStdout(() => runCli(["list"], envFor(dir)))
    // then
    expect(delCode).toBe(0)
    expect(out).not.toContain("Tea —")
    expect(out).toContain("no consultations found")
  })

  test("forget erases a consultation from the store", async () => {
    // given
    const dir = await tempDir()
    await seed(dir)
    const id = await itemIdFor(dir, "tea")
    // when
    const code = await runCli(["forget", id], envFor(dir))
    const store = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir, embedding: null })
    const row = store.db.prepare("SELECT id FROM experience_items WHERE id = ?").get(id)
    await store.close()
    // then
    expect(code).toBe(0)
    expect(row).toBeNull()
  })
})
