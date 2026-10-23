import { describe, expect, it } from "bun:test"

import {
  PRODUCTION_WAIT_BUDGET_MS,
  parseOutcomeEnvelope,
  type Clock,
  type DispatchEnvelope,
  type KeyedMutex,
  type SdkAssistantMessage,
  type SdkMessageWithParts,
  type SdkTextPart,
} from "./dispatch-contract.ts"
import {
  createFakeClock,
  createFakeSdk,
  FAKE_DIRECTORY,
  FAKE_PARENT_ID,
  validRoleSpecs,
  type FakeSdk,
} from "./dispatch-test-fixtures.ts"
import { createDispatchLifecycle, createSystemClock } from "./dispatch-lifecycle.ts"
import { appendRecord, createJob } from "./dispatch-journal.ts"
import { createDispatchCancel } from "./dispatch-cancel.ts"
import { createKeyedMutex } from "./dispatch-contract.ts"

function textPart(text: string): SdkTextPart {
  return { type: "text", text }
}

function completedAssistantMessage(
  requestMessageID: string,
  text: string,
  overrides: Partial<SdkAssistantMessage> = {},
): SdkMessageWithParts {
  return {
    info: {
      id: "msg-reply",
      sessionID: "ignored",
      role: "assistant",
      parentID: requestMessageID,
      time: { created: 0, completed: 0 },
      modelID: "m",
      providerID: "p",
      finish: "stop",
      ...overrides,
    } as SdkAssistantMessage,
    parts: [textPart(text)],
  }
}

function lastPromptAsyncCall(fake: FakeSdk): { input: { path: { id: string }; body: { messageID?: string; agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[] } } } {
  const calls = fake.calls.filter((c) => (c as { method: string }).method === "promptAsync")
  const last = calls[calls.length - 1] as { input: { path: { id: string }; body: { messageID?: string; agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[] } } }
  return last
}

function promptAsyncCount(fake: FakeSdk): number {
  return fake.calls.filter((c) => (c as { method: string }).method === "promptAsync").length
}

function abortCount(fake: FakeSdk): number {
  return fake.calls.filter((c) => (c as { method: string }).method === "abort").length
}

function createAutoCompletingFake(responseText: string, clock: Clock = createFakeClock()): FakeSdk {
  const fake = createFakeSdk()
  const base = fake.session.promptAsync.bind(fake.session)
  fake.session.promptAsync = async (input) => {
    const result = await base(input)
    const requestMessageID = input.body.messageID!
    const sessionID = input.path.id
    fake.seedMessages(sessionID, [
      completedAssistantMessage(requestMessageID, responseText, {
        sessionID,
        id: `msg-reply-${sessionID}`,
        time: { created: clock.now(), completed: clock.now() },
      }),
    ])
    return result
  }
  return fake
}

function createPendingFake(): FakeSdk {
  const fake = createFakeSdk()
  fake.setPromptAsyncResult({ data: undefined })
  return fake
}

function parseEnvelope(json: string) {
  const parsed = parseOutcomeEnvelope(json)
  if (!parsed.ok) throw new Error(`expected envelope: ${parsed.error.message}`)
  return parsed.value as DispatchEnvelope
}

async function advanceClockAfterTick(clock: Clock & { advance(ms: number): void }, ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  clock.advance(ms)
}

