import path from "node:path"
import type { AttemptReceipt, AttemptReservation, CancelIntent, JobSpec, JournalRecord, SdkSession } from "./dispatch-contract.ts"
import { DispatchJournalError, type JournalResult, type LoadedJob, type LoadJobInput } from "./dispatch-journal.ts"

interface JournalSnapshot {
  readonly root: SdkSession
  readonly records: JournalRecord[]
  readonly children: readonly SdkSession[]
}

export function bindJob(snapshot: JournalSnapshot, input: LoadJobInput): JournalResult<LoadedJob> {
  const { records, root } = snapshot
  const directory = path.normalize(input.directory)
  const fail = (reason: "job-unavailable" | "invalid-job", message: string): JournalResult<never> => ({ ok: false, error: new DispatchJournalError(reason, message) })
  const specs = records.filter((record): record is JobSpec => record.kind === "job-spec")
  if (specs.length !== 1) return fail("invalid-job", specs.length === 0 ? "no job spec found" : "multiple job specs found")
  const spec = specs[0]
  if (spec === undefined) return fail("invalid-job", "no job spec found")
  if (spec.parent_id !== input.expectedParentID || path.normalize(spec.directory) !== directory || root.title !== `[consultation-dispatch:v1] ${spec.role}`) {
    return fail("job-unavailable", "job binding mismatch")
  }
  const reservations = records.filter((record): record is AttemptReservation => record.kind === "attempt-reservation")
  const receipts = records.filter((record): record is AttemptReceipt => record.kind === "attempt-receipt")
  const cancelIntents = records.filter((record): record is CancelIntent => record.kind === "cancel-intent")
  if ([...reservations, ...receipts, ...cancelIntents].some((record) => record.job_id !== input.jobID)) return fail("invalid-job", "journal binding mismatch")
  const children = [...snapshot.children]
  if (children.some((child) => child.parentID !== input.jobID || path.normalize(child.directory) !== directory)) return fail("invalid-job", "child binding mismatch")
  const childIds = new Set(children.map((child) => child.id))
  const reservationByAttempt = new Map<number, AttemptReservation>()
  for (const reservation of reservations) {
    if (reservation.attempt_index < 0 || reservation.attempt_index >= spec.model_chain.length || reservation.model !== (spec.model_chain[reservation.attempt_index] ?? null)) return fail("invalid-job", "invalid journal semantics")
    const previous = reservationByAttempt.get(reservation.attempt_index)
    if (previous !== undefined && (previous.model !== reservation.model || previous.message_id !== reservation.message_id)) return fail("invalid-job", "invalid journal semantics")
    reservationByAttempt.set(reservation.attempt_index, reservation)
  }
  const receiptByAttempt = new Map<number, AttemptReceipt>()
  for (const receipt of receipts) {
    const previous = receiptByAttempt.get(receipt.attempt_index)
    if (previous !== undefined && (previous.session_id !== receipt.session_id || previous.message_id !== receipt.message_id)) return fail("invalid-job", "invalid journal semantics")
    receiptByAttempt.set(receipt.attempt_index, receipt)
    if (receipt.session_id !== input.jobID && !childIds.has(receipt.session_id)) return fail("invalid-job", "receipt references unknown session")
    const reservation = reservationByAttempt.get(receipt.attempt_index)
    if (reservation === undefined || reservation.message_id !== receipt.message_id) return fail("invalid-job", "receipt references unknown reservation")
  }
  return { ok: true, value: { jobID: input.jobID, spec, reservations, receipts, cancelIntents, children, records } }
}
