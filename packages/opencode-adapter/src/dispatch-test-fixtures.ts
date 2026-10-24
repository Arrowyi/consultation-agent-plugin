import {
  DISPATCH_ROLES,
  type AttemptReceipt,
  type AttemptReservation,
  type CancelIntent,
  type Clock,
  type DispatchCancelledEnvelope,
  type DispatchEnvelope,
  type DispatchRole,
  type DispatchSdk,
  type JobSpec,
  type SdkAssistantMessage,
  type SdkMessageWithParts,
  type SdkSession,
  type SdkSessionStatus,
  type SdkTextPart,
} from "./dispatch-contract.ts"

export const FAKE_PARENT_ID = "ses_parent"
export const FAKE_JOB_ID = "ses_job"
export const FAKE_SESSION_ID = "ses_child"
export const FAKE_MESSAGE_ID = "msg-attempt-1"
export const FAKE_DIRECTORY = "/tmp/project"

export function makeJobSpec(
  overrides: Partial<JobSpec> & { role?: DispatchRole } = {},
): JobSpec {
  return {
    v: 1,
    kind: "job-spec",
    role: overrides.role ?? "analyst",
    agent_name: overrides.agent_name ?? "consultation-analyst",
    model_chain: overrides.model_chain ?? ["opencode-go/qwen3.8-max"],
    prompt: overrides.prompt ?? "analyze this",
    parent_id: overrides.parent_id ?? FAKE_PARENT_ID,
    directory: overrides.directory ?? FAKE_DIRECTORY,
    created_at: overrides.created_at ?? 1_000_000,
  }
}

export const validRoleSpecs: Array<{ label: string; role: DispatchRole; record: JobSpec }> = [
  { label: "explorer", role: "explorer", record: makeJobSpec({ role: "explorer", agent_name: "consultation-explorer", model_chain: ["opencode-go/deepseek-v4.1-flash"] }) },
  { label: "analyst", role: "analyst", record: makeJobSpec({ role: "analyst", agent_name: "consultation-analyst", model_chain: ["opencode-go/qwen3.8-max"] }) },
  { label: "critic", role: "critic", record: makeJobSpec({ role: "critic", agent_name: "consultation-critic", model_chain: ["opencode/gemini-3.8-flash"] }) },
  { label: "verifier", role: "verifier", record: makeJobSpec({ role: "verifier", agent_name: "consultation-verifier", model_chain: ["opencode/gemini-3.8-flash"] }) },
  { label: "writer-bundled", role: "writer", record: makeJobSpec({ role: "writer", agent_name: "consultation-writer", model_chain: ["opencode/claude-sonnet-5-5"] }) },
  { label: "writer-delegate-model", role: "writer", record: makeJobSpec({ role: "writer", agent_name: "host-writer", model_chain: ["custom/model"] }) },
  { label: "writer-delegate-null", role: "writer", record: makeJobSpec({ role: "writer", agent_name: "host-writer", model_chain: [null] }) },
  { label: "lite", role: "lite", record: makeJobSpec({ role: "lite", agent_name: "lite", model_chain: ["opencode-go/deepseek-v4.1-flash"] }) },
  { label: "coder", role: "coder", record: makeJobSpec({ role: "coder", agent_name: "coder", model_chain: ["opencode-go/glm-5.3"] }) },
  { label: "coder-lite", role: "coder-lite", record: makeJobSpec({ role: "coder-lite", agent_name: "coder-lite", model_chain: ["opencode-go/glm-5.3-flash"] }) },
  { label: "build-host", role: "build", record: makeJobSpec({ role: "build", agent_name: "build", model_chain: [null] }) },
  { label: "consultant", role: "consultant", record: makeJobSpec({ role: "consultant", agent_name: "consultant", model_chain: ["opencode-go/glm-5.3"] }) },
]

export function makeAttemptReservation(overrides: Partial<AttemptReservation> = {}): AttemptReservation {
  return {
    v: 1,
    kind: "attempt-reservation",
    job_id: overrides.job_id ?? FAKE_JOB_ID,
    attempt_index: overrides.attempt_index ?? 0,
    model: overrides.model ?? "opencode/claude-sonnet-5-5",
    message_id: overrides.message_id ?? FAKE_MESSAGE_ID,
    reserved_at: overrides.reserved_at ?? 1_000_000,
  }
}

export function makeAttemptReceipt(overrides: Partial<AttemptReceipt> = {}): AttemptReceipt {
  return {
    v: 1,
    kind: "attempt-receipt",
    job_id: overrides.job_id ?? FAKE_JOB_ID,
    attempt_index: overrides.attempt_index ?? 0,
    session_id: overrides.session_id ?? FAKE_SESSION_ID,
    message_id: overrides.message_id ?? FAKE_MESSAGE_ID,
    received_at: overrides.received_at ?? 1_000_000,
  }
}