describe("launch success", () => {
  it("round2-3 preserves created root identity when spec persistence fails", async () => {
    // Given root creation succeeds but the host rejects the spec write.
    const fake = createFakeSdk()
    fake.session.prompt = async () => ({ error: new Error("spec rejected") })
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
    // When launching the job.
    const output = await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 })
    // Then the actual partial root remains discoverable without generation.
    expect(output).toContain("job_id=ses_fake_1")
    expect(promptAsyncCount(fake)).toBe(0)
  })
  it("generates attempt 0 in the job root session without creating an attempt child", async () => {
    const clock = createFakeClock()
    const fake = createAutoCompletingFake("root result", clock)
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    const result = await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    expect(result).toBe("root result")
    const creates = fake.calls.filter((c) => (c as { method: string }).method === "create")
    expect(creates).toHaveLength(1)
    const rootCreate = creates[0] as { input: { body: { title: string; parentID: string } } }
    expect(rootCreate.input.body.title).toBe("[consultation-dispatch:v1] analyst")
    expect(rootCreate.input.body.parentID).toBe(FAKE_PARENT_ID)
    const asyncCall = lastPromptAsyncCall(fake)
    expect(asyncCall.input.path.id).toBe("ses_fake_1")
    expect(asyncCall.input.body.agent).toBe("consultation-analyst")
  })
  for (const age of [0, 20000]) {
    it(`uses durable reservation age ${age} when waiting without messages`, async () => {
      // Given a reserved attempt whose host has no assistant progress.
      const clock = createFakeClock()
      const fake = createPendingFake()
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
      const launched = parseEnvelope(await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      fake.seedMessages(launched.session_id, [])
      clock.advance(age)
      // When a snapshot recovers the attempt after elapsed durable time.
      const result = parseEnvelope(await lifecycle.wait({ jobID: launched.job_id, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      // Then fresh work retains grace and old missing work is unknown.
      expect(result.status).toBe(age === 0 ? "pending" : "unknown")
    })
  }
  it("uses globally unique host message IDs when launching across root and child sessions", async () => {
    // Given: record every host message ID at the SDK boundary, across both sessions.
    const clock = createFakeClock()
    const fake = createAutoCompletingFake("done", clock)
    const messageIDs: Array<string | undefined> = []
    const prompt = fake.session.prompt.bind(fake.session)
    const promptAsync = fake.session.promptAsync.bind(fake.session)
    fake.session.prompt = async (input) => {
      messageIDs.push(input.body.messageID)
      return prompt(input)
    }
    fake.session.promptAsync = async (input) => {
      messageIDs.push(input.body.messageID)
      return promptAsync(input)
    }
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    // When: a launch journals the job, reservation and receipt, then submits the request.
    const result = await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    // Then: all four host writes have distinct IDs and the correlated response is returned.
    expect(result).toBe("done")
    expect(messageIDs).toHaveLength(4)
    expect(messageIDs).not.toContain(undefined)
    expect(new Set(messageIDs).size).toBe(messageIDs.length)
  })

  for (const { label, role, record } of validRoleSpecs) {
    it(`${label}: returns plain text, uses promptAsync once, zero aborts`, async () => {
      const clock = createFakeClock()
      const fake = createAutoCompletingFake(`${label} result`, clock)
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

      const result = await lifecycle.launch({
        role,
        prompt: "do the work",
        agentName: record.agent_name,
        modelChain: record.model_chain,
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        waitMs: 1_000,
      })

      expect(result).toBe(`${label} result`)
      expect(promptAsyncCount(fake)).toBe(1)
      expect(abortCount(fake)).toBe(0)

      const call = lastPromptAsyncCall(fake)
      expect(call.input.body.agent).toBe(record.agent_name)
      expect(call.input.body.parts).toEqual([{ type: "text", text: "do the work" }])
      if (record.model_chain[0] === null) {
        expect(call.input.body.model).toBeUndefined()
      } else {
        const [providerID, modelID] = record.model_chain[0]!.split("/")
        expect(call.input.body.model).toEqual({ providerID: providerID!, modelID: modelID! })
      }
    })
  }
})

describe("soft wait expiry and recovery", () => {
  for (const { label, role, record } of validRoleSpecs) {
    it(`${label}: pending envelope on expiry, later wait retrieves report without new launch`, async () => {
      const clock = createFakeClock()
      const fake = createPendingFake()
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

      const launchPromise = lifecycle.launch({
        role,
        prompt: "do the work",
        agentName: record.agent_name,
        modelChain: record.model_chain,
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        waitMs: 50,
        startupGraceMs: 10,
      })
      await advanceClockAfterTick(clock, 50)
      const launchResult = await launchPromise

      const envelope = parseEnvelope(launchResult)
      expect(envelope.status).toMatch(/pending|unknown/)
      expect(envelope.job_id).toMatch(/^ses_fake_/)
      expect(envelope.role).toBe(role)
      expect(envelope.attempt.index).toBe(0)
      expect(envelope.session_id).toMatch(/^ses_fake_/)
      expect(envelope.next).toBe("consultation_dispatch_wait")
      expect(promptAsyncCount(fake)).toBe(1)
      expect(abortCount(fake)).toBe(0)

      const call = lastPromptAsyncCall(fake)
      const requestMessageID = call.input.body.messageID!
      fake.seedMessages(envelope.session_id, [
        completedAssistantMessage(requestMessageID, `${label} recovered`, {
          sessionID: envelope.session_id,
          id: `msg-recovered-${envelope.session_id}`,
          time: { created: clock.now(), completed: clock.now() },
        }),
      ])

      const waitResult = await lifecycle.wait({
        jobID: envelope.job_id,
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        waitMs: 100,
      })

      expect(waitResult).toBe(`${label} recovered`)
      expect(promptAsyncCount(fake)).toBe(1)
      expect(abortCount(fake)).toBe(0)
    })
  }
})

describe("concurrent waits", () => {
  it("serialize on one job and reuse the same attempt", async () => {
    const clock = createFakeClock()
    const fake = createPendingFake()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    const launchPromise = lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
      startupGraceMs: 10,
    })
    await advanceClockAfterTick(clock, 50)
    const launchResult = await launchPromise
    const envelope = parseEnvelope(launchResult)

    const call = lastPromptAsyncCall(fake)
    const requestMessageID = call.input.body.messageID!
    fake.seedMessages(envelope.session_id, [
      completedAssistantMessage(requestMessageID, "shared result", {
        sessionID: envelope.session_id,
        id: `msg-shared-${envelope.session_id}`,
        time: { created: clock.now(), completed: clock.now() },
      }),
    ])

    const [first, second] = await Promise.all([
      lifecycle.wait({ jobID: envelope.job_id, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 100 }),
      lifecycle.wait({ jobID: envelope.job_id, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 100 }),
    ])

    expect(first).toBe("shared result")
    expect(second).toBe("shared result")
    expect(promptAsyncCount(fake)).toBe(1)
  })
})

