import type { Clock, DispatchSdk, SdkMessageWithParts } from "./dispatch-contract.ts"
import { errorText } from "./dispatch-helpers.ts"
import { classifyReadResult, type ClassifyResult } from "./dispatch-classifier.ts"
export { extractUsableText } from "./dispatch-classifier.ts"

/**
 * Observes a dispatched child session until a terminal result is found or the
 * wait budget expires. Polls every {@link POLL_INTERVAL_MS}. When the budget
 * runs out the final read is still given {@link MIN_READ_TRANSPORT_MS} to
 * complete; if it times out, the observer falls back to the last non-terminal
 * evidence (pending if durable progress was seen, otherwise startup-grace
 * logic). A read that exceeds its transport bound is never terminal unknown
 * when earlier polls saw active work. An aborted signal returns pending without
 * calling session.abort.
 */
export const POLL_INTERVAL_MS = 2_000
export const STARTUP_GRACE_MS = 10_000
export const MIN_READ_TRANSPORT_MS = 50
export const SNAPSHOT_READ_TRANSPORT_MS = 5_000

export interface ObservationRequest {
  readonly sdk: DispatchSdk
  readonly jobID: string
  readonly childSessionID: string
  readonly requestMessageID: string
  readonly directory: string
  readonly waitBudgetMs: number
  readonly clock: Clock
  readonly signal?: AbortSignal
  readonly sessionStatus?: () => Promise<{ readonly status: string } | undefined>
  /** Startup grace in milliseconds; defaults to {@link STARTUP_GRACE_MS}. */
  readonly startupGraceMs?: number
}

export interface ObservationDiagnostics {
  readonly elapsed_ms?: number
  readonly status?: string
  readonly aborted?: boolean
  readonly reason?: string
}

export type ObservationOutcome =
  | { readonly kind: "completed"; readonly text: string }
  | { readonly kind: "failed"; readonly error: string; readonly retryable: boolean }
  | { readonly kind: "cancelled" }
  | { readonly kind: "pending"; readonly diagnostics?: ObservationDiagnostics }
  | { readonly kind: "unknown"; readonly reason: string }

type ReadResult =
  | { readonly kind: "messages"; readonly messages: ReadonlyArray<SdkMessageWithParts> }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "timeout"; readonly reason: string }

type TransportResult<T> =
  | { readonly kind: "value"; readonly value: T }
  | { readonly kind: "error"; readonly reason: string }
  | { readonly kind: "timeout"; readonly reason: string }

async function readTransport<T>(req: ObservationRequest, read: () => Promise<T>, budgetMs: number): Promise<TransportResult<T>> {
  const readAbort = new AbortController()
  const onAbort = () => readAbort.abort()
  req.signal?.addEventListener("abort", onAbort, { once: true })
  if (req.signal?.aborted) readAbort.abort()
  try {
    const resultPromise = read().then(
      (value): TransportResult<T> => ({ kind: "value", value }),
      (error: unknown): TransportResult<T> => ({ kind: "error", reason: errorText(error) }),
    )
    const timeoutPromise = req.clock.sleep(budgetMs <= 0 ? SNAPSHOT_READ_TRANSPORT_MS : budgetMs, readAbort.signal).then(
      (): TransportResult<T> => ({ kind: "timeout", reason: "SDK read exceeded remaining wait budget" }),
      (error: unknown): TransportResult<T> => req.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
        ? { kind: "timeout", reason: "observation interrupted" }
        : { kind: "error", reason: "observation clock failed" },
    )
    return await Promise.race([resultPromise, timeoutPromise])
  } catch (error: unknown) {
    return { kind: "error", reason: errorText(error) }
  } finally {
    req.signal?.removeEventListener("abort", onAbort)
    readAbort.abort()
  }
}

async function readMessages(req: ObservationRequest, budgetMs: number): Promise<ReadResult> {
  const result = await readTransport(req, () => req.sdk.session.messages({ path: { id: req.childSessionID }, query: { directory: req.directory } }), budgetMs)
  switch (result.kind) {
    case "error":
    case "timeout": return result
    case "value": return result.value.error !== undefined ? { kind: "error", reason: errorText(result.value.error) } : { kind: "messages", messages: result.value.data ?? [] }
    default: { const exhaustive: never = result; return exhaustive }
  }
}