export function makeCancelIntent(overrides: Partial<CancelIntent> = {}): CancelIntent {
  return {
    v: 1,
    kind: "cancel-intent",
    job_id: overrides.job_id ?? FAKE_JOB_ID,
    intent_at: overrides.intent_at ?? 1_000_000,
    reason: overrides.reason,
  }
}

export function makeEnvelope(
  status: "pending" | "unknown" | "cancelling",
  overrides: Partial<DispatchEnvelope> = {},
): DispatchEnvelope {
  return {
    v: 1,
    status,
    job_id: overrides.job_id ?? FAKE_JOB_ID,
    role: overrides.role ?? "analyst",
    attempt: overrides.attempt ?? { index: 0, model: "opencode/claude-sonnet-5-5" },
    session_id: overrides.session_id ?? FAKE_SESSION_ID,
    waited_ms: overrides.waited_ms ?? 0,
    reason: overrides.reason ?? "waiting for specialist",
    next: overrides.next ?? "janus_dispatch_wait",
  }
}

export function makeCancelledEnvelope(overrides: Partial<DispatchCancelledEnvelope> = {}): DispatchCancelledEnvelope {
  return {
    v: 1,
    status: "cancelled",
    job_id: overrides.job_id ?? FAKE_JOB_ID,
    role: overrides.role ?? "analyst",
    attempt: overrides.attempt ?? { index: 0, model: "opencode/claude-sonnet-5-5" },
    session_id: overrides.session_id ?? FAKE_SESSION_ID,
    waited_ms: overrides.waited_ms ?? 0,
    reason: overrides.reason ?? "cancelled by user",
    next: overrides.next ?? "janus_dispatch_wait",
  }
}

export interface FakeSdk extends DispatchSdk {
  readonly calls: ReadonlyArray<unknown>
  seedMessages(sessionID: string, msgs: ReadonlyArray<SdkMessageWithParts>): void
  setPromptAsyncResult(result: { readonly data?: void | undefined; readonly error?: unknown }): void
  setPromptAsyncError(error: unknown): void
  setPromptAsyncRejection(error: unknown): void
  setStatusResult(result: { readonly data?: Readonly<Record<string, SdkSessionStatus>>; readonly error?: unknown }): void
}

/**
 * In-memory SDK fake. Records every call so tests can assert the lifecycle
 * never issues real network requests. Supports create/prompt/promptAsync/abort/get/children/messages/status
 * and configurable failure injection / message seeding for lifecycle tests.
 */
export function createFakeSdk(): FakeSdk {
  const sessions = new Map<string, SdkSession>()
  const messages = new Map<string, SdkMessageWithParts[]>()
  const calls: unknown[] = []
  let sessionCounter = 0

  let promptAsyncResult: { readonly data?: void | undefined; readonly error?: unknown } = { data: undefined }
  let promptAsyncReject: { readonly shouldThrow: boolean; readonly error: unknown } = { shouldThrow: false, error: undefined }
  let statusResult: { readonly data?: Readonly<Record<string, SdkSessionStatus>>; readonly error?: unknown } = { data: {} }

  function record(method: string, input: unknown): void {
    calls.push({ method, input })
  }

  return {
    get calls() {
      return calls
    },
    seedMessages(sessionID, msgs) {
      const list = messages.get(sessionID) ?? []
      list.push(...msgs)
      messages.set(sessionID, list)
    },
    setPromptAsyncResult(result) {
      promptAsyncResult = result
      promptAsyncReject = { shouldThrow: false, error: undefined }
    },
    setPromptAsyncError(error) {
      promptAsyncResult = { error }
      promptAsyncReject = { shouldThrow: false, error: undefined }
    },
    setPromptAsyncRejection(error) {
      promptAsyncReject = { shouldThrow: true, error }
    },
    setStatusResult(result) {
      statusResult = result
    },
    session: {
      create: async (input) => {
        record("create", input)
        const id = `ses_fake_${++sessionCounter}`
        const session: SdkSession = {
          id,
          parentID: input.body.parentID,
          directory: input.query.directory ?? FAKE_DIRECTORY,
          title: input.body.title ?? "unnamed",
          time: { created: Date.now(), updated: Date.now() },
        }
        sessions.set(id, session)
        messages.set(id, [])
        const parentMessages = messages.get(input.body.parentID ?? "")
        if (parentMessages !== undefined && input.body.parentID !== undefined) {
          parentMessages.push({
            info: { role: "user", id: `msg_create_${id}`, sessionID: input.body.parentID },
            parts: [{ type: "text", text: `created ${id}` }],
          })
        }
        return { data: session }
      },
      prompt: async (input) => {
        record("prompt", input)
        const list = messages.get(input.path.id) ?? []
        if (input.body.noReply === true) {
          list.push({
            info: { role: "user", id: input.body.messageID ?? FAKE_MESSAGE_ID, sessionID: input.path.id },
            parts: input.body.parts,
          })
          return { data: undefined }
        }
        const assistant: SdkAssistantMessage = {
          id: FAKE_MESSAGE_ID,
          sessionID: input.path.id,
          role: "assistant",
          time: { created: Date.now() },
          parentID: input.body.messageID ?? FAKE_MESSAGE_ID,
          modelID: input.body.model?.modelID ?? "default",
          providerID: input.body.model?.providerID ?? "default",
        }
        list.push({ info: assistant, parts: input.body.parts })
        messages.set(input.path.id, list)
        return { data: { info: assistant, parts: input.body.parts } }
      },
      promptAsync: async (input) => {
        record("promptAsync", input)
        if (promptAsyncReject.shouldThrow) {
          throw promptAsyncReject.error
        }
        return promptAsyncResult
      },
      abort: async (input) => {
        record("abort", input)
        return { data: true }
      },
      get: async (input) => {
        record("get", input)
        const session = sessions.get(input.path.id)
        return { data: session }
      },
      children: async (input) => {
        record("children", input)
        const list = [...sessions.values()].filter((s) => s.parentID === input.path.id)
        return { data: list }
      },
      messages: async (input) => {
        record("messages", input)
        return { data: [...(messages.get(input.path.id) ?? [])] }
      },
      status: async (input) => {
        record("status", input)
        return statusResult
      },
    },
  }
}