describe("lost promptAsync acknowledgement", () => {
  for (const status of ["retry", "busy"] as const) {
    it(`round2-4 surfaces live ${status} when no matching message exists`, async () => {
      // Given a live status without durable assistant evidence.
      const fake = createFakeSdk()
      fake.setStatusResult({ data: { ses_fake_1: { type: status } } })
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
      // When taking a public snapshot.
      const result = parseEnvelope(await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      // Then status is diagnostic, not terminal evidence.
      expect(result.status).toBe("pending")
      expect(result.reason).toContain(status)
    })
  }
  it("fix-5 retains unknown job identity when promptAsync rejects null", async () => {
    // Given a valid job whose acknowledgement rejects with a primitive null.
    const fake = createFakeSdk()
    fake.setPromptAsyncRejection(null)
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
    // When launching.
    const result = await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 })
    // Then the secondary narrowing error cannot erase the recovery handle.
    expect(parseEnvelope(result)).toMatchObject({ status: "unknown", job_id: "ses_fake_1" })
  })

  it("fix-7 labels absent promptAsync capability as failure with job identity", async () => {
    // Given a host with the capability actually removed at runtime.
    const fake = createFakeSdk()
    Reflect.deleteProperty(fake.session, "promptAsync")
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
    // When launching after durable reservation and receipt creation.
    const result = await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 })
    // Then the missing capability is explicitly labeled (not "acknowledgement lost") and retains job identity.
    expect(result).toContain("capability unavailable")
    expect(result).toContain("job_id=ses_fake_1")
  })

  it("fix-4 preserves failed status-probe diagnostics in the public pending result", async () => {
    // Given no durable assistant evidence and a rejected status query.
    const fake = createFakeSdk()
    fake.session.status = async () => { throw new DOMException("transport aborted", "AbortError") }
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
    // When taking a snapshot inside startup grace.
    const result = parseEnvelope(await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
    // Then failure diagnostics survive observation adaptation without changing outcome.
    expect(result.status).toBe("pending")
    expect(result.reason).toContain("status probe failed")
  })
  it("returns unknown and never resends", async () => {
    const fake = createFakeSdk()
    fake.setPromptAsyncRejection(new Error("network response lost"))
    const clock = createFakeClock()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    const result = await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
    })

    const envelope = parseEnvelope(result)
    expect(envelope.status).toBe("unknown")
    expect(envelope.job_id).toMatch(/^ses_fake_/)
    expect(promptAsyncCount(fake)).toBe(1)

    const waitResult = await lifecycle.wait({
      jobID: envelope.job_id,
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 0,
      startupGraceMs: 0,
    })
    const waitEnvelope = parseEnvelope(waitResult)
    expect(waitEnvelope.status).toBe("unknown")
    expect(promptAsyncCount(fake)).toBe(1)
  })
})

