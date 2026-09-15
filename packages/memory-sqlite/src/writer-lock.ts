// Single-writer lock: an O_EXCL lockfile at <stateDir>/memory.writer.lock.
// If the file exists and the holding pid is alive, throw WRITER_LOCKED naming
// the pid. If the pid is dead, reclaim the stale lock. The returned function
// releases the lock.

import { existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { hostname } from "node:os"
import { join } from "node:path"
import { MemoryError } from "@consultation-agent/memory-core"

export type ReleaseLock = () => void

type LockContent = { readonly pid: number; readonly hostname: string; readonly at: string }

export function acquireWriterLock(stateDir: string): ReleaseLock {
  const path = join(stateDir, "memory.writer.lock")
  try {
    const fd = openSync(path, "wx")
    const content: LockContent = { pid: process.pid, hostname: hostname(), at: new Date().toISOString() }
    writeFileSync(fd, JSON.stringify(content))
    return () => {
      if (existsSync(path)) unlinkSync(path)
    }
  } catch (error) {
    if (!isEexist(error) || !existsSync(path)) throw error
    const holder = readHolder(path)
    if (holder !== null && isPidAlive(holder.pid)) {
      throw new MemoryError("WRITER_LOCKED", `writer lock held by pid ${holder.pid} on ${holder.hostname} since ${holder.at}`)
    }
    // Stale lock: reclaim it.
    unlinkSync(path)
    const fd = openSync(path, "wx")
    const content: LockContent = { pid: process.pid, hostname: hostname(), at: new Date().toISOString() }
    writeFileSync(fd, JSON.stringify(content))
    return () => {
      if (existsSync(path)) unlinkSync(path)
    }
  }
}

function readHolder(path: string): LockContent | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown
    if (typeof parsed === "object" && parsed !== null && "pid" in parsed && typeof (parsed as { pid: unknown }).pid === "number") {
      return parsed as LockContent
    }
    return null
  } catch {
    return null
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error !== null && typeof error === "object" && "code" in error && (error as { code: string }).code === "EPERM"
  }
}

function isEexist(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && (error as { code: string }).code === "EEXIST"
}
