import { z } from "zod"

export const DISPATCH_ROLES = ["explorer", "analyst", "critic", "verifier", "writer", "simple", "build-lite", "build"] as const
export type DispatchRole = (typeof DISPATCH_ROLES)[number]

export const PRODUCTION_WAIT_BUDGET_MS = 300_000
export const DEFAULT_WAIT_MS = PRODUCTION_WAIT_BUDGET_MS

const roleSchema = z.enum(DISPATCH_ROLES)
const messageIdSchema = z.string().regex(/^msg-[A-Za-z0-9_-]+$/, { message: "expected msg-prefixed message id" })
const sessionIdSchema = z.string().min(1, { message: "expected non-empty session id" })

export class DispatchParseError extends Error {
  readonly _tag = "DispatchParseError" as const
  readonly issues: ReadonlyArray<{ readonly path: string; readonly message: string }>

  constructor(message: string, issues?: ReadonlyArray<{ readonly path: string; readonly message: string }>) {
    super(message)
    this.issues = issues ?? []
  }
}

export type DispatchResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: DispatchParseError }

function fromZodError(message: string, zodError: z.ZodError): DispatchParseError {
  const issues = zodError.issues.map((i) => ({
    path: i.path.length === 1 && i.path[0] === "v" ? "version" : i.path.join("."),
    message: i.message,
  }))
  return new DispatchParseError(
    `${message}: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`,
    issues,
  )
}

function journalRecord<K extends string, S extends z.ZodRawShape>(kind: K, shape: S) {
  return z.object({ v: z.literal(1), kind: z.literal(kind), ...shape }).strict()
}

export const JobSpecSchema = journalRecord("job-spec", {
  role: roleSchema,
  agent_name: z.string().min(1),
  model_chain: z.array(z.string().nullable()),
  prompt: z.string(),
  parent_id: sessionIdSchema,
  directory: z.string().min(1),
  created_at: z.number().int(),
})

export type JobSpec = z.infer<typeof JobSpecSchema>

export const AttemptReservationSchema = journalRecord("attempt-reservation", {
  job_id: sessionIdSchema,
  attempt_index: z.number().int().nonnegative(),
  model: z.string().nullable(),
  message_id: messageIdSchema,
  reserved_at: z.number().int(),
})

export type AttemptReservation = z.infer<typeof AttemptReservationSchema>

export const AttemptReceiptSchema = journalRecord("attempt-receipt", {
  job_id: sessionIdSchema,
  attempt_index: z.number().int().nonnegative(),
  session_id: sessionIdSchema,
  message_id: messageIdSchema,
  received_at: z.number().int(),
})

export type AttemptReceipt = z.infer<typeof AttemptReceiptSchema>

export const CancelIntentSchema = journalRecord("cancel-intent", {
  job_id: sessionIdSchema,
  intent_at: z.number().int(),
  reason: z.string().optional(),
})

export type CancelIntent = z.infer<typeof CancelIntentSchema>

export const JournalRecordSchema = z.discriminatedUnion("kind", [
  JobSpecSchema,
  AttemptReservationSchema,
  AttemptReceiptSchema,
  CancelIntentSchema,
])

export type JournalRecord = z.infer<typeof JournalRecordSchema>

export function parseJournalRecord(input: unknown): DispatchResult<JournalRecord> {
  const result = JournalRecordSchema.safeParse(input)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: fromZodError("invalid journal record", result.error) }
}

const attemptSchema = z.object({
  index: z.number().int().nonnegative(),
  model: z.string().nullable(),
})

const envelopeBaseSchema = z
  .object({
    v: z.literal(1),
    job_id: sessionIdSchema,
    role: roleSchema,
    attempt: attemptSchema,
    session_id: sessionIdSchema,
    waited_ms: z.number().int().nonnegative(),
    reason: z.string(),
    next: z.enum(["consultation_dispatch_wait", "consultation_dispatch_cancel"]),
  })
  .strict()

export const DispatchEnvelopeSchema = envelopeBaseSchema.extend({
  status: z.enum(["pending", "unknown", "cancelling"], { message: "unsupported envelope status" }),
})

export type DispatchEnvelope = z.infer<typeof DispatchEnvelopeSchema>

export const DispatchCancelledEnvelopeSchema = envelopeBaseSchema.extend({
  status: z.literal("cancelled"),
})

export type DispatchCancelledEnvelope = z.infer<typeof DispatchCancelledEnvelopeSchema>

export type DispatchOutcome =
  | { readonly kind: "success"; readonly text: string }
  | { readonly kind: "nonterminal"; readonly envelope: DispatchEnvelope }
  | { readonly kind: "cancelled"; readonly envelope: DispatchCancelledEnvelope }
  | { readonly kind: "failure"; readonly reason: string }