describe("launch interrupted after reservation", () => {
  it("fix-2 fails closed when a newer reservation has no receipt after retryable failure", async () => {
    // Given attempt zero was submitted and failed retryably, then fallback reserved only.
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const launched = parseEnvelope(await lifecycle.launch({ role: "writer", prompt: "fixture", agentName: "writer", modelChain: ["p/primary", "p/backup"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
    const requestID = lastPromptAsyncCall(fake).input.body.messageID
    if (requestID === undefined) throw new Error("missing request ID")
    fake.seedMessages(launched.session_id, [completedAssistantMessage(requestID, "", { sessionID: launched.session_id, error: { name: "APIError", data: { isRetryable: true, message: "429 rate limited" } } })])
    const reserved = await appendRecord(fake, { jobID: launched.job_id, directory: FAKE_DIRECTORY, record: { v: 1, kind: "attempt-reservation", job_id: launched.job_id, attempt_index: 1, model: "p/backup", message_id: "msg-interrupted-backup", reserved_at: clock.now() } })
    if (!reserved.ok) throw reserved.error
    const before = promptAsyncCount(fake)
    // When the same job is waited again.
    const result = parseEnvelope(await lifecycle.wait({ jobID: launched.job_id, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
    // Then no second fallback reservation or generating request is permitted.
    expect(promptAsyncCount(fake)).toBe(before)
    expect(result.status).toBe("unknown")
  })
  it("wait returns unknown and does not launch a new attempt", async () => {
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const create = await createJob(fake, {
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      role: "analyst",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      prompt: "analyze",
      clock,
    })
    if (!create.ok) throw create.error
    const jobID = create.value.jobID
    const requestMessageID = "msg-reserved-1"
    const append = await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: {
        v: 1,
        kind: "attempt-reservation",
        job_id: jobID,
        attempt_index: 0,
        model: "opencode-go/qwen3.8-max",
        message_id: requestMessageID,
        reserved_at: clock.now(),
      },
      messageID: requestMessageID,
    })
    expect(append.ok).toBe(true)

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.wait({
      jobID,
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 10,
    })

    const envelope = parseEnvelope(result)
    expect(envelope.status).toBe("unknown")
    expect(promptAsyncCount(fake)).toBe(0)
  })
})

describe("unsupported promptAsync endpoint", () => {
  it("returns a capability-style failure that includes job identity", async () => {
    const fake = createFakeSdk()
    fake.setPromptAsyncError({ status: 404, message: "endpoint not found" })
    const clock = createFakeClock()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    const result = await lifecycle.launch({
      role: "explorer",
      prompt: "explore",
      agentName: "consultation-explorer",
      modelChain: ["opencode-go/deepseek-v4.1-flash"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
    })

    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("explorer dispatch failed")
    expect(result).not.toContain("endpoint not found")
    expect(result).toMatch(/job_id=ses_fake_\d+/)
    expect(promptAsyncCount(fake)).toBe(1)
    expect(abortCount(fake)).toBe(0)
  })
})

describe("synchronous provider-shaped launch failure", () => {
  it("appends the model-config remediation hint when promptAsync fails with a provider error", async () => {
    // Given a synchronous provider-shaped submission failure, e.g. the build
    // role's agent-missing case surfacing UnknownError at promptAsync time.
    const fake = createFakeSdk()
    fake.setPromptAsyncError({ name: "UnknownError", statusCode: 404 })
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })

    const result = await lifecycle.launch({
      role: "build",
      prompt: "code",
      agentName: "build",
      modelChain: [null],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
    })

    // Then the failure carries the §3.1 remediation hint with the role's
    // config field and path, alongside the job identity.
    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("build dispatch failed")
    expect(result).toContain("promptAsync failed: UnknownError: 404")
    expect(result).toContain('set "build_model"')
    expect(result).toContain("~/.config/consultation-agent/config.jsonc")
    expect(result).toMatch(/job_id=ses_fake_\d+/)
    expect(promptAsyncCount(fake)).toBe(1)
    expect(abortCount(fake)).toBe(0)
  })

  it("keeps journal-persistence launch failures hint-free", async () => {
    // Given the attempt-reservation journal write is rejected by the host
    // after the job spec persisted.
    const fake = createFakeSdk()
    const base = fake.session.prompt.bind(fake.session)
    let promptCalls = 0
    fake.session.prompt = async (input) => {
      promptCalls++
      if (promptCalls > 1) throw new Error("journal write rejected")
      return base(input)
    }
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })

    const result = await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
    })

    // Then the LaunchError surfaces with job identity but no remediation hint.
    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("analyst dispatch failed")
    expect(result).toContain("failed to persist attempt reservation")
    expect(result).toMatch(/job_id=ses_fake_\d+/)
    expect(result).not.toContain("Hint:")
    expect(result).not.toContain('set "analyst_model"')
    expect(promptAsyncCount(fake)).toBe(0)
  })
})

