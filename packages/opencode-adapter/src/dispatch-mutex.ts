import type { KeyedMutex } from "./dispatch-contract.ts"

class KeyedMutexImpl implements KeyedMutex {
  private readonly locks = new Set<string>()
  private readonly queues = new Map<string, Array<() => void>>()

  async withLock<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(key, signal)
    try {
      return await fn()
    } finally {
      this.release(key)
    }
  }

  private acquire(key: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"))
    if (!this.locks.has(key)) {
      this.locks.add(key)
      return Promise.resolve()
    }
    return new Promise<void>((resolve, reject) => {
      const queue = this.queues.get(key) ?? []
      this.queues.set(key, queue)
      const onAbort = (): void => {
        const index = queue.indexOf(node)
        if (index >= 0) queue.splice(index, 1)
        if (queue.length === 0) this.queues.delete(key)
        reject(new DOMException("aborted", "AbortError"))
      }
      const node = (): void => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }
      queue.push(node)
      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

  private release(key: string): void {
    const queue = this.queues.get(key)
    const next = queue?.shift()
    if (next) {
      next()
    } else {
      this.queues.delete(key)
      this.locks.delete(key)
    }
  }
}

export function createKeyedMutex(): KeyedMutex {
  return new KeyedMutexImpl()
}
