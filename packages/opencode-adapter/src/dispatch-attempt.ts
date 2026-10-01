import type { Clock, DispatchSdk, JobSpec } from "./dispatch-contract.ts"
import { appendRecord, createAttemptSession } from "./dispatch-journal.ts"
import { errorText, splitModel } from "./dispatch-helpers.ts"
import { observeDispatch, type ObservationOutcome } from "./dispatch-observer.ts"
import type { ActiveAttempt } from "./dispatch-cancel.ts"

export class LaunchError extends Error {
  constructor(message: string, readonly jobID?: string) {
    super(message)
  }
}

export interface AttemptContext {
  readonly sdk: DispatchSdk
  readonly clock: Clock
}

export interface AttemptObservation {
  readonly jobID: string
  readonly directory: string
  readonly active: ActiveAttempt
  readonly waitBudgetMs: number
  readonly signal?: AbortSignal
  readonly startupGraceMs?: number
}

export interface AttemptSubmission {
  readonly jobID: string
  readonly spec: JobSpec
  readonly index: number
  readonly waitBudgetMs: number
  readonly signal?: AbortSignal
  readonly startupGraceMs?: number
}

let requestCounter = 0
function makeAttemptRequestID(): string {
  requestCounter++
  return `msg-attempt-${requestCounter}-${Math.random().toString(36).slice(2, 8)}`
}

export function observeAttempt(context: AttemptContext, request: AttemptObservation): Promise<ObservationOutcome> {
  const { sdk, clock } = context
  return observeDispatch({
    sdk, clock, jobID: request.jobID, directory: request.directory,
    childSessionID: request.active.sessionID, requestMessageID: request.active.requestMessageID,
    waitBudgetMs: request.waitBudgetMs, signal: request.signal, startupGraceMs: request.startupGraceMs,
    sessionStatus: async () => {
      const result = await sdk.session.status({ query: { directory: request.directory } })
      if (result.error !== undefined) throw result.error
      const status = result.data?.[request.active.sessionID]
      return status === undefined ? undefined : { status: status.type }
    },
  })
}

export async function launchAttempt(context: AttemptContext, request: AttemptSubmission): Promise<{ readonly attempt: ActiveAttempt; readonly observation: ObservationOutcome }> {
  const { sdk, clock } = context
  const { jobID, spec, index } = request
  const model = spec.model_chain[index] ?? null
  const requestMessageID = makeAttemptRequestID()
  const reservation = await appendRecord(sdk, { jobID, directory: spec.directory, record: {
    v: 1, kind: "attempt-reservation", job_id: jobID, attempt_index: index,
    model, message_id: requestMessageID, reserved_at: clock.now(),
  } })
  if (!reservation.ok) throw new LaunchError(`failed to persist attempt reservation: ${reservation.error.message}`, jobID)
  const child = await createAttemptSession(sdk, { jobID, directory: spec.directory, role: spec.role })
  if (!child.ok) throw new LaunchError(`failed to create attempt session: ${child.error.message}`, jobID)
  const sessionID = child.value.sessionID
  const receipt = await appendRecord(sdk, { jobID, directory: spec.directory, messageID: makeAttemptRequestID(), record: {
    v: 1, kind: "attempt-receipt", job_id: jobID, attempt_index: index,
    session_id: sessionID, message_id: requestMessageID, received_at: clock.now(),
  } })
  if (!receipt.ok) throw new LaunchError(`failed to persist attempt receipt: ${receipt.error.message}`, jobID)
  const attempt: ActiveAttempt = { index, model, sessionID, requestMessageID }
  if (typeof sdk.session.promptAsync !== "function") {
    throw new LaunchError("promptAsync capability unavailable on installed SDK", jobID)
  }
  const result = await Promise.resolve().then(() => sdk.session.promptAsync({
    path: { id: sessionID }, query: { directory: spec.directory }, body: {
      agent: spec.agent_name, model: model === null ? undefined : splitModel(model),
      parts: [{ type: "text", text: spec.prompt }], messageID: requestMessageID,
    },
  })).catch((error: unknown) => ({ error }))
  if (result.error !== undefined) {
    const error = result.error
    const hasStatus = typeof error === "object" && error !== null && (
      ("status" in error && typeof error.status === "number") ||
      ("statusCode" in error && typeof error.statusCode === "number") ||
      ("code" in error && typeof error.code === "number")
    )
    if (hasStatus) throw new LaunchError(`promptAsync failed: ${errorText(error)}`, jobID)
    return { attempt, observation: { kind: "unknown", reason: "promptAsync acknowledgement lost" } }
  }
  return { attempt, observation: await observeAttempt(context, {
    jobID, directory: spec.directory, active: attempt, waitBudgetMs: request.waitBudgetMs,
    signal: request.signal, startupGraceMs: request.startupGraceMs,
  }) }
}