describe("context abort during observation", () => {
  for (const budget of [0, 20]) {
    it(`rollback-6 cancels local status waiting without signalling SDK budget ${budget}`, async () => {
      // Given an empty child and an in-flight status transport.
      const fake = createFakeSdk()
      const controller = new AbortController()
      const entered = Promise.withResolvers<void>()
      const released = Promise.withResolvers<Awaited<ReturnType<typeof fake.session.status>>>()
      let transportSignal: AbortSignal | undefined
      fake.session.status = async (input) => {
        const candidate = "signal" in input ? input.signal : undefined
        if (candidate instanceof AbortSignal) {
          transportSignal = candidate
          candidate.addEventListener("abort", () => released.reject(new DOMException("aborted", "AbortError")), { once: true })
        }
        entered.resolve()
        return released.promise
      }
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock: createFakeClock() })
      // When aborting during the status query rather than poll sleep.
      const output = lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: budget, signal: controller.signal })
      await entered.promise
      controller.abort()
      try {
        // Then local cancellation retains identity without signalling transport.
        expect(transportSignal).toBeUndefined()
        expect(parseEnvelope(await output)).toMatchObject({ status: "pending", job_id: "ses_fake_1", reason: "observation aborted" })
      } finally { released.resolve({ data: {} }) }
      expect(abortCount(fake)).toBe(0)
    })
  }
  it("returns a pending envelope and never calls session.abort", async () => {
    const clock = createFakeClock()
    const fake = createPendingFake()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const controller = new AbortController()

    const launchPromise = lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 0)
    const result = await launchPromise

    const envelope = parseEnvelope(result)
    expect(envelope.status).toBe("pending")
    expect(abortCount(fake)).toBe(0)
  })
})

