import { describe, expect, it } from "bun:test"
import { getEventListeners } from "node:events"
import { errorText } from "./dispatch-helpers.ts"
import type { SdkPart } from "./dispatch-contract.ts"
type ToolPart = Extract<SdkPart, { readonly type: "tool" }>
import {
  FAKE_DIRECTORY,
  FAKE_JOB_ID,
  createFakeClock,
} from "./dispatch-test-fixtures.ts"
import type {
  Clock,
  DispatchSdk,
  SdkAssistantMessage,
  SdkMessageWithParts,
  SdkSession,
  SdkTextPart,
} from "./dispatch-contract.ts"
import { observeDispatch, extractUsableText, POLL_INTERVAL_MS } from "./dispatch-observer.ts"
import type { ObservationOutcome } from "./dispatch-observer.ts"

// Local helpers and fake — dispatch-test-fixtures.ts is shared with the
// parallel task 2 worker and must not be edited here.

const CHILD_SESSION_ID = "ses_child"
const REQUEST_MESSAGE_ID = "msg-request-1"

type LocalSdkResult<T> = { data?: T; error?: unknown }

function makeText(text: string, opts?: { readonly synthetic?: boolean; readonly ignored?: boolean }): SdkTextPart {
  return { type: "text", text, ...opts }
}

function makeAssistant(
  id: string,
  overrides: Partial<SdkAssistantMessage> = {},
): SdkAssistantMessage {
  return {
    id,
    sessionID: CHILD_SESSION_ID,
    role: "assistant",
    parentID: REQUEST_MESSAGE_ID,
    time: { created: 1000 },
    modelID: "model",
    providerID: "provider",
    ...overrides,
  }
}

function makeMessage(
  info: SdkAssistantMessage | { readonly role: string; readonly id: string; readonly sessionID: string },
  parts: ReadonlyArray<SdkTextPart> | null,
): SdkMessageWithParts {
  return { info, parts: parts ?? [] }
}

function makeUserMessage(id: string, sessionID: string): SdkMessageWithParts {
  return {
    info: { role: "user", id, sessionID },
    parts: [{ type: "text", text: "user" }],
  }
}

type SeededFakeSdk = DispatchSdk & {
  seedMessages(sessionID: string, messages: ReadonlyArray<SdkMessageWithParts>): void
  setMessagesFailure(error: unknown): void
  setMessagesLatency(ms: number): void
  readonly calls: ReadonlyArray<{ readonly method: string; readonly input: unknown }>
}

function createSeededFakeSdk(): SeededFakeSdk {
  const messageStore = new Map<string, SdkMessageWithParts[]>()
  const calls: Array<{ method: string; input: unknown }> = []
  let failure: unknown | undefined
  let latencyMs = 0

  function stubSessionMethod<TInput, TOutput>(
    method: string,
    fn: (input: TInput) => LocalSdkResult<TOutput>,
  ): (input: TInput) => Promise<LocalSdkResult<TOutput>> {
    return async (input: TInput) => {
      calls.push({ method, input })
      if (latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, latencyMs))
      }
      if (failure !== undefined) {
        const err = failure
        failure = undefined
        throw err
      }
      return fn(input)
    }
  }

  return {
    seedMessages(sessionID, messages) {
      messageStore.set(sessionID, [...messages])
    },
    setMessagesFailure(error) {
      failure = error
    },
    setMessagesLatency(ms) {
      latencyMs = ms
    },
    get calls() {
      return calls
    },
    session: {
      create: stubSessionMethod("create", () => ({ data: { id: "ses_new" } as SdkSession })),
      prompt: stubSessionMethod("prompt", () => ({ data: undefined })),
      promptAsync: stubSessionMethod("promptAsync", () => ({ data: undefined })),
      abort: stubSessionMethod("abort", () => ({ data: true })),
      get: stubSessionMethod("get", () => ({ data: undefined })),
      children: stubSessionMethod("children", () => ({ data: [] as SdkSession[] })),
      messages: stubSessionMethod(
        "messages",
        (input: { path: { id: string }; query?: { directory?: string } }) => {
          const list = messageStore.get(input.path.id) ?? []
          return { data: list }
        },
      ),
      status: stubSessionMethod("status", () => ({ data: {} })),
    },
  }
}

