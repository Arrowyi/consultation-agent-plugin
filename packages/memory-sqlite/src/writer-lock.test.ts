import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MemoryError } from "@consultation-agent/memory-core"
import { acquireWriterLock } from "./writer-lock.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "consultation-lock-"))
  directories.push(dir)
  return dir
}

describe("acquireWriterLock", () => {
  test("second opener on the same stateDir fails with WRITER_LOCKED naming the holder pid", async () => {
    // given
    const dir = await tempDir()
    const first = acquireWriterLock(dir)
    // when
    const secondAttempt = (): void => { acquireWriterLock(dir) }
    // then
    expect(secondAttempt).toThrow(MemoryError)
    expect(secondAttempt).toThrow("WRITER_LOCKED")
    expect(secondAttempt).toThrow(String(process.pid))
    first()
  })

  test("lock is released by the returned close function and a new opener succeeds", async () => {
    // given
    const dir = await tempDir()
    const release = acquireWriterLock(dir)
    release()
    // when
    const second = acquireWriterLock(dir)
    // then — does not throw
    expect(typeof second).toBe("function")
    second()
  })

  test("a stale lockfile whose pid is dead is reclaimed", async () => {
    // given
    const dir = await tempDir()
    const lockPath = join(dir, "memory.writer.lock")
    await writeFile(lockPath, JSON.stringify({ pid: 999999, hostname: "dead", at: "2026-08-16T00:00:00Z" }))
    // when — pid 999999 is not alive, so the lock is stale
    const release = acquireWriterLock(dir)
    // then — does not throw
    expect(typeof release).toBe("function")
    release()
  })
})