describe("writer fallback", () => {
  it("advances the chain exactly once on a confirmed 402/429 retryable failure", async () => {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    let attempt = 0
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      attempt++
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      if (attempt === 1) {
        fake.seedMessages(sessionID, [
          {
            info: {
              id: `msg-fail-${sessionID}`,
              sessionID,
              role: "assistant",
              parentID: requestMessageID,
              time: { created: clock.now(), completed: clock.now() },
              modelID: "m",
              providerID: "p",
            } as SdkAssistantMessage,
            parts: [],
          },
          {
            info: {
              id: `msg-fail-err-${sessionID}`,
              sessionID,
              role: "assistant",
              parentID: requestMessageID,
              time: { created: clock.now() + 1, completed: clock.now() + 1 },
              modelID: "m",
              providerID: "p",
              error: { name: "APIError", data: { isRetryable: true, status: 402, message: "quota exhausted" } },
            } as SdkAssistantMessage,
            parts: [],
          },
        ])
      } else {
        fake.seedMessages(sessionID, [
          completedAssistantMessage(requestMessageID, "fallback succeeded", {
            sessionID,
            id: `msg-success-${sessionID}`,
            time: { created: clock.now(), completed: clock.now() },
          }),
        ])
      }
      return result
    }

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.launch({
      role: "writer",
      prompt: "write",
      agentName: "consultation-writer",
      modelChain: ["opencode/claude-sonnet-5", "opencode-go/kimi-k3"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    expect(result).toBe("fallback succeeded")
    expect(promptAsyncCount(fake)).toBe(2)
    const asyncs = fake.calls.filter((c) => (c as { method: string }).method === "promptAsync")
    expect((asyncs[0] as { input: { body: { model?: { modelID: string } } } }).input.body.model?.modelID).toBe("claude-sonnet-5")
    expect((asyncs[1] as { input: { body: { model?: { modelID: string } } } }).input.body.model?.modelID).toBe("kimi-k3")
    expect(abortCount(fake)).toBe(0)
  })

  it("keeps attempt 0 in the root and creates an attempt child only for the fallback", async () => {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    let attempt = 0
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      attempt++
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      if (attempt === 1) {
        fake.seedMessages(sessionID, [
          completedAssistantMessage(requestMessageID, "", {
            sessionID,
            id: `msg-fail-${sessionID}`,
            time: { created: clock.now(), completed: clock.now() },
            error: { name: "APIError", data: { isRetryable: true, status: 429, message: "rate limited" } },
          }),
        ])
      } else {
        fake.seedMessages(sessionID, [
          completedAssistantMessage(requestMessageID, "fallback succeeded", {
            sessionID,
            id: `msg-success-${sessionID}`,
            time: { created: clock.now(), completed: clock.now() },
          }),
        ])
      }
      return result
    }

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.launch({
      role: "writer",
      prompt: "write",
      agentName: "consultation-writer",
      modelChain: ["opencode/claude-sonnet-5", "opencode-go/kimi-k3"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    expect(result).toBe("fallback succeeded")
    const asyncs = fake.calls.filter((c) => (c as { method: string }).method === "promptAsync") as Array<{ input: { path: { id: string } } }>
    expect(asyncs).toHaveLength(2)
    expect(asyncs[0]!.input.path.id).toBe("ses_fake_1")
    expect(asyncs[1]!.input.path.id).toBe("ses_fake_2")
    const creates = fake.calls.filter((c) => (c as { method: string }).method === "create") as Array<{ input: { body: { title: string } } }>
    expect(creates).toHaveLength(2)
    expect(creates[1]!.input.body.title).toBe("[consultation-dispatch:v1] attempt writer")
    expect(abortCount(fake)).toBe(0)
  })

  it("does not advance on pending or unknown", async () => {
    const clock = createFakeClock()
    const fake = createPendingFake()
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })

    const launchPromise = lifecycle.launch({
      role: "writer",
      prompt: "write",
      agentName: "consultation-writer",
      modelChain: ["opencode/claude-sonnet-5", "opencode-go/kimi-k3"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
      startupGraceMs: 10,
    })
    await advanceClockAfterTick(clock, 50)
    const result = await launchPromise

    const envelope = parseEnvelope(result)
    expect(envelope.status).toMatch(/pending|unknown/)
    expect(promptAsyncCount(fake)).toBe(1)
  })

  it("exhausts the chain and reports every model tried", async () => {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      fake.seedMessages(sessionID, [
        {
          info: {
            id: `msg-err-${sessionID}`,
            sessionID,
            role: "assistant",
            parentID: requestMessageID,
            time: { created: clock.now(), completed: clock.now() },
            modelID: "m",
            providerID: "p",
            error: { name: "APIError", data: { isRetryable: true, status: 429, message: "rate limited" } },
          } as SdkAssistantMessage,
          parts: [],
        },
      ])
      return result
    }

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.launch({
      role: "writer",
      prompt: "write",
      agentName: "consultation-writer",
      modelChain: ["opencode/claude-sonnet-5", "opencode-go/kimi-k3"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("opencode/claude-sonnet-5")
    expect(result).toContain("opencode-go/kimi-k3")
    expect(result).toContain("degrade")
    expect(promptAsyncCount(fake)).toBe(2)
  })
})

describe("non-writer role failure", () => {
  it("does not fall back", async () => {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      fake.seedMessages(sessionID, [
        {
          info: {
            id: `msg-err-${sessionID}`,
            sessionID,
            role: "assistant",
            parentID: requestMessageID,
            time: { created: clock.now(), completed: clock.now() },
            modelID: "m",
            providerID: "p",
            error: { name: "APIError", data: { isRetryable: true, status: 429, message: "rate limited" } },
          } as SdkAssistantMessage,
          parts: [],
        },
      ])
      return result
    }

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 1_000,
    })

    expect(result.startsWith("Error:")).toBe(true)
    expect(result).toContain("analyst dispatch failed")
    expect(promptAsyncCount(fake)).toBe(1)
  })
})

describe("recovery through a fresh coordinator", () => {
  for (const lookup of ["missing", "wrong-parent", "wrong-workspace"] as const) {
    it(`round2-7 uses uniform unavailable output when ${lookup}`, async () => {
      // Given a real owned job and an invalid recovery context.
      const fake = createFakeSdk()
      const clock = createFakeClock()
      const mutex = createKeyedMutex()
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock, mutex })
      const launched = parseEnvelope(await lifecycle.launch({ role: "analyst", prompt: "fixture", agentName: "analyst", modelChain: ["p/m"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      const request = { jobID: lookup === "missing" ? "ses_missing" : launched.job_id, parentID: lookup === "wrong-parent" ? "ses_foreign" : FAKE_PARENT_ID, directory: lookup === "wrong-workspace" ? "/foreign" : FAKE_DIRECTORY }
      // When both recovery surfaces receive the same invalid lookup.
      const waited = await lifecycle.wait({ ...request, waitMs: 0 })
      const cancelled = await createDispatchCancel({ sdk: fake, clock, mutex }).cancel(request)
      // Then neither reveals identity or ownership details.
      expect(waited).toBe(cancelled)
      expect(waited).toBe("Error: consultation dispatch unavailable")
    })
  }
  it("recovers a completed result without a new promptAsync", async () => {
    const clock = createFakeClock()
    const fake = createPendingFake()
    const first = createDispatchLifecycle({ sdk: fake, clock })

    const launchPromise = first.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 50,
      startupGraceMs: 10,
    })
    await advanceClockAfterTick(clock, 50)
    const launchResult = await launchPromise
    const envelope = parseEnvelope(launchResult)

    const call = lastPromptAsyncCall(fake)
    const requestMessageID = call.input.body.messageID!
    fake.seedMessages(envelope.session_id, [
      completedAssistantMessage(requestMessageID, "recovered by fresh coordinator", {
        sessionID: envelope.session_id,
        id: `msg-fresh-${envelope.session_id}`,
        time: { created: clock.now(), completed: clock.now() },
      }),
    ])

    const second = createDispatchLifecycle({ sdk: fake, clock })
    const waitResult = await second.wait({
      jobID: envelope.job_id,
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 100,
    })

    expect(waitResult).toBe("recovered by fresh coordinator")
    expect(promptAsyncCount(fake)).toBe(1)
  })

  it("reports an interrupted running job as unknown", async () => {
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const create = await createJob(fake, {
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      role: "analyst",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      prompt: "analyze",
      clock,
    })
    if (!create.ok) throw create.error
    const jobID = create.value.jobID
    const child = await fake.session.create({ body: { parentID: jobID, title: "child" }, query: { directory: FAKE_DIRECTORY } })
    const sessionID = child.data!.id
    const requestMessageID = "msg-reserved-1"
    await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: {
        v: 1,
        kind: "attempt-reservation",
        job_id: jobID,
        attempt_index: 0,
        model: "opencode-go/qwen3.8-max",
        message_id: requestMessageID,
        reserved_at: clock.now(),
      },
      messageID: requestMessageID,
    })
    await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: {
        v: 1,
        kind: "attempt-receipt",
        job_id: jobID,
        attempt_index: 0,
        session_id: sessionID,
        message_id: requestMessageID,
        received_at: clock.now(),
      },
    })

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.wait({
      jobID,
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 0,
      startupGraceMs: 0,
    })
    const envelope = parseEnvelope(result)
    expect(envelope.status).toBe("unknown")
    expect(promptAsyncCount(fake)).toBe(0)
  })
})

