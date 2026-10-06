import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openMemoryStore } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consultation-multi-"))
  directories.push(dir)
  return dir
}

function pragma(db: { prepare(sql: string): { get(): Record<string, unknown> | null } }, name: string): unknown {
  const row = db.prepare(`PRAGMA ${name}`).get()
  return row === null ? null : Object.values(row)[0]
}

describe("multi-instance access", () => {
  test("a second store can open the same directories while the first is still open", async () => {
    // given
    const dir = await tempDir()
    const options = { dataDir: dir, stateDir: dir, cacheDir: dir }
    const first = await openMemoryStore(options)
    // when
    const second = await openMemoryStore(options)
    const input = {
      namespace: "multi",
      hostSessionId: "host",
      title: "Session",
      now: "2026-08-16T00:00:00.000Z",
      items: [{ topicKey: "tea", title: "Tea", oneLineSummary: "Tea is calming" }],
    }
    const preview = await first.prepare(input)
    await first.commit({ ...input, previewToken: preview.previewToken })
    const recalled = await second.recall({ namespace: "multi", text: "tea", tier: "standard" })
    // then
    expect(recalled.candidates.map((candidate) => candidate.title)).toEqual(["Tea"])
    await first.close()
    await second.close()
  })

  test("every opened connection waits on contention instead of failing, uses WAL, and enforces foreign keys", async () => {
    // given
    const dir = await tempDir()
    const options = { dataDir: dir, stateDir: dir, cacheDir: dir }
    const first = await openMemoryStore(options)
    // when — the second open skips migrations because the first already applied them
    const second = await openMemoryStore(options)
    // then
    for (const store of [first, second]) {
      expect(pragma(store.db, "busy_timeout")).toBe(5000)
      expect(pragma(store.db, "journal_mode")).toBe("wal")
      expect(pragma(store.db, "foreign_keys")).toBe(1)
    }
    await first.close()
    await second.close()
  })

  test("many processes opening and committing at the same instant all succeed with consistent data", async () => {
    const workerPath = join(import.meta.dir, "concurrency-worker.ts")
    const workers = 6
    for (let round = 0; round < 3; round++) {
      // given — a fresh directory, so every worker races the first-time migration too
      const dir = await tempDir()
      const children = Array.from({ length: workers }, (_, index) =>
        Bun.spawn([process.execPath, workerPath], {
          env: { ...process.env, WORKER_DIR: dir, WORKER_ID: String(index) },
          stdout: "pipe",
          stderr: "pipe",
        }),
      )
      // when — release the start gate for all of them at once
      await writeFile(join(dir, "go"), "")
      const results = await Promise.all(
        children.map(async (child) => ({
          code: await child.exited,
          stdout: await new Response(child.stdout).text(),
          stderr: await new Response(child.stderr).text(),
        })),
      )
      // then
      for (const result of results) {
        expect({ code: result.code, stderr: result.stderr }).toEqual({ code: 0, stderr: "" })
      }
      const verify = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir })
      const stats = await verify.manage({ action: "stats", namespace: "concurrency" })
      if (stats.action !== "stats") throw new Error("expected stats result")
      expect(stats.sessions).toBe(workers + 1)
      expect(stats.items).toBe(workers + 1)
      expect(verify.integrityCheck()).toBe("ok")
      expect(verify.db.prepare("PRAGMA foreign_key_check").all()).toEqual([])
      await verify.close()
    }
  }, 60_000)
})
