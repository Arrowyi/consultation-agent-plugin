import { describe, expect, it } from "bun:test"
import path from "node:path"

import {
  type Clock,
  type DispatchRole,
  type DispatchSdk,
  type JobSpec,
  type JournalRecord,
  type SdkAssistantMessage,
  type SdkMessageWithParts,
  type SdkSession,
  type SdkTextPart,
} from "./dispatch-contract.ts"
import {
  FAKE_DIRECTORY,
  FAKE_JOB_ID,
  FAKE_MESSAGE_ID,
  FAKE_PARENT_ID,
  createFakeClock,
  makeAttemptReceipt,
  makeAttemptReservation,
  makeCancelIntent,
  makeJobSpec,
  validRoleSpecs,
} from "./dispatch-test-fixtures.ts"
import {
  type DispatchJournalError,
  appendRecord,
  createAttemptSession,
  createJob,
  loadJob,
} from "./dispatch-journal.ts"

type JournalFakeSdk = DispatchSdk & {
  readonly calls: ReadonlyArray<unknown>
  readonly sessions: ReadonlyMap<string, SdkSession>
  readonly messages: ReadonlyMap<string, ReadonlyArray<SdkMessageWithParts>>
  setPromptFailure(sessionID: string, failure: (() => Error) | undefined): void
}

type PromptCall = {
  readonly method: "prompt"
  readonly input: {
    readonly path: { readonly id: string }
    readonly body: {
      readonly noReply?: boolean
      readonly messageID?: string
      readonly parts: ReadonlyArray<SdkTextPart>
    }
    readonly query?: { readonly directory?: string }
  }
}

// Local extended fake: in-memory sessions+messages, injectable prompt
// failures, and correct noReply semantics (no assistant message created).
function createJournalFakeSdk(options: {
  readonly directory?: string
} = {}): JournalFakeSdk {
  const sessions = new Map<string, SdkSession>()
  const messages = new Map<string, SdkMessageWithParts[]>()
  const calls: unknown[] = []
  const promptFailures = new Map<string, () => Error>()
  let sessionCounter = 0
  let assistantCounter = 0
  const directory = options.directory ?? FAKE_DIRECTORY

  function record(method: string, input: unknown): void {
    calls.push({ method, input })
  }

  function normalizeDir(dir: string | undefined): string {
    return dir === undefined ? directory : path.normalize(dir)
  }

  return {
    get calls() {
      return calls
    },
    get sessions() {
      return sessions
    },
    get messages() {
      return messages
    },
    setPromptFailure(sessionID, failure) {
      if (failure === undefined) {
        promptFailures.delete(sessionID)
      } else {
        promptFailures.set(sessionID, failure)
      }
    },
    session: {
      create: async (input) => {
        record("create", input)
        const id = `ses_fake_${++sessionCounter}`
        const session: SdkSession = {
          id,
          parentID: input.body.parentID,
          directory: normalizeDir(input.query.directory),
          title: input.body.title ?? "unnamed",
          time: { created: Date.now(), updated: Date.now() },
        }
        sessions.set(id, session)
        messages.set(id, [])
        return { data: session }
      },
      prompt: async (input) => {
        record("prompt", input)
        const failure = promptFailures.get(input.path.id)
        if (failure !== undefined) throw failure()

        const list = messages.get(input.path.id) ?? []
        if (input.body.noReply === true) {
          list.push({
            info: {
              role: "user",
              id: input.body.messageID ?? `msg_fallback_${++assistantCounter}`,
              sessionID: input.path.id,
            },
            parts: input.body.parts,
          })
        } else {
          const assistant: SdkAssistantMessage = {
            id: `msg_assistant_${++assistantCounter}`,
            sessionID: input.path.id,
            role: "assistant",
            time: { created: Date.now() },
            parentID: input.body.messageID ?? `msg_user_${++assistantCounter}`,
            modelID: input.body.model?.modelID ?? "default",
            providerID: input.body.model?.providerID ?? "default",
          }
          list.push({ info: assistant, parts: input.body.parts })
        }
        messages.set(input.path.id, list)
        return { data: { info: {} as SdkAssistantMessage, parts: [] } }
      },
      promptAsync: async (input) => {
        record("promptAsync", input)
        return { data: undefined }
      },
      status: async (input) => {
        record("status", input)
        return { data: {} }
      },
      abort: async (input) => {
        record("abort", input)
        return { data: true }
      },
      get: async (input) => {
        record("get", input)
        return { data: sessions.get(input.path.id) }
      },
      children: async (input) => {
        record("children", input)
        return { data: [...sessions.values()].filter((s) => s.parentID === input.path.id) }
      },
      messages: async (input) => {
        record("messages", input)
        return { data: messages.get(input.path.id) ?? [] }
      },
    },
  }
}