describe("cancel intent blocks fallback", () => {
  for (const race of ["cancel", "reservation", "second-fallback"] as const) {
    it(`round2-2 rereads durable state when ${race} races fallback`, async () => {
      // Given a submitted writer primary that has failed retryably.
      const fake = createFakeSdk()
      const clock = createFakeClock()
      const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
      const launched = parseEnvelope(await lifecycle.launch({ role: "writer", prompt: "fixture", agentName: "writer", modelChain: ["p/primary", "p/backup", "p/third"], parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      const requestID = lastPromptAsyncCall(fake).input.body.messageID
      if (requestID === undefined) throw new Error("missing request ID")
      fake.seedMessages(launched.session_id, [completedAssistantMessage(requestID, "", { sessionID: launched.session_id, error: { name: "APIError", data: { isRetryable: true, statusCode: 429 } } })])
      const messages = fake.session.messages.bind(fake.session)
      let injected = false
      const promptAsync = fake.session.promptAsync.bind(fake.session)
      fake.session.promptAsync = async (input) => {
        const result = await promptAsync(input)
        if (race === "second-fallback") {
          if (input.body.messageID === undefined) throw new Error("missing request ID")
          fake.seedMessages(input.path.id, [completedAssistantMessage(input.body.messageID, "", { sessionID: input.path.id, error: { name: "APIError", data: { isRetryable: true, statusCode: 429 } } })])
        }
        return result
      }
      fake.session.messages = async (input) => {
        const response = await messages(input)
        const qualifies = race === "second-fallback" ? input.path.id !== launched.job_id : input.path.id === launched.job_id
        if (!injected && qualifies) {
          injected = true
          const record = race === "reservation"
            ? { v: 1, kind: "attempt-reservation", job_id: launched.job_id, attempt_index: 1, model: "p/backup", message_id: "msg-racing", reserved_at: 0 } as const
            : { v: 1, kind: "cancel-intent", job_id: launched.job_id, intent_at: 0 } as const
          const written = await appendRecord(fake, { jobID: launched.job_id, directory: FAKE_DIRECTORY, record })
          if (!written.ok) throw written.error
        }
        return response
      }
      // When observation races a durable write after the initial journal snapshot.
      const output = parseEnvelope(await lifecycle.wait({ jobID: launched.job_id, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 }))
      // Then no next model is submitted using stale state.
      expect(promptAsyncCount(fake)).toBe(race === "second-fallback" ? 2 : 1)
      expect(output.status).toBe(race === "reservation" ? "unknown" : "cancelling")
    })
  }
  it("observes but does not launch fallback attempts when a cancel intent exists", async () => {
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const create = await createJob(fake, {
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      role: "writer",
      agentName: "consultation-writer",
      modelChain: ["opencode/claude-sonnet-5", "opencode-go/kimi-k3"],
      prompt: "write",
      clock,
    })
    if (!create.ok) throw create.error
    const jobID = create.value.jobID
    const child = await fake.session.create({ body: { parentID: jobID, title: "child" }, query: { directory: FAKE_DIRECTORY } })
    const sessionID = child.data!.id
    const requestMessageID = "msg-reserved-1"
    await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: {
        v: 1,
        kind: "attempt-reservation",
        job_id: jobID,
        attempt_index: 0,
        model: "opencode/claude-sonnet-5",
        message_id: requestMessageID,
        reserved_at: clock.now(),
      },
      messageID: requestMessageID,
    })
    await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: {
        v: 1,
        kind: "attempt-receipt",
        job_id: jobID,
        attempt_index: 0,
        session_id: sessionID,
        message_id: requestMessageID,
        received_at: clock.now(),
      },
    })
    await appendRecord(fake, {
      jobID,
      directory: FAKE_DIRECTORY,
      record: { v: 1, kind: "cancel-intent", job_id: jobID, intent_at: clock.now() },
    })

    fake.seedMessages(sessionID, [
      {
        info: {
          id: `msg-err-${sessionID}`,
          sessionID,
          role: "assistant",
          parentID: requestMessageID,
          time: { created: clock.now(), completed: clock.now() },
          modelID: "m",
          providerID: "p",
          error: { name: "APIError", data: { isRetryable: true, status: 402, message: "quota" } },
        } as SdkAssistantMessage,
        parts: [],
      },
    ])

    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.wait({
      jobID,
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      waitMs: 100,
    })

    expect(result.startsWith("Error:")).toBe(true)
    expect(promptAsyncCount(fake)).toBe(0)
  })
})

