import path from "node:path"

import {
  type AttemptReceipt,
  type AttemptReservation,
  type CancelIntent,
  type Clock,
  type DispatchRole,
  type DispatchSdk,
  type JobSpec,
  type JournalRecord,
  type SdkSession,
  type SdkTextPart,
  type SdkPart,
  parseJournalRecord,
} from "./dispatch-contract.ts"
import { errorText } from "./dispatch-helpers.ts"
import { bindJob } from "./dispatch-journal-binding.ts"

export class DispatchJournalError extends Error {
  readonly _tag = "DispatchJournalError" as const
  constructor(
    readonly reason: "job-unavailable" | "invalid-job" | "write-failed" | "read-error",
    message: string,
    readonly jobID?: string,
  ) {
    super(message)
  }
}
export type JournalResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DispatchJournalError }
function ok<T>(value: T): JournalResult<T> {
  return { ok: true, value }
}
function fail(
  reason: "job-unavailable" | "invalid-job" | "write-failed" | "read-error",
  message: string,
): JournalResult<never> {
  return { ok: false, error: new DispatchJournalError(reason, message) }
}

export interface LoadedJob {
  readonly jobID: string
  readonly spec: JobSpec
  readonly reservations: AttemptReservation[]
  readonly receipts: AttemptReceipt[]
  readonly cancelIntents: CancelIntent[]
  readonly children: SdkSession[]
  readonly records: JournalRecord[]
}
export interface CreateJobInput {
  readonly parentID: string
  readonly directory: string
  readonly role: DispatchRole
  readonly agentName: string
  readonly modelChain: ReadonlyArray<string | null>
  readonly prompt: string
  readonly clock: Clock
}
export interface CreateJobResult {
  readonly jobID: string
}
export interface AppendRecordInput {
  readonly jobID: string
  readonly directory: string
  readonly record: JournalRecord
  readonly messageID?: string
}
export interface AppendRecordResult {
  readonly messageID: string
}
export interface CreateAttemptSessionInput {
  readonly jobID: string
  readonly directory: string
  readonly role: DispatchRole
}
export interface CreateAttemptSessionResult {
  readonly sessionID: string
}
export interface LoadJobInput {
  readonly jobID: string
  readonly directory: string
  readonly expectedParentID: string
}

const MARKER = "[consultation-dispatch:v1] "
let messageCounter = 0
function makeMessageID(): string {
  messageCounter++
  return `msg-${messageCounter}-${Math.random().toString(36).slice(2, 8)}`
}
function isJournalPart(part: SdkPart): part is SdkTextPart {
  return part.type === "text" && part.synthetic === true && part.ignored === true
}

export async function createJob(
  sdk: DispatchSdk,
  input: CreateJobInput,
): Promise<JournalResult<CreateJobResult>> {
  const directory = path.normalize(input.directory)
  const title = `${MARKER}${input.role}`
  const createResult = await sdk.session.create({
    body: { parentID: input.parentID, title },
    query: { directory },
  })
  if (createResult.error !== undefined || createResult.data === undefined) {
    return fail("write-failed", `failed to create job root session: ${createResult.error !== undefined ? errorText(createResult.error) : "no data"}`)
  }
  const jobID = createResult.data.id
  const spec: JobSpec = {
    v: 1,
    kind: "job-spec",
    role: input.role,
    agent_name: input.agentName,
    model_chain: [...input.modelChain],
    prompt: input.prompt,
    parent_id: input.parentID,
    directory,
    created_at: input.clock.now(),
  }
  try {
    const append = await appendRecord(sdk, { jobID, directory, record: spec })
    if (!append.ok) return { ok: false, error: new DispatchJournalError(append.error.reason, append.error.message, jobID) }
  } catch {
    return { ok: false, error: new DispatchJournalError("write-failed", "job spec persistence failed", jobID) }
  }
  return ok({ jobID })
}

export async function appendRecord(
  sdk: DispatchSdk,
  input: AppendRecordInput,
): Promise<JournalResult<AppendRecordResult>> {
  const directory = path.normalize(input.directory)
  const messageID = input.messageID ?? makeMessageID()
  const text = JSON.stringify(input.record)
  try {
    await sdk.session.prompt({
      path: { id: input.jobID },
      body: {
        parts: [{ type: "text", text, ignored: true, synthetic: true }],
        noReply: true,
        messageID,
      },
      query: { directory },
    })
  } catch {
    return fail("write-failed", "journal write was rejected by host")
  }

  // Contract item 3: noReply runtime result may not match the generated
  // AssistantMessage type. Verify persistence by reading messages.
  const messagesResult = await sdk.session.messages({
    path: { id: input.jobID },
    query: { directory },
  })
  if (messagesResult.error !== undefined || messagesResult.data === undefined) {
    return fail("write-failed", "journal read-back returned no data")
  }

  const found = messagesResult.data.find((m) => {
    const info = m.info
    return "id" in info && info.id === messageID && m.parts.some((p) => p.type === "text" && p.text === text)
  })
  if (found === undefined) {
    return fail("write-failed", "journal record not confirmed after write")
  }

  return ok({ messageID })
}

export async function createAttemptSession(
  sdk: DispatchSdk,
  input: CreateAttemptSessionInput,
): Promise<JournalResult<CreateAttemptSessionResult>> {
  const directory = path.normalize(input.directory)
  const title = `${MARKER}attempt ${input.role}`
  const result = await sdk.session.create({
    body: { parentID: input.jobID, title },
    query: { directory },
  })
  if (result.error !== undefined || result.data === undefined) {
    return fail("write-failed", "failed to create attempt session")
  }
  return ok({ sessionID: result.data.id })
}

export async function loadJob(
  sdk: DispatchSdk,
  input: LoadJobInput,
): Promise<JournalResult<LoadedJob>> {
  const directory = path.normalize(input.directory)
  const getResult = await sdk.session.get({
    path: { id: input.jobID },
    query: { directory },
  })
  if (getResult.error !== undefined) {
    return fail("read-error", "job root read failed")
  }
  if (getResult.data === undefined) {
    return fail("job-unavailable", "job root not found")
  }
  const root = getResult.data
  if (root.parentID !== input.expectedParentID) {
    return fail("job-unavailable", "job root ownership mismatch")
  }
  if (path.normalize(root.directory) !== directory) {
    return fail("job-unavailable", "job root workspace mismatch")
  }
  if (!root.title.startsWith(MARKER)) {
    return fail("job-unavailable", "job root marker mismatch")
  }

  const [messagesResult, childrenResult] = await Promise.all([
    sdk.session.messages({ path: { id: input.jobID }, query: { directory } }),
    sdk.session.children({ path: { id: input.jobID }, query: { directory } }),
  ])
  if (messagesResult.error !== undefined) {
    return fail("read-error", "job messages read failed")
  }
  if (messagesResult.data === undefined) {
    return fail("invalid-job", "could not read job messages")
  }
  if (childrenResult.error !== undefined) {
    return fail("read-error", "job children read failed")
  }
  if (childrenResult.data === undefined) {
    return fail("invalid-job", "could not read job children")
  }

  const records: JournalRecord[] = []
  for (const message of messagesResult.data) {
    for (const part of message.parts) {
      if (!isJournalPart(part)) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(part.text)
      } catch {
        return fail("invalid-job", "corrupt journal record: invalid JSON")
      }
      const recordResult = parseJournalRecord(parsed)
      if (!recordResult.ok) {
        return fail("invalid-job", "corrupt journal record: schema rejected")
      }
      records.push(recordResult.value)
    }
  }

  return bindJob({ root, records, children: childrenResult.data }, input)
}