/**
 * Deterministic fake clock. `advance(ms)` jumps simulated time forward and
 * resolves any sleepers whose deadline has passed.
 */
export function createFakeClock(startMs = 0): Clock & { advance(ms: number): void } {
  let now = startMs
  type Sleeper = {
    deadline: number
    resolve: () => void
    reject: (err: Error) => void
  }
  const sleepers = new Set<Sleeper>()

  return {
    now: () => now,
    sleep: (ms, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"))
      }
      return new Promise<void>((resolve, reject) => {
        const entry: Sleeper = { deadline: now + ms, resolve, reject }
        sleepers.add(entry)
        if (signal) {
          const onAbort = (): void => {
            sleepers.delete(entry)
            reject(new DOMException("aborted", "AbortError"))
          }
          signal.addEventListener("abort", onAbort, { once: true })
        }
      })
    },
    advance: (ms) => {
      now += ms
      for (const entry of [...sleepers]) {
        if (entry.deadline <= now) {
          sleepers.delete(entry)
          entry.resolve()
        }
      }
    },
  }
}

function jobSpecWithProtoKey(extra: Record<string, unknown>): unknown {
  const base: Record<string, unknown> = {
    v: 1,
    kind: "job-spec",
    role: "explorer",
    agent_name: "consultation-explorer",
    model_chain: ["opencode-go/deepseek-v4.1-flash"],
    prompt: "hostile",
    parent_id: FAKE_PARENT_ID,
    directory: FAKE_DIRECTORY,
    created_at: 1_000_000,
  }
  Object.defineProperty(base, "__proto__", {
    value: { polluted: true },
    enumerable: true,
    configurable: true,
    writable: true,
  })
  return { ...base, ...extra }
}

/**
 * Adversarial inputs for the malformed-input probe. Each should be rejected
 * without crashing, without polluting prototypes, and without silent acceptance.
 */
export const adversarialRecords: ReadonlyArray<unknown> = [
  jobSpecWithProtoKey({}),
  jobSpecWithProtoKey({ created_at: 1e20 }),
  jobSpecWithProtoKey({ unknown_field: "should be rejected by strict schema" }),
  {
    v: 1,
    kind: "attempt-receipt",
    job_id: FAKE_JOB_ID,
    attempt_index: 0,
    session_id: FAKE_SESSION_ID,
    message_id: FAKE_MESSAGE_ID,
    received_at: Number.POSITIVE_INFINITY,
  },
  { v: "one", kind: "job-spec", role: "explorer", agent_name: "a", model_chain: [], prompt: "x", parent_id: "p", directory: "/d", created_at: 0 },
]

/**
 * Re-export roles so fixtures consumers do not need a second import.
 */
export { DISPATCH_ROLES }
export type { SdkTextPart }