const AnyEnvelopeSchema = z.discriminatedUnion("status", [
  DispatchEnvelopeSchema,
  DispatchCancelledEnvelopeSchema,
])

export function parseOutcomeEnvelope(json: string): DispatchResult<DispatchEnvelope | DispatchCancelledEnvelope> {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch (e) {
    return { ok: false, error: new DispatchParseError(`outcome is not valid JSON: ${e instanceof Error ? e.message : String(e)}`) }
  }
  const result = AnyEnvelopeSchema.safeParse(parsed)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: fromZodError("invalid outcome envelope", result.error) }
}

export function serializeOutcome(outcome: DispatchOutcome): string {
  switch (outcome.kind) {
    case "success":
      return outcome.text
    case "nonterminal":
    case "cancelled":
      return JSON.stringify(outcome.envelope)
    case "failure":
      return `Error: ${outcome.reason}`
  }
}

export const WaitArgsSchema = z.object({
  job_id: sessionIdSchema,
  wait_ms: z.number().int().min(0).max(PRODUCTION_WAIT_BUDGET_MS).default(DEFAULT_WAIT_MS),
})

export type WaitArgs = z.infer<typeof WaitArgsSchema>

export function parseWaitArgs(input: unknown): DispatchResult<WaitArgs> {
  const result = WaitArgsSchema.safeParse(input)
  return result.success
    ? { ok: true, value: result.data }
    : { ok: false, error: fromZodError("invalid wait args", result.error) }
}

export interface SdkSession {
  readonly id: string
  readonly parentID?: string
  readonly directory: string
  readonly title: string
  readonly time: { readonly created: number; readonly updated: number }
}

export interface SdkAssistantMessage {
  readonly id: string
  readonly sessionID: string
  readonly role: "assistant"
  readonly time: { readonly created: number; readonly completed?: number }
  readonly error?: unknown
  readonly parentID: string
  readonly modelID: string
  readonly providerID: string
  readonly finish?: string
}

export interface SdkTextPart {
  readonly type: "text"
  readonly text: string
  readonly synthetic?: boolean
  readonly ignored?: boolean
}

type HostMessages = NonNullable<Awaited<ReturnType<import("@opencode-ai/plugin").PluginInput["client"]["session"]["messages"]>>["data"]>
export type SdkPart = SdkTextPart | Exclude<HostMessages[number]["parts"][number], { readonly type: "text" }>

export interface SdkMessageWithParts {
  readonly info: SdkAssistantMessage | { readonly role: string; readonly id: string; readonly sessionID: string }
  readonly parts: ReadonlyArray<SdkPart>
}

export type SdkQuery = { readonly directory?: string }
export type SdkPath = { readonly id: string }
export type SdkResult<T> = { readonly data?: T; readonly error?: unknown }
export type SdkPromptBody = {
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly parts: ReadonlyArray<SdkTextPart>
  readonly noReply?: boolean
  readonly messageID?: string
}

export interface SdkSessionStatus {
  readonly type: string
}

export interface DispatchSdk {
  readonly session: {
    create(input: { body: { readonly parentID?: string; readonly title?: string }; query: SdkQuery }): Promise<SdkResult<SdkSession>>
    prompt(input: { path: SdkPath; body: SdkPromptBody; query?: SdkQuery }): Promise<
      SdkResult<{ readonly info: SdkAssistantMessage; readonly parts: ReadonlyArray<SdkTextPart> }>
    >
    promptAsync(input: { path: SdkPath; body: SdkPromptBody; query?: SdkQuery }): Promise<SdkResult<void | undefined>>
    abort(input: { path: SdkPath; query?: SdkQuery }): Promise<SdkResult<boolean>>
    get(input: { path: SdkPath; query?: SdkQuery }): Promise<SdkResult<SdkSession>>
    children(input: { path: SdkPath; query?: SdkQuery }): Promise<SdkResult<ReadonlyArray<SdkSession>>>
    messages(input: { path: SdkPath; query?: SdkQuery }): Promise<SdkResult<ReadonlyArray<SdkMessageWithParts>>>
    status(input: { query?: SdkQuery }): Promise<SdkResult<Readonly<Record<string, SdkSessionStatus>>>>
  }
}

export interface Clock {
  now(): number
  sleep(ms: number, signal?: AbortSignal): Promise<void>
}

export interface KeyedMutex {
  withLock<T>(key: string, fn: () => Promise<T>, signal?: AbortSignal): Promise<T>
}

export { createKeyedMutex } from "./dispatch-mutex.ts"