function assertOk<T>(result: { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error.message}`)
  return result.value
}

function assertError(result: { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly error: Error }): DispatchJournalError {
  if (result.ok) throw new Error(`expected error, got value: ${JSON.stringify(result.value)}`)
  return result.error as DispatchJournalError
}

function findCall(
  sdk: ReturnType<typeof createJournalFakeSdk>,
  method: string,
): unknown | undefined {
  return sdk.calls.find((c) => typeof c === "object" && c !== null && (c as { method: string }).method === method)
}

function getJobSpec(sdk: ReturnType<typeof createJournalFakeSdk>, jobID: string): JobSpec {
  const rootMessages = sdk.messages.get(jobID) ?? []
  const texts = rootMessages.flatMap((m) => m.parts.filter((p): p is SdkTextPart => p.type === "text" && p.text.startsWith("{")))
  const parsed = texts.map((p) => JSON.parse(p.text) as JournalRecord)
  const spec = parsed.find((r): r is JobSpec => r.kind === "job-spec")
  if (spec === undefined) throw new Error("job spec not found in fake messages")
  return spec
}

describe("createJob", () => {
  it("creates a root session with marker title and persists the job spec", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const result = await createJob(sdk, {
      parentID: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      role: "analyst",
      agentName: "consultation-analyst",
      modelChain: ["opencode-go/qwen3.8-max"],
      prompt: "analyze this",
      clock,
    })
    const { jobID } = assertOk(result)

    expect(jobID).toMatch(/^ses_fake_\d+$/)
    const session = sdk.sessions.get(jobID)
    expect(session?.parentID).toBe(FAKE_PARENT_ID)
    expect(session?.directory).toBe(path.normalize(FAKE_DIRECTORY))
    expect(session?.title).toBe("[consultation-dispatch:v1] analyst")

    const spec = getJobSpec(sdk, jobID)
    expect(spec.role).toBe("analyst")
    expect(spec.agent_name).toBe("consultation-analyst")
    expect(spec.model_chain).toEqual(["opencode-go/qwen3.8-max"])
    expect(spec.prompt).toBe("analyze this")
    expect(spec.parent_id).toBe(FAKE_PARENT_ID)
    expect(spec.directory).toBe(FAKE_DIRECTORY)
    expect(spec.created_at).toBe(1_000_000)
  })

  it("creates jobs for all six routing variants", async () => {
    for (const { label, role, record } of validRoleSpecs) {
      const sdk = createJournalFakeSdk()
      const clock = createFakeClock(1_000_000)
      const result = await createJob(sdk, {
        parentID: record.parent_id,
        directory: record.directory,
        role,
        agentName: record.agent_name,
        modelChain: record.model_chain,
        prompt: record.prompt,
        clock,
      })
      const { jobID } = assertOk(result)
      const session = sdk.sessions.get(jobID)
      expect(session?.title).toBe(`[consultation-dispatch:v1] ${role}`)
      const spec = getJobSpec(sdk, jobID)
      expect(spec.role).toBe(role)
      expect(spec.agent_name).toBe(record.agent_name)
      expect(spec.model_chain).toEqual(record.model_chain)
    }
  })
})

describe("appendRecord", () => {
  it("writes a noReply ignored+synthetic record and verifies read-back", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const reservation = makeAttemptReservation({ job_id: jobID })
    const append = await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: reservation })
    const { messageID } = assertOk(append)
    expect(messageID).toMatch(/^msg-[A-Za-z0-9_-]+$/)

    const promptCalls = sdk.calls.filter(
      (c): c is PromptCall => typeof c === "object" && c !== null && (c as { method: string }).method === "prompt",
    )
    const promptCall = promptCalls.find((c) => c.input.body.parts[0]?.text === JSON.stringify(reservation))
    expect(promptCall).toBeDefined()
    expect(promptCall?.input.path.id).toBe(jobID)
    expect(promptCall?.input.body.noReply).toBe(true)
    expect(promptCall?.input.body.messageID).toBe(messageID)
    expect(promptCall?.input.query?.directory).toBe(FAKE_DIRECTORY)

    const part = promptCall?.input.body.parts[0]
    expect(part?.type).toBe("text")
    expect(part?.text).toBe(JSON.stringify(reservation))
    expect(part?.ignored).toBe(true)
    expect(part?.synthetic).toBe(true)

    // Read-back verification: user message exists with the generated messageID and JSON text.
    const rootMessages = sdk.messages.get(jobID) ?? []
    const found = rootMessages.find((m) => "id" in m.info && m.info.id === messageID)
    expect(found).toBeDefined()
    const persistedPart = found?.parts[0]
    expect(persistedPart?.type === "text" ? persistedPart.text : undefined).toBe(JSON.stringify(reservation))
  })

  it("returns a write-failed error when read-back cannot confirm the record", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )
    // Inject a prompt failure for the root after the spec is persisted.
    sdk.setPromptFailure(jobID, () => new Error("host rejected noReply write"))

    const reservation = makeAttemptReservation({ job_id: jobID })
    const append = await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: reservation })
    const error = assertError(append)
    expect(error.reason).toBe("write-failed")
    expect(error.message).not.toContain(JSON.stringify(reservation))
  })
})

describe("createAttemptSession", () => {
  it("creates a child session of the job root", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const result = await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "analyst" })
    const { sessionID } = assertOk(result)
    const session = sdk.sessions.get(sessionID)
    expect(session?.parentID).toBe(jobID)
    expect(session?.title).toBe("[consultation-dispatch:v1] attempt analyst")
  })
})

describe("loadJob", () => {
  for (const scenario of ["out-of-range", "foreign-model", "conflicting-reservations", "identical-reservations", "conflicting-receipts", "identical-receipts"] as const) {
    it(`round2-1 validates journal semantics when ${scenario}`, async () => {
      // Given a two-model job with persisted records, not a mocked binding result.
      const sdk = createJournalFakeSdk()
      const { jobID } = assertOk(await createJob(sdk, { parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, role: "writer", agentName: "writer", modelChain: ["p/primary", "p/backup"], prompt: "fixture", clock: createFakeClock() }))
      const reservation = makeAttemptReservation({ job_id: jobID, model: "p/primary" })
      const records: JournalRecord[] = []
      switch (scenario) {
        case "out-of-range": records.push({ ...reservation, attempt_index: 5 }); break
        case "foreign-model": records.push({ ...reservation, model: "p/foreign" }); break
        case "conflicting-reservations": records.push(reservation, { ...reservation, message_id: "msg-other" }); break
        case "identical-reservations": records.push(reservation, { ...reservation, reserved_at: 2 }); break
        case "conflicting-receipts":
        case "identical-receipts": {
          const first = assertOk(await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "writer" }))
          const second = assertOk(await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "writer" }))
          const receipt = makeAttemptReceipt({ job_id: jobID, session_id: first.sessionID })
          records.push(reservation, receipt, { ...receipt, received_at: 2, session_id: scenario === "conflicting-receipts" ? second.sessionID : first.sessionID })
          break
        }
        default: { const exhaustive: never = scenario; throw exhaustive }
      }
      for (const record of records) assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record }))
      // When parsing the authoritative journal.
      const result = await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID })
      // Then only semantically identical duplicates are idempotent.
      expect(result.ok).toBe(scenario === "identical-reservations" || scenario === "identical-receipts")
      if (!result.ok) expect(result.error.reason).toBe("invalid-job")
    })
  }
  for (const mismatch of [{ parent_id: "ses_foreign" }, { directory: "/foreign" }, { role: "writer" as const }]) {
    it(`fix-1 rejects a single forged spec when ${Object.keys(mismatch)[0]} differs`, async () => {
      // Given an owned root with exactly one schema-valid but inconsistent spec.
      const sdk = createJournalFakeSdk()
      const root = await sdk.session.create({ body: { parentID: FAKE_PARENT_ID, title: "[consultation-dispatch:v1] analyst" }, query: { directory: FAKE_DIRECTORY } })
      if (root.data === undefined) throw new Error("missing root")
      await sdk.session.prompt({ path: { id: root.data.id }, body: { noReply: true, messageID: "msg-forged", parts: [{ type: "text", synthetic: true, ignored: true, text: JSON.stringify(makeJobSpec(mismatch)) }] }, query: { directory: FAKE_DIRECTORY } })
      // When recovering through the original owner.
      const result = await loadJob(sdk, { jobID: root.data.id, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID })
      // Then no inconsistent manifest is exposed.
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe("job-unavailable")
    })
  }

  for (const kind of ["reservation", "receipt", "cancel"] as const) {
    it(`fix-1 rejects a foreign job_id when the record is ${kind}`, async () => {
      // Given valid correlated records except for one foreign job binding.
      const sdk = createJournalFakeSdk()
      const { jobID } = assertOk(await createJob(sdk, { parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, role: "analyst", agentName: "analyst", modelChain: ["p/m"], prompt: "fixture", clock: createFakeClock() }))
      const { sessionID } = assertOk(await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "analyst" }))
      for (const record of [makeAttemptReservation({ job_id: kind === "reservation" ? "ses_foreign" : jobID }), makeAttemptReceipt({ job_id: kind === "receipt" ? "ses_foreign" : jobID, session_id: sessionID }), makeCancelIntent({ job_id: kind === "cancel" ? "ses_foreign" : jobID })]) {
        await sdk.session.prompt({ path: { id: jobID }, body: { noReply: true, parts: [{ type: "text", synthetic: true, ignored: true, text: JSON.stringify(record) }] }, query: { directory: FAKE_DIRECTORY } })
      }
      // When recovering.
      const result = await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID })
      // Then the foreign binding is rejected.
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe("invalid-job")
    })
  }

  for (const mismatch of [{ parentID: "ses_foreign" }, { directory: "/foreign" }]) {
    it(`fix-1 rejects returned children when ${Object.keys(mismatch)[0]} differs`, async () => {
      // Given a children response containing a foreign-bound session.
      const sdk = createJournalFakeSdk()
      const { jobID } = assertOk(await createJob(sdk, { parentID: FAKE_PARENT_ID, directory: FAKE_DIRECTORY, role: "analyst", agentName: "analyst", modelChain: ["p/m"], prompt: "fixture", clock: createFakeClock() }))
      sdk.session.children = async () => ({ data: [{ id: "ses_child", parentID: jobID, directory: FAKE_DIRECTORY, title: "child", time: { created: 0, updated: 0 }, ...mismatch }] })
      // When recovering.
      const result = await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID })
      // Then the host list is not trusted without checking child ownership.
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.reason).toBe("invalid-job")
    })
  }
  it("recovers a persisted job through a new journal instance", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const { sessionID: attemptSessionID } = assertOk(
      await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "analyst" }),
    )
    const reservationMessageID = "msg-test-reservation-1"
    const reservation = makeAttemptReservation({
      job_id: jobID,
      attempt_index: 0,
      message_id: reservationMessageID,
      model: "opencode-go/qwen3.8-max",
    })
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: reservation, messageID: reservationMessageID }))
    const receipt = makeAttemptReceipt({
      job_id: jobID,
      attempt_index: 0,
      session_id: attemptSessionID,
      message_id: reservationMessageID,
    })
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: receipt }))
    const cancel = makeCancelIntent({ job_id: jobID, intent_at: clock.now() })
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: cancel }))

    // Reconstruct with a fresh module reference and new SDK view (same data).
    const loaded = assertOk(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(loaded.spec).toEqual(getJobSpec(sdk, jobID))
    expect(loaded.reservations).toHaveLength(1)
    expect(loaded.reservations[0]).toEqual(reservation)
    expect(loaded.receipts).toHaveLength(1)
    expect(loaded.receipts[0]).toEqual(receipt)
    expect(loaded.cancelIntents).toHaveLength(1)
    expect(loaded.cancelIntents[0]).toEqual(cancel)
    expect(loaded.children).toHaveLength(1)
    expect(loaded.children[0]!.id).toBe(attemptSessionID)
    expect(loaded.records).toHaveLength(4)
  })

  it("reload exposes a newly appended cancel-intent (journal re-read is source of truth)", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const first = assertOk(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(first.cancelIntents).toHaveLength(0)

    const cancel = makeCancelIntent({ job_id: jobID, intent_at: clock.now() + 1 })
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: cancel }))

    const second = assertOk(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(second.cancelIntents).toHaveLength(1)
  })

  it("rejects a missing root with job-unavailable", async () => {
    const sdk = createJournalFakeSdk()
    const error = assertError(await loadJob(sdk, { jobID: "ses_missing", directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("job-unavailable")
  })

  it("rejects a cross-parent lookup with job-unavailable and no record contents", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "sensitive prompt text",
        clock,
      }),
    )

    const error = assertError(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: "ses_other_parent" }))
    expect(error.reason).toBe("job-unavailable")
    expect(error.message).not.toContain("sensitive prompt text")
    expect(error.message).not.toContain(FAKE_PARENT_ID)
  })

  it("rejects wrong workspace with job-unavailable", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const error = assertError(await loadJob(sdk, { jobID, directory: "/other/workspace", expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("job-unavailable")
  })

  it("rejects title marker mismatch with job-unavailable", async () => {
    const sdk = createJournalFakeSdk()
    await sdk.session.create({
      body: { parentID: FAKE_PARENT_ID, title: "some other title" },
      query: { directory: FAKE_DIRECTORY },
    })
    const session = [...sdk.sessions.values()][0]!
    const error = assertError(await loadJob(sdk, { jobID: session.id, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("job-unavailable")
  })

  it("rejects corrupt manifest records with invalid-job", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    // Inject a corrupt record manually as a synthetic ignored text part.
    await sdk.session.prompt({
      path: { id: jobID },
      body: {
        parts: [{ type: "text", text: "not valid json", ignored: true, synthetic: true }],
        noReply: true,
        messageID: "msg-corrupt-1",
      },
      query: { directory: FAKE_DIRECTORY },
    })

    const error = assertError(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("invalid-job")
  })

  it("rejects unknown version/kind with invalid-job", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    await sdk.session.prompt({
      path: { id: jobID },
      body: {
        parts: [{ type: "text", text: JSON.stringify({ v: 2, kind: "job-spec" }), ignored: true, synthetic: true }],
        noReply: true,
        messageID: "msg-v2",
      },
      query: { directory: FAKE_DIRECTORY },
    })

    const error = assertError(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("invalid-job")
  })

  it("rejects multiple job-spec records with invalid-job", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    const secondSpec: JobSpec = {
      v: 1,
      kind: "job-spec",
      role: "explorer",
      agent_name: "consultation-explorer",
      model_chain: ["opencode-go/deepseek-v4.1-flash"],
      prompt: "explore",
      parent_id: FAKE_PARENT_ID,
      directory: FAKE_DIRECTORY,
      created_at: clock.now() + 1,
    }
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: secondSpec }))

    const error = assertError(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("invalid-job")
  })

  it("rejects a receipt referencing an unknown reservation or foreign child", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    // No reservation and no child for this receipt.
    const orphanReceipt = makeAttemptReceipt({
      job_id: jobID,
      attempt_index: 0,
      session_id: "ses_foreign_child",
      message_id: FAKE_MESSAGE_ID,
    })
    assertOk(await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: orphanReceipt }))

    const error = assertError(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(error.reason).toBe("invalid-job")
  })

  it("loads an interrupted reservation as visibly incomplete", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )

    assertOk(
      await appendRecord(sdk, {
        jobID,
        directory: FAKE_DIRECTORY,
        record: makeAttemptReservation({ job_id: jobID, attempt_index: 0, model: "opencode-go/qwen3.8-max" }),
      }),
    )

    const loaded = assertOk(await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID }))
    expect(loaded.reservations).toHaveLength(1)
    expect(loaded.receipts).toHaveLength(0)
  })
})

describe("directory presence and zero generating requests", () => {
  it("includes directory on every SDK call", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )
    await createAttemptSession(sdk, { jobID, directory: FAKE_DIRECTORY, role: "analyst" })
    await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: makeAttemptReservation({ job_id: jobID }) })
    await loadJob(sdk, { jobID, directory: FAKE_DIRECTORY, expectedParentID: FAKE_PARENT_ID })

    for (const call of sdk.calls) {
      const typed = call as { method: string; input: { query?: { directory?: string } } }
      expect(typed.input.query?.directory).toBe(FAKE_DIRECTORY)
    }
  })

  it("produces no assistant messages for noReply root writes", async () => {
    const sdk = createJournalFakeSdk()
    const clock = createFakeClock(1_000_000)
    const { jobID } = assertOk(
      await createJob(sdk, {
        parentID: FAKE_PARENT_ID,
        directory: FAKE_DIRECTORY,
        role: "analyst",
        agentName: "consultation-analyst",
        modelChain: ["opencode-go/qwen3.8-max"],
        prompt: "analyze this",
        clock,
      }),
    )
    await appendRecord(sdk, { jobID, directory: FAKE_DIRECTORY, record: makeAttemptReservation({ job_id: jobID }) })

    const rootMessages = sdk.messages.get(jobID) ?? []
    const assistantMessages = rootMessages.filter((m) => "role" in m.info && m.info.role === "assistant")
    expect(assistantMessages).toHaveLength(0)
  })
})
