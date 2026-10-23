import { describe, expect, it } from "bun:test"
import { getEventListeners } from "node:events"

import {
  DISPATCH_ROLES,
  DEFAULT_WAIT_MS,
  PRODUCTION_WAIT_BUDGET_MS,
  parseJournalRecord,
  parseWaitArgs,
  parseOutcomeEnvelope,
  serializeOutcome,
  createKeyedMutex,
} from "./dispatch-contract.ts"
import {
  FAKE_DIRECTORY,
  FAKE_JOB_ID,
  FAKE_MESSAGE_ID,
  FAKE_PARENT_ID,
  FAKE_SESSION_ID,
  adversarialRecords,
  createFakeClock,
  createFakeSdk,
  makeAttemptReceipt,
  makeAttemptReservation,
  makeCancelledEnvelope,
  makeCancelIntent,
  makeEnvelope,
  makeJobSpec,
  validRoleSpecs,
} from "./dispatch-test-fixtures.ts"

function assertOk<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error.message}`)
  return result.value
}

function assertError(result: { ok: true; value: unknown } | { ok: false; error: Error }): Error {
  if (result.ok) throw new Error(`expected error, got value: ${JSON.stringify(result.value)}`)
  return result.error
}

describe("dispatch role constants", () => {
  it("exports roles, budget and default wait", () => {
    expect(DISPATCH_ROLES).toEqual(["explorer", "analyst", "critic", "verifier", "writer", "simple", "build-lite", "build", "consultant"])
    expect(PRODUCTION_WAIT_BUDGET_MS).toBe(300_000)
    expect(DEFAULT_WAIT_MS).toBe(PRODUCTION_WAIT_BUDGET_MS)
  })
})

describe("journal record parsing", () => {
  it("parses all routing variants and retains agent name and model chain", () => {
    for (const { role, record } of validRoleSpecs) {
      const parsed = assertOk(parseJournalRecord(record))
      expect(parsed.kind).toBe("job-spec")
      if (parsed.kind !== "job-spec") continue
      expect(parsed.role).toBe(role)
      expect(parsed.agent_name).toBe(record.agent_name)
      expect(parsed.model_chain).toEqual(record.model_chain)
      expect(parsed.parent_id).toBe(FAKE_PARENT_ID)
      expect(parsed.directory).toBe(FAKE_DIRECTORY)
      expect(parsed.prompt).toBe("analyze this")
      expect(parsed.created_at).toBe(1_000_000)
      expect(parsed.v).toBe(1)
    }
  })

  it("represents an undefined delegate model as explicit null", () => {
    const delegateNull = validRoleSpecs.find((s) => s.label === "writer-delegate-null")
    const parsed = assertOk(parseJournalRecord(delegateNull!.record))
    expect(parsed.kind).toBe("job-spec")
    if (parsed.kind === "job-spec") expect(parsed.model_chain).toEqual([null])
  })

  it("parses attempt reservation, receipt and cancel intent", () => {
    const reservation = assertOk(parseJournalRecord(makeAttemptReservation()))
    expect(reservation.kind).toBe("attempt-reservation")
    if (reservation.kind === "attempt-reservation") {
      expect(reservation.job_id).toBe(FAKE_JOB_ID)
      expect(reservation.attempt_index).toBe(0)
      expect(reservation.model).toBe("opencode/claude-sonnet-5-5")
      expect(reservation.message_id).toBe(FAKE_MESSAGE_ID)
    }

    const receipt = assertOk(parseJournalRecord(makeAttemptReceipt()))
    expect(receipt.kind).toBe("attempt-receipt")
    if (receipt.kind === "attempt-receipt") {
      expect(receipt.session_id).toBe(FAKE_SESSION_ID)
      expect(receipt.message_id).toBe(FAKE_MESSAGE_ID)
    }

    const cancel = assertOk(parseJournalRecord(makeCancelIntent({ reason: "user request" })))
    expect(cancel.kind).toBe("cancel-intent")
    if (cancel.kind === "cancel-intent") expect(cancel.reason).toBe("user request")

    const cancelNoReason = assertOk(parseJournalRecord(makeCancelIntent()))
    expect(cancelNoReason.kind).toBe("cancel-intent")
    if (cancelNoReason.kind === "cancel-intent") expect(cancelNoReason.reason).toBeUndefined()
  })

  it("rejects corrupt records with typed errors", () => {
    const base = makeJobSpec()
    expect(assertError(parseJournalRecord({ ...base, v: 2 })).message).toContain("version")
    expect(assertError(parseJournalRecord({ ...base, kind: "job-spec-v2" })).message).toContain("kind")
    expect(assertError(parseJournalRecord({ ...base, parent_id: undefined })).message.length).toBeGreaterThan(0)
    expect(assertError(parseJournalRecord({ ...base, directory: "" })).message.length).toBeGreaterThan(0)
    expect(assertError(parseJournalRecord({ ...base, role: "oracle" })).message.length).toBeGreaterThan(0)
    expect(assertError(parseJournalRecord({ ...base, model_chain: "not-an-array" })).message.length).toBeGreaterThan(0)

    const receipt = makeAttemptReceipt()
    expect(assertError(parseJournalRecord({ ...receipt, session_id: undefined })).message).toContain("session_id")
    expect(assertError(parseJournalRecord({ ...receipt, message_id: undefined })).message).toContain("message_id")

    const reservation = makeAttemptReservation()
    expect(assertError(parseJournalRecord({ ...reservation, message_id: "not-msg-prefixed" })).message).toContain("message_id")
  })
})

describe("envelope parsing and serialization", () => {
  it("round-trips nonterminal and cancelled envelopes", () => {
    const pending = makeEnvelope("pending", { waited_ms: 1_000 })
    const parsedPending = assertOk(parseOutcomeEnvelope(serializeOutcome({ kind: "nonterminal", envelope: pending })))
    expect(parsedPending.status).toBe("pending")
    expect(parsedPending.job_id).toBe(FAKE_JOB_ID)
    expect(parsedPending.role).toBe("analyst")
    expect(parsedPending.attempt).toEqual({ index: 0, model: "opencode/claude-sonnet-5-5" })
    expect(parsedPending.session_id).toBe(FAKE_SESSION_ID)
    expect(parsedPending.waited_ms).toBe(1_000)
    expect(parsedPending.next).toBe("consultation_dispatch_wait")

    const cancelled = makeCancelledEnvelope()
    const parsedCancelled = assertOk(parseOutcomeEnvelope(serializeOutcome({ kind: "cancelled", envelope: cancelled })))
    expect(parsedCancelled.status).toBe("cancelled")
    expect(parsedCancelled.job_id).toBe(FAKE_JOB_ID)
  })

  it("does not treat plain success text as an envelope", () => {
    const text = serializeOutcome({ kind: "success", text: "the final report" })
    expect(text).toBe("the final report")
    const parsed = parseOutcomeEnvelope(text)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.error.message).toContain("JSON")
  })

  it("rejects envelope with unknown status", () => {
    const bad = JSON.stringify({ ...makeEnvelope("pending"), status: "completed" })
    expect(assertError(parseOutcomeEnvelope(bad)).message).toContain("status")
  })
})

describe("wait args validation", () => {
  it("accepts valid budgets and defaults", () => {
    expect(assertOk(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: 0 })).wait_ms).toBe(0)
    expect(assertOk(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: PRODUCTION_WAIT_BUDGET_MS })).wait_ms).toBe(PRODUCTION_WAIT_BUDGET_MS)
    expect(assertOk(parseWaitArgs({ job_id: FAKE_JOB_ID })).wait_ms).toBe(DEFAULT_WAIT_MS)
  })

  it("rejects invalid wait values and job ids", () => {
    expect(assertError(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: -1 })).message).toContain("wait_ms")
    expect(assertError(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: 300_001 })).message).toContain("wait_ms")
    expect(assertError(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: 1.5 })).message).toContain("wait_ms")
    expect(assertError(parseWaitArgs({ job_id: FAKE_JOB_ID, wait_ms: "abc" })).message).toContain("wait_ms")
    expect(assertError(parseWaitArgs({ job_id: "" })).message).toContain("job_id")
    expect(assertError(parseWaitArgs({ job_id: 123 })).message).toContain("job_id")
  })
})

describe("fake SDK boundary", () => {
  it("records all session methods and exposes created sessions", async () => {
    const sdk = createFakeSdk()
    await sdk.session.create({ body: { parentID: FAKE_PARENT_ID, title: "test" }, query: { directory: FAKE_DIRECTORY } })
    await sdk.session.prompt({
      path: { id: FAKE_SESSION_ID },
      body: { agent: "consultation-analyst", parts: [{ type: "text", text: "go" }], noReply: true, messageID: FAKE_MESSAGE_ID },
      query: { directory: FAKE_DIRECTORY },
    })
    await sdk.session.abort({ path: { id: FAKE_SESSION_ID }, query: { directory: FAKE_DIRECTORY } })
    await sdk.session.get({ path: { id: FAKE_JOB_ID }, query: { directory: FAKE_DIRECTORY } })
    await sdk.session.children({ path: { id: FAKE_JOB_ID }, query: { directory: FAKE_DIRECTORY } })
    await sdk.session.messages({ path: { id: FAKE_JOB_ID }, query: { directory: FAKE_DIRECTORY } })

    const names = sdk.calls.map((c) => (c as { method: string }).method)
    expect(names).toEqual(["create", "prompt", "abort", "get", "children", "messages"])

    const created = await sdk.session.create({ body: { parentID: FAKE_PARENT_ID, title: "child" }, query: { directory: FAKE_DIRECTORY } })
    expect(created.data?.id).toMatch(/^ses_/)
    const got = await sdk.session.get({ path: { id: created.data!.id }, query: { directory: FAKE_DIRECTORY } })
    expect(got.data?.id).toBe(created.data!.id)
    const children = await sdk.session.children({ path: { id: FAKE_PARENT_ID }, query: { directory: FAKE_DIRECTORY } })
    expect(children.data?.map((s) => s.id)).toContain(created.data!.id)
  })
})

describe("clock and keyed mutex", () => {
  it("fix-3 removes the caller abort listener when queued acquisition settles normally", async () => {
    // Given a lock held until a second caller queues on a reusable signal.
    const mutex = createKeyedMutex()
    const controller = new AbortController()
    let release = () => {}
    const held = mutex.withLock("job", () => new Promise<void>((resolve) => { release = resolve }))
    await Promise.resolve()
    const queued = mutex.withLock("job", async () => {}, controller.signal)
    // When the queued acquisition finishes normally.
    release()
    await Promise.all([held, queued])
    // Then the signal retains no acquisition callbacks.
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0)
  })
  it("fake clock advances and sleeps are abortable", async () => {
    const clock = createFakeClock(1_000_000)
    expect(clock.now()).toBe(1_000_000)

    const sleepPromise = clock.sleep(10_000)
    clock.advance(5_000)
    clock.advance(5_000)
    await sleepPromise
    expect(clock.now()).toBe(1_010_000)

    const controller = new AbortController()
    const abortedSleep = clock.sleep(10_000, controller.signal)
    controller.abort()
    await expect(abortedSleep).rejects.toThrow()
  })

  it("keyed mutex serializes operations per job id", async () => {
    const mutex = createKeyedMutex()
    const order: string[] = []
    const a = mutex.withLock("job-a", async () => {
      order.push("a-start", "a-end")
      return "a"
    })
    const b = mutex.withLock("job-b", async () => {
      order.push("b-start", "b-end")
      return "b"
    })
    const c = mutex.withLock("job-a", async () => {
      order.push("c-start", "c-end")
      return "c"
    })

    const results = await Promise.all([a, b, c])
    expect(results).toEqual(["a", "b", "c"])
    expect(order.indexOf("a-end")).toBeLessThan(order.indexOf("c-start"))
  })
})

describe("adversarial malformed input", () => {
  it("does not crash or pollute Object.prototype on hostile keys, huge numbers and extra fields", () => {
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false)
    for (const record of adversarialRecords) {
      const result = parseJournalRecord(record)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toBeInstanceOf(Error)
    }
    expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false)
  })
})