export async function observeDispatch(req: ObservationRequest): Promise<ObservationOutcome> {
  const { clock, signal, waitBudgetMs } = req
  const startupGraceMs = req.startupGraceMs ?? STARTUP_GRACE_MS
  const startTime = clock.now()
  let lastNonTerminal: { readonly state: "pending" | "unknown"; readonly diagnostics?: ObservationDiagnostics; readonly reason?: string } | undefined
  let durableProgress = false

  function remainingMs(): number {
    return Math.max(0, waitBudgetMs - (clock.now() - startTime))
  }

  function classifyNoMessagesForReq(elapsedMs: number): ClassifyResult {
    if (elapsedMs < startupGraceMs) {
      return { kind: "continue", state: "pending", diagnostics: { elapsed_ms: elapsedMs } }
    }
    return { kind: "continue", state: "unknown", reason: "no durable progress after startup grace" }
  }

  while (true) {
    if (signal?.aborted) {
      return { kind: "pending", diagnostics: { aborted: true } }
    }
    const readBudget = waitBudgetMs === 0 ? 0 : Math.max(remainingMs(), MIN_READ_TRANSPORT_MS)
    const read = await readMessages(req, readBudget)
    if (signal?.aborted) {
      return { kind: "pending", diagnostics: { aborted: true } }
    }
    if (read.kind === "timeout") {
      if (durableProgress) {
        return { kind: "pending", diagnostics: lastNonTerminal?.diagnostics }
      }
      if (lastNonTerminal !== undefined) {
        return lastNonTerminal.state === "pending"
          ? { kind: "pending", diagnostics: lastNonTerminal.diagnostics }
          : { kind: "unknown", reason: lastNonTerminal.reason ?? "observation timed out without durable progress" }
      }
      const elapsedMs = clock.now() - startTime
      if (elapsedMs < startupGraceMs) {
        return { kind: "pending", diagnostics: { elapsed_ms: elapsedMs } }
      }
      return { kind: "unknown", reason: "no durable progress after startup grace" }
    }
    let result = classifyReadResult(read, req.childSessionID, req.requestMessageID)
    if (result.kind === "continue" && result.state === "pending" && result.diagnostics === undefined) {
      const elapsedMs = clock.now() - startTime
      let liveStatus: string | undefined
      let probeFailure: string | undefined
      if (req.sessionStatus !== undefined) {
        const status = await readTransport(req, req.sessionStatus, waitBudgetMs === 0 ? 0 : Math.max(remainingMs(), MIN_READ_TRANSPORT_MS))
        if (signal?.aborted) return { kind: "pending", diagnostics: { aborted: true } }
        switch (status.kind) {
          case "value": liveStatus = status.value?.status.toLowerCase(); break
          case "error":
          case "timeout": probeFailure = `status probe failed: ${status.reason}`; break
          default: { const exhaustive: never = status; return exhaustive }
        }
      }
      if (liveStatus === "busy" || liveStatus === "retry") {
        result = { kind: "continue", state: "pending", diagnostics: { status: liveStatus } }
      } else {
        result = classifyNoMessagesForReq(clock.now() - startTime)
        if (probeFailure !== undefined) {
          result = result.kind === "continue" && result.state === "pending"
            ? { ...result, diagnostics: { ...result.diagnostics, reason: probeFailure } }
            : { kind: "continue", state: "unknown", reason: `no durable progress after startup grace; ${probeFailure}` }
        }
      }
    }
    if (result.kind === "terminal") {
      return result.outcome
    }
    lastNonTerminal = { state: result.state, diagnostics: result.diagnostics, reason: result.reason }
    const status = result.diagnostics?.status
    if (result.state === "pending" && (status === "active" || status === "tool-calls" || status === "busy" || status === "retry")) {
      durableProgress = true
    }
    const sleepMs = Math.min(POLL_INTERVAL_MS, remainingMs())
    if (sleepMs <= 0) break
    try {
      await clock.sleep(sleepMs, signal)
    } catch (error: unknown) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        return { kind: "pending", diagnostics: { aborted: true } }
      }
      return { kind: "unknown", reason: `observation clock failed: ${errorText(error)}` }
    }
  }

  if (lastNonTerminal?.state === "pending") {
    return { kind: "pending", diagnostics: lastNonTerminal.diagnostics }
  }
  return { kind: "unknown", reason: lastNonTerminal?.reason ?? "observation window expired without terminal evidence" }
}
