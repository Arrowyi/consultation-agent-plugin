import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { createConsultationDispatchTool } from "./dispatch-tool.ts"
import { createFakeClock, createFakeSdk, type FakeSdk } from "./dispatch-test-fixtures.ts"
import { PRODUCTION_WAIT_BUDGET_MS, parseOutcomeEnvelope, type Clock, type DispatchEnvelope, type SdkAssistantMessage, type SdkMessageWithParts, type SdkTextPart } from "./dispatch-contract.ts"

describe("consultation dispatch reliability", () => {
  let directory: string
  let previousConfig: string | undefined

  beforeEach(() => {
    previousConfig = process.env.CONSULTATION_CONFIG
    directory = mkdtempSync(join(tmpdir(), "consultation-dispatch-reliability-"))
    process.env.CONSULTATION_CONFIG = join(directory, "config.jsonc")
    writeFileSync(process.env.CONSULTATION_CONFIG, "{}")
  })

  afterEach(() => {
    if (previousConfig === undefined) delete process.env.CONSULTATION_CONFIG
    else process.env.CONSULTATION_CONFIG = previousConfig
    rmSync(directory, { recursive: true, force: true })
  })

  const context: ToolContext = {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "consultant",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }

  function textPart(text: string): SdkTextPart {
    return { type: "text", text }
  }

  function completedAssistantMessage(requestMessageID: string, parts: SdkTextPart[], overrides: Partial<SdkAssistantMessage> = {}): SdkMessageWithParts {
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
      parts,
    }
  }

  function createRespondingFake(responseText: string, clock = createFakeClock()): FakeSdk {
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      fake.seedMessages(sessionID, [completedAssistantMessage(requestMessageID, [{ type: "text", text: responseText }], { sessionID, id: `msg-reply-${sessionID}` })])
      return result
    }
    return fake
  }

  function promptAsyncCount(fake: FakeSdk): number {
    return fake.calls.filter((c) => (c as { method: string }).method === "promptAsync").length
  }

  function abortCount(fake: FakeSdk): number {
    return fake.calls.filter((c) => (c as { method: string }).method === "abort").length
  }

  function fakeSession(parts: SdkTextPart[]) {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    const base = fake.session.promptAsync.bind(fake.session)
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      fake.seedMessages(sessionID, [completedAssistantMessage(requestMessageID, parts, { sessionID, id: `msg-reply-${sessionID}` })])
      return result
    }
    const dispatch = createConsultationDispatchTool(fake as unknown as PluginInput["client"], { clock })
    return { dispatch, fake }
  }

  function parseEnvelope(json: string): DispatchEnvelope {
    const parsed = parseOutcomeEnvelope(json)
    if (!parsed.ok) throw new Error(`expected envelope: ${parsed.error.message}`)
    return parsed.value as DispatchEnvelope
  }

  function promptAsyncCalls(fake: FakeSdk): Array<{ input: { body: { agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[]; messageID?: string } } }> {
    return fake.calls.filter((c): c is { method: "promptAsync"; input: { body: { agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[]; messageID?: string } } } => {
      return typeof c === "object" && c !== null && (c as { method: string }).method === "promptAsync"
    })
  }

  async function advanceClockTo(clock: Clock & { advance(ms: number): void }, target: number, chunk = 2_000): Promise<void> {
    // Yield one real macrotask so the tool's execute() wrapper has started before
    // we begin advancing the fake clock.
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    while (clock.now() < target) {
      await Promise.resolve()
      const step = Math.min(chunk, target - clock.now())
      clock.advance(step)
    }
  }

  for (const scenario of [
    { role: "critic", config: { critic_enabled: false } },
    { role: "verifier", config: { verifier_enabled: false } },
    { role: "writer", config: { writer_enabled: false } },
  ] as const) {
    it(`rejects a disabled ${scenario.role} before creating a child session`, async () => {
      writeFileSync(process.env.CONSULTATION_CONFIG ?? "", JSON.stringify(scenario.config))
      const { dispatch, fake } = fakeSession([{ type: "text", text: "should not run" }])

      const result = await dispatch.execute({ role: scenario.role, prompt: "check" }, context)

      expect(result).toBe(`Error: ${scenario.role} is disabled by configuration`)
      expect(promptAsyncCount(fake)).toBe(0)
    })
  }

  it("uses an explicitly delegated writer even when the bundled writer is disabled", async () => {
    writeFileSync(process.env.CONSULTATION_CONFIG ?? "", JSON.stringify({
      writer_enabled: false,
      writer_delegate_agent: "host-writer",
    }))
    const fake = createRespondingFake("usable manuscript")
    const tool = createConsultationDispatchTool(fake as unknown as PluginInput["client"], { clock: createFakeClock() })

    const result = await tool.execute({ role: "writer", prompt: "draft" }, context)

    expect(result).toBe("usable manuscript")
    const calls = fake.calls.filter((c) => (c as { method: string }).method === "promptAsync")
    expect(calls.some((c) => (c as { input: { body: { agent?: string } } }).input.body.agent === "host-writer")).toBe(true)
  })

  for (const scenario of [
    { name: "no parts", parts: [] as SdkTextPart[] },
    { name: "blank text", parts: [{ type: "text", text: "   \n " }] },
    { name: "only non-text parts", parts: [{ type: "reasoning", text: "hidden" } as unknown as SdkTextPart] },
  ]) {
    it(`reports ${scenario.name} as unknown specialist output`, async () => {
      const { dispatch, fake } = fakeSession(scenario.parts as SdkTextPart[])

      const result = (await dispatch.execute({ role: "analyst", prompt: "analyze evidence" }, context)) as string

      const envelope = parseEnvelope(result)
      expect(envelope.status).toBe("unknown")
      expect(promptAsyncCalls(fake)).toHaveLength(1)
      expect(fake.calls.filter((c) => (c as { method: string }).method === "abort")).toHaveLength(0)
    })
  }

  it("preserves usable text from a completed child", async () => {
    const { dispatch } = fakeSession([{ type: "text", text: "finding with source" }])

    const result = await dispatch.execute({ role: "analyst", prompt: "analyze evidence" }, context)

    expect(result).toBe("finding with source")
  })

  it("returns a nonterminal envelope and zero aborts when the soft window expires", async () => {
    const clock = createFakeClock()
    const fake = createFakeSdk()
    fake.setPromptAsyncResult({ data: undefined })
    const dispatch = createConsultationDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const promise = dispatch.execute({ role: "analyst", prompt: "analyze evidence" }, context)
    await advanceClockTo(clock, PRODUCTION_WAIT_BUDGET_MS)
    const result = (await promise) as string

    const envelope = parseEnvelope(result)
    expect(envelope.status).toMatch(/pending|unknown/)
    expect(envelope.job_id).toMatch(/^ses_fake_/)
    expect(envelope.next).toBe("consultation_dispatch_wait")
    expect(abortCount(fake)).toBe(0)
    expect(promptAsyncCount(fake)).toBe(1)
  })
})