function baseRequest(
  sdk: SeededFakeSdk,
  clock: Clock,
  overrides: Partial<{
    readonly waitBudgetMs: number
    readonly signal: AbortSignal
    readonly sessionStatus: () => Promise<{ readonly status: string } | undefined>
    readonly startupGraceMs: number
  }> = {},
) {
  return {
    sdk,
    jobID: FAKE_JOB_ID,
    childSessionID: CHILD_SESSION_ID,
    requestMessageID: REQUEST_MESSAGE_ID,
    directory: FAKE_DIRECTORY,
    waitBudgetMs: 50,
    clock,
    startupGraceMs: 10,
    ...overrides,
  }
}

async function advanceClockTo(
  clock: Clock & { advance(ms: number): void },
  budgetMs: number,
): Promise<void> {
  // Advance one millisecond at a time, yielding each step so the observer has
  // a chance to register its next poll sleeper before we jump past it.
  const target = clock.now() + budgetMs
  while (clock.now() < target) {
    await Promise.resolve()
    clock.advance(1)
  }
}

async function runObservation(
  sdk: SeededFakeSdk,
  clock: Clock & { advance(ms: number): void },
  overrides: Parameters<typeof baseRequest>[2] = {},
): Promise<ObservationOutcome> {
  const req = baseRequest(sdk, clock, overrides)
  const promise = observeDispatch(req)
  await advanceClockTo(clock, req.waitBudgetMs)
  return await promise
}

function createCustomSdk(
  messages: (input: { path: { id: string }; query?: { directory?: string } }) => Promise<LocalSdkResult<ReadonlyArray<SdkMessageWithParts>>>,
): DispatchSdk {
  return {
    session: {
      create: async () => ({ data: { id: "ses_custom" } as SdkSession }),
      prompt: async () => ({ data: undefined }),
      promptAsync: async () => ({ data: undefined }),
      abort: async () => ({ data: true }),
      get: async () => ({ data: undefined }),
      children: async () => ({ data: [] as SdkSession[] }),
      messages,
      status: async () => ({ data: {} }),
    },
  } as DispatchSdk
}

function createRealisticClock(startMs = 0): Clock & { advance(ms: number): void } {
  let now = startMs
  const sleepers = new Set<{ deadline: number; resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> | null }>()
  return {
    now: () => now,
    sleep: (ms, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"))
      }
      if (ms <= 0) {
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const entry: { deadline: number; resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> | null } = {
          deadline: now + ms,
          resolve,
          reject,
          timer: null,
        }
        sleepers.add(entry)
        entry.timer = setTimeout(() => {
          sleepers.delete(entry)
          now += ms
          resolve()
        }, ms)
        if (signal) {
          signal.addEventListener("abort", () => {
            if (entry.timer !== null) clearTimeout(entry.timer)
            sleepers.delete(entry)
            reject(new DOMException("aborted", "AbortError"))
          }, { once: true })
        }
      })
    },
    advance: (ms) => {
      now += ms
      for (const entry of [...sleepers]) {
        if (entry.deadline <= now && entry.timer !== null) {
          clearTimeout(entry.timer)
          sleepers.delete(entry)
          entry.resolve()
        }
      }
    },
  }
}