describe("production default budget", () => {
  it("uses 300000 ms when waitMs is omitted", async () => {
    const requestedDurations: number[] = []
    const baseClock = createFakeClock()
    const recordingClock = {
      now: () => baseClock.now(),
      sleep: (ms: number, signal?: AbortSignal) => {
        requestedDurations.push(ms)
        return baseClock.sleep(ms, signal)
      },
    }
    const fake = createAutoCompletingFake("done", recordingClock)
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock: recordingClock })

    await lifecycle.launch({
      role: "analyst",
      prompt: "analyze",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
    })

    expect(PRODUCTION_WAIT_BUDGET_MS).toBe(300_000)
    expect(requestedDurations).toContain(300_000)
  })
})

describe("wait abort path", () => {
  it("returns a schema-valid envelope or honest Error text, never hardcoded analyst or empty session_id", async () => {
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const heldMutex: KeyedMutex = {
      withLock: async (_key, _fn, signal) => {
        if (signal?.aborted) {
          throw new DOMException("aborted", "AbortError")
        }
        return new Promise<never>((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true })
        })
      },
    }
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock, mutex: heldMutex })
    const controller = new AbortController()
    const waitPromise = lifecycle.wait({
      jobID: "ses_job",
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      signal: controller.signal,
    })
    setTimeout(() => controller.abort(), 0)
    const result = await waitPromise

    expect(result).not.toContain('"role":"analyst"')
    expect(result).not.toContain('"session_id":""')
    const parsed = parseOutcomeEnvelope(result)
    if (parsed.ok) {
      expect(parsed.value.role).not.toBe("analyst")
      expect(parsed.value.session_id.length).toBeGreaterThan(0)
    } else {
      expect(result.startsWith("Error:")).toBe(true)
    }
  })
})

describe("createSystemClock", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const clock = createSystemClock()
    const controller = new AbortController()
    controller.abort()
    await expect(clock.sleep(10, controller.signal)).rejects.toThrow("aborted")
  })
})

describe("journal read outage", () => {
  it("maps a transient journal read outage to a recoverable unknown envelope, not a generic failure", async () => {
    const fake = createFakeSdk()
    const clock = createFakeClock()
    const create = await createJob(fake, { parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, role: "analyst", agentName: "consultation-analyst", modelChain: ["p/m"], prompt: "analyze", clock })
    if (!create.ok) throw create.error
    const jobID = create.value.jobID
    fake.session.messages = async (input) => {
      if (input.path.id === jobID) return { error: { name: "APIError", data: { statusCode: 503 } } }
      return { data: [] }
    }
    const lifecycle = createDispatchLifecycle({ sdk: fake, clock })
    const result = await lifecycle.wait({ jobID, parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, waitMs: 0 })
    const parsed = parseOutcomeEnvelope(result)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.value.status).toBe("unknown")
      expect(parsed.value.job_id).toBe(jobID)
      expect(parsed.value.reason).toContain("read failed")
    }
  })
})
