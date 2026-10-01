import { serializeOutcome, type Clock, type DispatchOutcome, type DispatchSdk, type KeyedMutex } from "./dispatch-contract.ts"
import { makeEnvelope, observationToOutcome } from "./dispatch-helpers.ts"
import { appendRecord, loadJob, type LoadedJob } from "./dispatch-journal.ts"
import { observeDispatch, type ObservationOutcome } from "./dispatch-observer.ts"

export interface CancelInput {
  readonly jobID: string
  readonly parentID: string
  readonly directory: string
  readonly signal?: AbortSignal
}

export interface CreateDispatchCancelInput {
  readonly sdk: DispatchSdk
  readonly clock?: Clock
  readonly mutex: KeyedMutex
}

export interface ActiveAttempt {
  readonly index: number
  readonly model: string | null
  readonly sessionID: string
  readonly requestMessageID: string
}

export function findActiveAttempt(loaded: LoadedJob): ActiveAttempt | undefined {
  const reservationByIndex = new Map(loaded.reservations.map((r) => [r.attempt_index, r]))
  const receiptsByIndex = new Map<number, typeof loaded.receipts>()
  for (const receipt of loaded.receipts) {
    const list = receiptsByIndex.get(receipt.attempt_index) ?? []
    list.push(receipt)
    receiptsByIndex.set(receipt.attempt_index, list)
  }
  let activeIndex = -1
  let activeReceipt: (typeof loaded.receipts)[number] | undefined
  for (const [index, list] of receiptsByIndex) {
    const first = list[0]
    if (list.some((r) => r.session_id !== first?.session_id || r.message_id !== first?.message_id)) return undefined
    if (index > activeIndex) {
      activeIndex = index
      activeReceipt = first
    }
  }
  if (activeReceipt === undefined) return undefined
  if (loaded.reservations.some((reservation) => reservation.attempt_index > activeIndex && !receiptsByIndex.has(reservation.attempt_index))) return undefined
  const reservation = reservationByIndex.get(activeReceipt.attempt_index)
  if (reservation === undefined) return undefined
  return { index: activeReceipt.attempt_index, model: reservation.model, sessionID: activeReceipt.session_id, requestMessageID: activeReceipt.message_id }
}

export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    sleep: (ms, signal) => new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new DOMException("aborted", "AbortError")); return }
      const onAbort = () => {
        clearTimeout(timer)
        reject(new DOMException("aborted", "AbortError"))
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }, ms)
      signal?.addEventListener("abort", onAbort, { once: true })
    }),
  }
}

export interface CancelReconciliation {
  readonly sdk: DispatchSdk
  readonly clock: Clock
  readonly loaded: LoadedJob
  readonly active: ActiveAttempt
}

function snapshot(input: CancelReconciliation): Promise<ObservationOutcome> {
  return observeDispatch({ sdk: input.sdk, clock: input.clock, jobID: input.loaded.jobID,
    childSessionID: input.active.sessionID, requestMessageID: input.active.requestMessageID,
    directory: input.loaded.spec.directory, waitBudgetMs: 0 })
}

// Caller holds the job mutex and has durably persisted cancel intent.
export async function abortAndReconcile(input: CancelReconciliation): Promise<DispatchOutcome> {
  const { sdk, loaded, active, clock } = input
  const start = clock.now()
  const before = await snapshot(input)
  switch (before.kind) {
    case "completed":
    case "cancelled":
      return observationToOutcome(before, loaded.jobID, loaded.spec.role, active, clock.now() - start)
    case "failed":
    case "unknown":
      return makeEnvelope("cancelling", loaded.jobID, loaded.spec.role, active, active.sessionID, clock.now() - start, "cancel intent retained; no confirmed active execution")
    case "pending":
      break
    default: {
      const exhaustive: never = before
      return exhaustive
    }
  }
  const response = await sdk.session.abort({ path: { id: active.sessionID }, query: { directory: loaded.spec.directory } })
    .catch((error: unknown) => ({ error }))
  const after = await snapshot(input)
  switch (after.kind) {
    case "completed":
    case "cancelled":
      return observationToOutcome(after, loaded.jobID, loaded.spec.role, active, clock.now() - start)
    case "failed":
    case "unknown":
    case "pending":
      return makeEnvelope("cancelling", loaded.jobID, loaded.spec.role, active, active.sessionID, clock.now() - start,
        response.error === undefined ? "cancel requested; awaiting terminal evidence" : "cancel transport failed; intent retained for retry")
    default: {
      const exhaustive: never = after
      return exhaustive
    }
  }
}

export function createDispatchCancel(input: CreateDispatchCancelInput): { readonly cancel: (request: CancelInput) => Promise<string> } {
  const clock = input.clock ?? createSystemClock()
  const unavailable = () => serializeOutcome({ kind: "failure", reason: "consultation dispatch unavailable" })
  async function cancel(request: CancelInput): Promise<string> {
    return input.mutex.withLock(request.jobID, async () => {
      const result = await loadJob(input.sdk, { jobID: request.jobID, directory: request.directory, expectedParentID: request.parentID })
      if (!result.ok) return unavailable()
      const loaded = result.value
      const active = findActiveAttempt(loaded)
      if (active !== undefined) {
        const evidence = await snapshot({ sdk: input.sdk, clock, loaded, active })
        switch (evidence.kind) {
          case "completed":
          case "cancelled":
            return serializeOutcome(observationToOutcome(evidence, loaded.jobID, loaded.spec.role, active, 0))
          case "pending":
          case "unknown":
          case "failed":
            break
          default: {
            const exhaustive: never = evidence
            return exhaustive
          }
        }
      }
      if (loaded.cancelIntents.length === 0) {
        const written = await appendRecord(input.sdk, { jobID: loaded.jobID, directory: loaded.spec.directory,
          record: { v: 1, kind: "cancel-intent", job_id: loaded.jobID, intent_at: clock.now() } })
        if (!written.ok) return serializeOutcome({ kind: "failure", reason: "cancel intent could not be persisted; job retained" })
      }
      if (active === undefined) {
        return serializeOutcome(makeEnvelope("cancelling", loaded.jobID, loaded.spec.role,
          { index: loaded.reservations.at(-1)?.attempt_index ?? 0, model: loaded.reservations.at(-1)?.model ?? null },
          loaded.jobID, 0, "cancel intent retained; awaiting attempt reconciliation"))
      }
      return serializeOutcome(await abortAndReconcile({ sdk: input.sdk, clock, loaded, active }))
    }, request.signal).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return serializeOutcome({ kind: "failure", reason: "cancel observation interrupted; existing intent retained" })
      }
      return unavailable()
    })
  }
  return { cancel }
}