function createCountingClock(startMs = 0): Clock & { advance(ms: number): void; readonly pendingSleepCount: number } {
  let now = startMs
  const sleepers = new Set<{ deadline: number; resolve: () => void; reject: (err: Error) => void }>()
  return {
    now: () => now,
    sleep: (ms, signal) => {
      if (signal?.aborted) {
        return Promise.reject(new DOMException("aborted", "AbortError"))
      }
      return new Promise<void>((resolve, reject) => {
        const entry = { deadline: now + ms, resolve, reject }
        sleepers.add(entry)
        if (signal) {
          signal.addEventListener("abort", () => {
            sleepers.delete(entry)
            reject(new DOMException("aborted", "AbortError"))
          }, { once: true })
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
    get pendingSleepCount() {
      return sleepers.size
    },
  }
}

describe("extractUsableText", () => {
  it("joins non-ignored, non-synthetic text parts and trims", () => {
    expect(extractUsableText([makeText("hello"), makeText("world")])).toBe("hello\nworld")
    expect(extractUsableText([makeText("  spaced  ")])).toBe("spaced")
  })

  it("drops ignored or synthetic parts", () => {
    expect(extractUsableText([makeText("keep"), makeText("drop", { ignored: true })])).toBe("keep")
    expect(extractUsableText([makeText("drop", { synthetic: true }), makeText("keep")])).toBe("keep")
  })

  it("returns undefined for empty, blank or missing parts", () => {
    expect(extractUsableText([])).toBeUndefined()
    expect(extractUsableText([makeText("   ")])).toBeUndefined()
    expect(extractUsableText(undefined as unknown as SdkTextPart[])).toBeUndefined()
    expect(extractUsableText(null as unknown as SdkTextPart[])).toBeUndefined()
  })
})

describe("observeDispatch", () => {
  for (const budget of [0, 20]) {
    it(`rollback-6 cancels local messages waiting without signalling SDK budget ${budget}`, async () => {
      // Given an in-flight SDK read controlled independently of local waiting.
      const sdk = createSeededFakeSdk()
      const controller = new AbortController()
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<LocalSdkResult<ReadonlyArray<SdkMessageWithParts>>>()
      let transportSignal: AbortSignal | undefined
      sdk.session.messages = async (input) => {
        const candidate = "signal" in input ? input.signal : undefined
        if (candidate instanceof AbortSignal) {
          transportSignal = candidate
          candidate.addEventListener("abort", () => released.reject(new DOMException("aborted", "AbortError")), { once: true })
        }
        entered.resolve()
        return released.promise
      }
      // When the caller aborts an active SDK read.
      const result = observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: budget, signal: controller.signal }))
      await entered.promise
      controller.abort()
      try {
        // Then cancellation stays local and never reaches SDK transport.
        expect(transportSignal).toBeUndefined()
        expect(await result).toMatchObject({ kind: "pending", diagnostics: { aborted: true } })
      } finally { released.resolve({ data: [] }) }
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
    })
  }
  for (const error of [{ name: "APIError", message: "SECRET_TOKEN_abc123", statusCode: 429 }, { name: "APIError", data: { message: "SECRET_TOKEN_nested", statusCode: 429 } }, new Error("SECRET_TOKEN_xyz"), "SECRET_TOKEN_qrs", { name: "SECRET_TOKEN_name", message: "SECRET_TOKEN_message" }]) {
    for (const route of ["helper", "read", "assistant"] as const) {
      it(`round2-5 redacts ${typeof error} on ${route} path ${errorText(error)}`, async () => {
        // Given credentials embedded inside normally forwarded fields.
        const sdk = createSeededFakeSdk()
        if (route === "read") sdk.setMessagesFailure(error)
        if (route === "assistant") sdk.seedMessages(CHILD_SESSION_ID, [makeMessage(makeAssistant("msg-error", { time: { created: 0, completed: 1 }, error }), [])])
        // When converting the error at the public diagnostic boundary.
        const result = route === "helper" ? errorText(error) : await observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: 0 }))
        const text = typeof result === "string" ? result : result.kind === "failed" ? result.error : result.kind === "unknown" ? result.reason : ""
        // Then only recognized tags and numeric status can survive.
        expect(text).not.toContain("SECRET_TOKEN")
        if (typeof error === "object" && "name" in error && error.name === "APIError") {
          expect(text).toContain("APIError")
          expect(text).toContain("429")
        } else expect(text).toBe("unrecognized provider error")
      })
    }
  }
  it("fix-3 removes caller relay listeners when successful reads settle normally", async () => {
    // Given a final result and the same caller signal reused across observations.
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock()
    const controller = new AbortController()
    sdk.seedMessages(CHILD_SESSION_ID, [makeMessage(makeAssistant("msg-final", { finish: "stop", time: { created: 0, completed: 1 } }), [makeText("done")])])
    // When several successful bounded reads settle without caller abort.
    for (let i = 0; i < 3; i++) await observeDispatch(baseRequest(sdk, clock, { signal: controller.signal }))
    // Then no read relays remain registered on the caller signal.
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  })

  it("fix-4 distinguishes a rejected status probe from successful missing status", async () => {
    // Given identical empty sessions within startup grace.
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock()
    const missing = await observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 0, sessionStatus: async () => undefined }))
    // When the status query rejects instead of returning no data.
    const failed = await observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 0, sessionStatus: async () => { throw new Error("status transport failed") } }))
    // Then the nonterminal outcome is unchanged but diagnostics distinguish failure.
    expect(failed.kind).toBe("pending")
    expect(failed).not.toEqual(missing)
  })

  for (const route of ["read", "assistant", "helper"] as const) {
    it(`fix-6 redacts arbitrary structured payload fields on the ${route} error path`, async () => {
      // Given a verbose SDK payload with allowlisted diagnostics and private metadata.
      const error = { name: "APIError", message: "provider unavailable", statusCode: 503, headers: "PRIVATE_HEADERS", body: "PRIVATE_BODY", url: "PRIVATE_URL", prompt: "PRIVATE_PROMPT", source: "PRIVATE_SOURCE", metadata: "PRIVATE_META", request: "PRIVATE_REQUEST", response: "PRIVATE_RESPONSE", token: "PRIVATE_TOKEN" }
      const sdk = createSeededFakeSdk()
      if (route === "read") sdk.setMessagesFailure(error)
      if (route === "assistant") sdk.seedMessages(CHILD_SESSION_ID, [makeMessage(makeAssistant("msg-error", { time: { created: 0, completed: 1 }, error }), [])])
      // When converting the error into diagnostic text.
      const result = route === "helper" ? errorText(error) : await observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: 0 }))
      const text = typeof result === "string" ? result : result.kind === "failed" ? result.error : result.kind === "unknown" ? result.reason : ""
      // Then only allowlisted fields reach the caller.
      expect(text).toContain("APIError")
      expect(text).toContain("503")
      expect(text).not.toContain("PRIVATE_")
    })
  }

  for (const error of ["429 rate limited", { message: "429 rate limited" }]) {
    it(`fix-8 retries compatible ${typeof error} errors when structured retryability is absent`, async () => {
      // Given a completed error with explicit compatible text but no structured flag.
      const sdk = createSeededFakeSdk()
      sdk.seedMessages(CHILD_SESSION_ID, [makeMessage(makeAssistant("msg-error", { time: { created: 0, completed: 1 }, error }), [])])
      // When classifying the error.
      const result = await observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: 0 }))
      // Then compatibility retryability is reachable.
      expect(result).toMatchObject({ kind: "failed", retryable: true })
    })
  }

  it("fix-8 preserves explicit false retryability despite compatible error text", async () => {
    // Given an authoritative host flag contradicting the text compatibility fallback.
    const sdk = createSeededFakeSdk()
    sdk.seedMessages(CHILD_SESSION_ID, [makeMessage(makeAssistant("msg-error", { time: { created: 0, completed: 1 }, error: { name: "APIError", data: { message: "429 rate limited", isRetryable: false } } }), [])])
    // When classifying.
    const result = await observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: 0 }))
    // Then explicit false remains authoritative.
    expect(result).toMatchObject({ kind: "failed", retryable: false })
  })

  for (const status of ["running", "pending"] as const) {
    it(`fix-9 does not complete a stop message when a real SDK tool part is ${status}`, async () => {
      // Given a ToolPart from the real SDK union; finish/completed impose no type restriction.
      const tool: ToolPart = { id: "prt-tool", messageID: "msg-final", sessionID: CHILD_SESSION_ID, type: "tool", tool: "read", callID: "call-1", state: status === "running" ? { status, input: {}, time: { start: 0 } } : { status, input: {}, raw: "" } }
      const sdk = createSeededFakeSdk()
      const info = makeAssistant("msg-final", { finish: "stop", time: { created: 0, completed: 1 } })
      const messages = [{ info, parts: [makeText("report"), tool] }]
      sdk.session.messages = async () => ({ data: messages })
      // When observing the final step.
      const result = await observeDispatch(baseRequest(sdk, createFakeClock(), { waitBudgetMs: 0 }))
      // Then unfinished tool work blocks report credit.
      expect(result.kind).toBe("pending")
    })
  }
  it("returns completed with the newest final stop text, ignoring tool steps and unrelated messages", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeUserMessage("msg-other-user", CHILD_SESSION_ID),
      makeMessage(makeAssistant("msg-tool", { time: { created: 1000, completed: 1500 }, finish: "tool-calls" }), [
        makeText("intermediate tool result"),
      ]),
      makeMessage(makeAssistant("msg-active", { time: { created: 2000 } }), [makeText("thinking...")]),
      makeMessage(
        makeAssistant("msg-final", { time: { created: 3000, completed: 3500 }, finish: "stop" }),
        [makeText("final report")],
      ),
      // Unrelated session/parentID
      makeMessage(
        makeAssistant("msg-wrong-parent", { parentID: "msg-other", time: { created: 4000, completed: 4500 }, finish: "stop" }),
        [makeText("wrong")],
      ),
      makeMessage(
        { ...makeAssistant("msg-wrong-session", { time: { created: 5000, completed: 5500 }, finish: "stop" }), sessionID: "ses_other" },
        [makeText("wrong session")],
      ),
      // Synthetic/ignored journal text in matching step must not poison text
      makeMessage(makeAssistant("msg-final", { time: { created: 3000, completed: 3500 }, finish: "stop" }), [
        makeText("final report"),
        makeText("journal", { synthetic: true, ignored: true }),
      ]),
    ])

    const result = await runObservation(sdk, clock)

    expect(result).toEqual({ kind: "completed", text: "final report" })
    expect(sdk.calls.filter((c) => c.method === "messages").length).toBe(1)
    expect(sdk.calls.some((c) => c.method === "abort")).toBe(false)
    for (const call of sdk.calls) {
      if (typeof call.input === "object" && call.input !== null && "query" in call.input) {
        expect((call.input as { query: { directory?: string } }).query.directory).toBe(FAKE_DIRECTORY)
      }
    }
  })

  it("yields pending when the newest matching step is an active tool-calls step", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-tool", { time: { created: 1000, completed: 1500 }, finish: "tool-calls" }), [
        makeText("intermediate"),
      ]),
      makeMessage(makeAssistant("msg-active", { time: { created: 2000 } }), [makeText("still working")]),
    ])

    const result = await runObservation(sdk, clock)

    expect(result.kind).toBe("pending")
    expect(sdk.calls.filter((c) => c.method === "messages").length).toBeGreaterThanOrEqual(2)
  })

  it("yields pending when a completed tool-calls step is followed by a newer active step at expiry", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-tool", { time: { created: 1000, completed: 1500 }, finish: "tool-calls" }), [
        makeText("intermediate text"),
      ]),
      makeMessage(makeAssistant("msg-active", { time: { created: 2000 } }), [makeText("still active")]),
    ])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 10 })

    expect(result.kind).toBe("pending")
  })

  it("does not credit intermediate text with a completed time as success", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-intermediate", { time: { created: 1000, completed: 1500 }, finish: "tool-calls" }), [
        makeText("looks final but is not"),
      ]),
    ])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 10 })

    expect(result.kind).not.toBe("completed")
  })

  it("returns unknown for a final length finish", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-length", { time: { created: 1000, completed: 1500 }, finish: "length" }), [
        makeText("partial"),
      ]),
    ])

    const result = await runObservation(sdk, clock)

    expect(result.kind).toBe("unknown")
  })

  it("returns unknown when finish is absent on a completed message", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-no-finish", { time: { created: 1000, completed: 1500 } }), [makeText("text")]),
    ])

    const result = await runObservation(sdk, clock)

    expect(result.kind).toBe("unknown")
  })

  it("classifies MessageAbortedError with completed time as cancelled even with partial text", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(
        makeAssistant("msg-abort", {
          time: { created: 1000, completed: 1500 },
          finish: "stop",
          error: { name: "MessageAbortedError", data: { message: "aborted" } },
        }),
        [makeText("partial text")],
      ),
    ])

    const result = await runObservation(sdk, clock)

    expect(result).toEqual({ kind: "cancelled" })
  })

  it("classifies ApiError as failed and exposes retryability", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(
        makeAssistant("msg-error", {
          time: { created: 1000, completed: 1500 },
          error: { name: "APIError", data: { message: "payment required", statusCode: 402, isRetryable: true } },
        }),
        [makeText("partial")],
      ),
    ])

    const result = await runObservation(sdk, clock)

    expect(result.kind).toBe("failed")
    if (result.kind === "failed") {
      expect(result.retryable).toBe(true)
    }
  })

  it("returns pending for busy/retry session status without final evidence", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const result = await runObservation(
      sdk,
      clock,
      {
        waitBudgetMs: 20,
        sessionStatus: async () => ({ status: "busy" }),
      },
    )

    expect(result.kind).toBe("pending")
    if (result.kind === "pending") {
      expect(result.diagnostics?.status).toBe("busy")
    }
  })

  it("returns pending within startup grace when no assistant message exists", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 9 })

    expect(result.kind).toBe("pending")
  })

  it("returns unknown after startup grace with no liveness signal", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 11 })

    expect(result.kind).toBe("unknown")
  })

  it("returns unknown when the session status is idle after startup grace", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const result = await runObservation(
      sdk,
      clock,
      {
        waitBudgetMs: 11,
        sessionStatus: async () => ({ status: "idle" }),
      },
    )

    expect(result.kind).toBe("unknown")
  })

  it("returns unknown when get returns nothing (missing session) and grace expired", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 11 })

    expect(result.kind).toBe("unknown")
    expect(result.kind === "failed" || (result.kind === "unknown" && result.reason.length > 0)).toBe(true)
  })

  it("returns unknown with reason on messages transport rejection and ends cleanly", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.setMessagesFailure(new Error("network down"))

    const result = await runObservation(sdk, clock)

    expect(result.kind).toBe("unknown")
    if (result.kind === "unknown") {
      expect(result.reason).toBe("unrecognized provider error")
    }
    expect(sdk.calls.filter((c) => c.method === "messages").length).toBe(1)
  })

  it("reads immediately, polls at 2000ms, and does a final read at expiry", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const promise = observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: POLL_INTERVAL_MS + 10 }))
    await advanceClockTo(clock, POLL_INTERVAL_MS + 10)
    await promise

    const messagesCalls = sdk.calls.filter((c) => c.method === "messages")
    expect(messagesCalls.length).toBe(3) // t=0, t=POLL_INTERVAL, t=expiry
  })

  it("short-circuits before window expiry on completed result and makes no extra polls", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-final", { time: { created: 1000, completed: 1500 }, finish: "stop" }), [
        makeText("done"),
      ]),
    ])

    const result = await runObservation(sdk, clock, { waitBudgetMs: 100 })

    expect(result).toEqual({ kind: "completed", text: "done" })
    expect(sdk.calls.filter((c) => c.method === "messages").length).toBe(1)
  })

  it("disposes timers so advancing clock after expiry resolves no pending sleepers", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const promise = observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 10 }))
    await Promise.resolve()
    clock.advance(10)
    await promise

    let woke = false
    const sleeper = clock.sleep(1_000)
    sleeper.then(() => {
      woke = true
    })
    clock.advance(1_000)
    await sleeper
    expect(woke).toBe(true) // sanity: clock still works

    // After the observer returned, there should be no leftover sleeper that
    // fires on a subsequent advance. We verify by ensuring no stray calls.
    const before = sdk.calls.length
    clock.advance(10_000)
    expect(sdk.calls.length).toBe(before)
  })

  it("returns pending with aborted diagnostic when req.signal aborts mid-observation", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)
    const controller = new AbortController()

    sdk.seedMessages(CHILD_SESSION_ID, [])

    const promise = observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 100, signal: controller.signal }))
    await Promise.resolve()
    clock.advance(POLL_INTERVAL_MS / 2)
    controller.abort()
    await Promise.resolve()
    clock.advance(POLL_INTERVAL_MS)

    const result = await promise

    expect(result).toEqual({ kind: "pending", diagnostics: { aborted: true } })
    expect(sdk.calls.some((c) => c.method === "abort")).toBe(false)
  })

  it("classifies hostile message shapes without crashing", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-null-parts", { time: { created: 1000, completed: 1500 }, finish: "stop" }), null as unknown as SdkTextPart[]),
      makeMessage(makeAssistant("msg-missing-time", {} as SdkAssistantMessage), [makeText("x")]),
      makeMessage(makeAssistant("msg-unknown-finish", { time: { created: 2000, completed: 2500 }, finish: "weird" }), [makeText("x")]),
      makeMessage(
        makeAssistant("msg-plain-error", {
          time: { created: 3000, completed: 3500 },
          error: "plain string error",
        }),
        [makeText("x")],
      ),
    ])

    const result = await runObservation(sdk, clock)

    // Newest is the plain-error message; plain string errors classify as failed.
    expect(result.kind).toBe("failed")
  })

  it("D1: cancels the in-flight timeout sleeper when the read wins", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createCountingClock(0)

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-final", { time: { created: 1000, completed: 2000 }, finish: "stop" }), [makeText("done")]),
    ])

    const outcome = await observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 50 }))

    expect(outcome).toEqual({ kind: "completed", text: "done" })
    expect(clock.pendingSleepCount).toBe(0)
  })

  it("D1: does not leak an unhandled rejection when the SDK read rejects after the timeout wins", async () => {
    let rejectMessages: (err: Error) => void = () => {}
    const sdk = createCustomSdk(() => new Promise((_, reject) => {
      rejectMessages = reject
    }))
    const clock = createRealisticClock(0)

    const promise = observeDispatch({
      ...baseRequest(sdk as unknown as SeededFakeSdk, clock, { waitBudgetMs: 50, startupGraceMs: 10 }),
    })
    clock.advance(50)
    const outcome = await promise

    expect(outcome.kind).toBe("unknown")

    rejectMessages(new Error("late transport failure"))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  it("D1: does not leak an unhandled rejection when the read wins and the signal aborts the sleep", async () => {
    const sdk = createSeededFakeSdk()
    const clock = createFakeClock(0)
    const controller = new AbortController()

    sdk.seedMessages(CHILD_SESSION_ID, [
      makeMessage(makeAssistant("msg-active", { time: { created: 1000 } }), [makeText("working")]),
    ])

    const promise = observeDispatch(baseRequest(sdk, clock, { waitBudgetMs: 100, signal: controller.signal }))
    await Promise.resolve()
    controller.abort()

    const outcome = await promise
    expect(outcome).toEqual({ kind: "pending", diagnostics: { aborted: true } })
  })

  it("D2: returns pending when the final read times out after observing durable progress", async () => {
    let calls = 0
    const sdk = createCustomSdk(async () => {
      calls++
      if (calls === 1) {
        return {
          data: [makeMessage(makeAssistant("msg-active", { time: { created: 1000 } }), [makeText("still working")])],
        }
      }
      return new Promise(() => {})
    })
    const clock = createRealisticClock(0)

    const outcome = await observeDispatch({
      ...baseRequest(sdk as unknown as SeededFakeSdk, clock, { waitBudgetMs: 50, startupGraceMs: 10 }),
    })

    expect(outcome.kind).toBe("pending")
  })

  it("D2: waitBudgetMs=0 performs one snapshot read and classifies its result", async () => {
    const sdk = createCustomSdk(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return {
        data: [makeMessage(makeAssistant("msg-final", { time: { created: 1000, completed: 2000 }, finish: "stop" }), [makeText("snapshot result")])],
      }
    })
    const clock = createRealisticClock(0)

    const outcome = await observeDispatch({
      ...baseRequest(sdk as unknown as SeededFakeSdk, clock, { waitBudgetMs: 0, startupGraceMs: 10 }),
    })

    expect(outcome).toEqual({ kind: "completed", text: "snapshot result" })
  })

  it("D2: returns pending when the final read times out after a tool-calls step", async () => {
    let calls = 0
    const sdk = createCustomSdk(async () => {
      calls++
      if (calls === 1) {
        return {
          data: [makeMessage(makeAssistant("msg-tool", { time: { created: 1000, completed: 1500 }, finish: "tool-calls" }), [makeText("tool output")])],
        }
      }
      return new Promise(() => {})
    })
    const clock = createRealisticClock(0)

    const outcome = await observeDispatch({
      ...baseRequest(sdk as unknown as SeededFakeSdk, clock, { waitBudgetMs: 50, startupGraceMs: 10 }),
    })

    expect(outcome.kind).toBe("pending")
  })

  it("round3-H reports a non-abort clock failure as unknown, never aborted", async () => {
    const sdk = createSeededFakeSdk()
    let sleepCalls = 0
    const clock: Clock = {
      now: () => 0,
      sleep: () => {
        sleepCalls++
        if (sleepCalls >= 2) return Promise.reject(new Error("clock hardware failure"))
        return new Promise(() => {})
      },
    }
    sdk.seedMessages(CHILD_SESSION_ID, [])
    const outcome = await observeDispatch({ ...baseRequest(sdk, clock, { waitBudgetMs: 20, startupGraceMs: 10 }) })
    expect(outcome.kind).toBe("unknown")
    if (outcome.kind === "unknown") expect(outcome.reason).toContain("clock failed")
  })
})
