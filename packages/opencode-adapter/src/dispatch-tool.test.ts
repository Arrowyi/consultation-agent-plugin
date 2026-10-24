import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"

import {
  createJanusDispatchTool,
  createJanusDispatchTools,
  resolveRoleTarget,
  splitModel,
} from "./dispatch-tool.ts"
import { JanusPluginConfigSchema, type JanusPluginConfig } from "./plugin-config.ts"
import { createFakeClock, createFakeSdk, type FakeSdk } from "./dispatch-test-fixtures.ts"
import { PRODUCTION_WAIT_BUDGET_MS, type DispatchEnvelope, type SdkAssistantMessage, type SdkMessageWithParts, type SdkTextPart } from "./dispatch-contract.ts"
import type { DispatchLifecycle, LaunchInput } from "./dispatch-lifecycle.ts"

function config(overrides: Partial<JanusPluginConfig> = {}): JanusPluginConfig {
  return JanusPluginConfigSchema.parse(overrides)
}

function fakeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "ses_parent",
    messageID: "msg_parent",
    agent: "consultant",
    directory: "/tmp/project",
    worktree: "/tmp/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
    ...overrides,
  }
}

function textPart(text: string): SdkTextPart {
  return { type: "text", text }
}

function completedAssistantMessage(requestMessageID: string, text: string, overrides: Partial<SdkAssistantMessage> = {}): SdkMessageWithParts {
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

function promptAsyncCount(fake: FakeSdk): number {
  return fake.calls.filter((c) => (c as { method: string }).method === "promptAsync").length
}

function abortCount(fake: FakeSdk): number {
  return fake.calls.filter((c) => (c as { method: string }).method === "abort").length
}

function lastPromptAsyncCall(fake: FakeSdk): { input: { path: { id: string }; body: { agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[]; messageID?: string } } } {
  const calls = fake.calls.filter((c) => (c as { method: string }).method === "promptAsync")
  return calls[calls.length - 1] as { input: { path: { id: string }; body: { agent?: string; model?: { providerID: string; modelID: string }; parts: SdkTextPart[]; messageID?: string } } }
}

function createRespondingFake(responseText: string, clock = createFakeClock()): FakeSdk {
  const fake = createFakeSdk()
  const base = fake.session.promptAsync.bind(fake.session)
    fake.session.promptAsync = async (input) => {
      const result = await base(input)
      const requestMessageID = input.body.messageID!
      const sessionID = input.path.id
      fake.seedMessages(sessionID, [
        completedAssistantMessage(requestMessageID, responseText, { sessionID, id: `msg-reply-${sessionID}` }),
      ])
      return result
    }
  return fake
}

describe("resolveRoleTarget", () => {
  it("maps each role to its own agent and default model", () => {
    const explorer = resolveRoleTarget(config(), "explorer")
    const analyst = resolveRoleTarget(config(), "analyst")
    const critic = resolveRoleTarget(config(), "critic")
    const verifier = resolveRoleTarget(config(), "verifier")
    const writer = resolveRoleTarget(config(), "writer")

    expect(explorer).toEqual({ agentName: "consultation-explorer", model: "opencode-go/deepseek-v4.1-flash" })
    expect(analyst).toEqual({ agentName: "consultation-analyst", model: "opencode-go/qwen3.8-max" })
    expect(critic).toEqual({ agentName: "consultation-critic", model: "opencode/gemini-3.8-flash" })
    expect(verifier).toEqual({ agentName: "consultation-verifier", model: "opencode/gemini-3.8-flash" })
    expect(writer).toEqual({ agentName: "consultation-writer", model: "opencode/claude-sonnet-5-5" })
    const coder = resolveRoleTarget(config(), "coder")
    expect(coder).toEqual({ agentName: "coder", model: "opencode-go/glm-5.3" })
    const lite = resolveRoleTarget(config(), "lite")
    expect(lite).toEqual({ agentName: "lite", model: "opencode-go/deepseek-v4.1-flash" })
    const coderLite = resolveRoleTarget(config(), "coder-lite")
    expect(coderLite).toEqual({ agentName: "coder-lite", model: "opencode-go/glm-5.3-flash" })
    const build = resolveRoleTarget(config(), "build")
    expect(build).toEqual({ agentName: "build", model: undefined })
    const consultant = resolveRoleTarget(config(), "consultant")
    expect(consultant).toEqual({ agentName: "consultant", model: "opencode-go/glm-5.3" })
  })

  it("resolves a renamed lite agent", () => {
    const cfg = config({ lite_agent: "my-lite", lite_model: "test/lite" })
    expect(resolveRoleTarget(cfg, "lite")).toEqual({ agentName: "my-lite", model: "test/lite" })
  })

  it("routes the build role to the configured host agent and pins its model only when set", () => {
    const cfg = config({ build_agent: "host-build", build_model: "p/build-m" })
    expect(resolveRoleTarget(cfg, "build")).toEqual({ agentName: "host-build", model: "p/build-m" })
    const unpinned = config({ build_agent: "host-build" })
    expect(resolveRoleTarget(unpinned, "build")).toEqual({ agentName: "host-build", model: undefined })
  })

  it("routes the writer to a delegate agent without pinning a model by default", () => {
    const cfg = config({ writer_delegate_agent: "host-writer" })
    expect(resolveRoleTarget(cfg, "writer")).toEqual({ agentName: "host-writer", model: undefined })
  })

  it("pins the delegate model only when writer_delegate_model is set", () => {
    const cfg = config({ writer_delegate_agent: "host-writer", writer_delegate_model: "p/m" })
    expect(resolveRoleTarget(cfg, "writer")).toEqual({ agentName: "host-writer", model: "p/m" })
  })

  it("honors model overrides", () => {
    const cfg = config({ analyst_model: "test/analyst" })
    expect(resolveRoleTarget(cfg, "analyst")).toEqual({ agentName: "consultation-analyst", model: "test/analyst" })
  })

  it("resolves the configured writer target", () => {
    const cfg = config({ writer_agent: "custom-writer", writer_model: "provider/writer-model" })
    expect(resolveRoleTarget(cfg, "writer")).toEqual({ agentName: "custom-writer", model: "provider/writer-model" })
  })
})

describe("splitModel", () => {
  it("splits provider/model on the first slash", () => {
    expect(splitModel("deepseek/deepseek-v4.1-flash")).toEqual({ providerID: "deepseek", modelID: "deepseek-v4.1-flash" })
    expect(splitModel("opencode-go/qwen3.8-max")).toEqual({ providerID: "opencode-go", modelID: "qwen3.8-max" })
  })

  it("throws on a model id without a provider separator", () => {
    expect(() => splitModel("no-slash")).toThrow(/provider\/model/)
    expect(() => splitModel("/leading")).toThrow()
    expect(() => splitModel("trailing/")).toThrow()
  })
})

describe("createJanusDispatchTool", () => {
  const savedEnv: Record<string, string | undefined> = {}
  let tmpConfigDir: string
  let configPath: string

  beforeEach(() => {
    savedEnv.JANUS_CONFIG = process.env.JANUS_CONFIG
    savedEnv.HOME = process.env.HOME
    tmpConfigDir = mkdtempSync(join(tmpdir(), "dispatch-config-"))
    configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(
      configPath,
      JSON.stringify({
        explorer_model: "provider-a/explorer-m",
        analyst_model: "provider-b/analyst-m",
        critic_model: "provider-c/critic-m",
      }),
    )
    process.env.JANUS_CONFIG = configPath
  })

  afterEach(() => {
    if (savedEnv.JANUS_CONFIG === undefined) delete process.env.JANUS_CONFIG
    else process.env.JANUS_CONFIG = savedEnv.JANUS_CONFIG
    if (savedEnv.HOME === undefined) delete process.env.HOME
    else process.env.HOME = savedEnv.HOME
    rmSync(tmpConfigDir, { recursive: true, force: true })
  })

  it("dispatches to the right agent and model and returns the subagent text", async () => {
    const clock = createFakeClock()
    const fake = createRespondingFake("the analyst result", clock)
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const result = await dispatchTool.execute({ role: "analyst", prompt: "analyze claims" }, fakeContext())

    expect(result).toBe("the analyst result")
    expect(promptAsyncCount(fake)).toBe(1)
    expect(abortCount(fake)).toBe(0)

    const createCall = fake.calls.find((c) => (c as { method: string }).method === "create") as { input: { body: { parentID?: string }; query: { directory?: string } } }
    expect(createCall.input.body.parentID).toBe("ses_parent")
    expect(createCall.input.query.directory).toBe("/tmp/project")

    const prompt = lastPromptAsyncCall(fake)
    expect(prompt.input.path.id).toMatch(/^ses_fake_/)
    expect(prompt.input.body.agent).toBe("consultation-analyst")
    expect(prompt.input.body.model).toEqual({ providerID: "provider-b", modelID: "analyst-m" })
    expect(prompt.input.body.parts).toEqual([{ type: "text", text: "analyze claims" }])
  })

  it("returns a clear error string when session create fails", async () => {
    const fake = createFakeSdk()
    fake.session.create = async () => ({ error: "boom", data: undefined })
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock: createFakeClock() })

    const result = await dispatchTool.execute({ role: "critic", prompt: "challenge" }, fakeContext())

    expect(result).toContain("failed to create job")
    expect(result).toContain("unrecognized provider error")
    expect(result).not.toContain("boom")
  })

  it("returns a clear error string when promptAsync fails", async () => {
    const fake = createFakeSdk()
    fake.setPromptAsyncError({ status: 500, message: "model auth failed" })
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock: createFakeClock() })

    const result = await dispatchTool.execute({ role: "explorer", prompt: "search" }, fakeContext())

    expect(result).toContain("explorer dispatch failed")
    expect(result).toContain("unrecognized provider error")
    expect(result).not.toContain("model auth failed")
  })

  it("fails after one attempt when a retryable quota error hits the single-model writer chain", async () => {
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
            id: `msg-fail-${sessionID}`,
            sessionID,
            role: "assistant",
            parentID: requestMessageID,
            time: { created: clock.now(), completed: clock.now() },
            modelID: "m",
            providerID: "p",
            error: { name: "APIError", data: { isRetryable: true, status: 402, message: "quota exhausted" } },
          } as SdkAssistantMessage,
          parts: [],
        },
      ])
      return result
    }
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    expect(result).toContain("writer dispatch failed")
    expect(result).toContain("opencode/claude-sonnet-5-5")
    expect(promptAsyncCount(fake)).toBe(1)
  })

  it("reports every tried model when the whole chain fails", async () => {
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
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    expect(result).toContain("opencode/claude-sonnet-5-5")
    expect(result).toContain("degrade")
  })

  it("does not fall back on a non-retryable writer error", async () => {
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
            error: { name: "APIError", data: { isRetryable: false, status: 401, message: "model auth failed" } },
          } as SdkAssistantMessage,
          parts: [],
        },
      ])
      return result
    }
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    expect(result).toContain("writer dispatch failed")
    expect(promptAsyncCount(fake)).toBe(1)
  })

  it("dispatches a delegated writer without pinning a model", async () => {
    writeFileSync(configPath, JSON.stringify({ writer_delegate_agent: "host-writer" }))
    const clock = createFakeClock()
    const fake = createRespondingFake("host wrote it", clock)
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { clock })

    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    expect(result).toBe("host wrote it")
    expect(promptAsyncCount(fake)).toBe(1)
    const prompt = lastPromptAsyncCall(fake)
    expect(prompt.input.body.agent).toBe("host-writer")
    expect(prompt.input.body.model).toBeUndefined()
  })

  it("rejects the lite role when lite_enabled=false", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "dispatch-liteoff-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "lite_enabled": false\n}')
    process.env.JANUS_CONFIG = configPath
    const tools = createJanusDispatchTools(createFakeSdk() as unknown as PluginInput["client"])

    try {
      // when
      const result = await tools.janus_dispatch.execute({ role: "lite", prompt: "quick lookup" }, fakeContext())

      // then
      expect(result).toBe("Error: lite is disabled by configuration")
    } finally {
      delete process.env.JANUS_CONFIG
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("launches coder-lite with the configured agent and model", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "dispatch-cl-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, JSON.stringify({ coder_lite_agent: "custom-lite", coder_lite_model: "custom/glm-flash" }))
    process.env.JANUS_CONFIG = configPath
    const fake = createRespondingFake("done")
    const tools = createJanusDispatchTools(fake as unknown as PluginInput["client"])

    try {
      // when
      const result = await tools.janus_dispatch.execute({ role: "coder-lite", prompt: "rename A to B" }, fakeContext())

      // then
      const body = lastPromptAsyncCall(fake).input.body
      expect(body.agent).toBe("custom-lite")
      expect(body.model).toEqual({ providerID: "custom", modelID: "glm-flash" })
      expect(result).toBe("done")
    } finally {
      delete process.env.JANUS_CONFIG
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("launches the build role against the host agent without a pinned model", async () => {
    // given
    const fake = createRespondingFake("done")
    const tools = createJanusDispatchTools(fake as unknown as PluginInput["client"])

    // when
    const result = await tools.janus_dispatch.execute({ role: "build", prompt: "refactor X" }, fakeContext())

    // then
    const body = lastPromptAsyncCall(fake).input.body
    expect(body.agent).toBe("build")
    expect(body.model).toBeUndefined()
    expect(result).toBe("done")
  })

  it("uses the production 300000 ms wait budget at the tool boundary", async () => {
    const captured: LaunchInput[] = []
    const spyLifecycle: DispatchLifecycle = {
      launch: async (input) => {
        captured.push(input)
        const envelope: DispatchEnvelope = {
          v: 1,
          status: "pending",
          job_id: "ses_spy",
          role: input.role,
          attempt: { index: 0, model: input.modelChain[0] ?? null },
          session_id: "ses_spy",
          waited_ms: 0,
          reason: "spy",
          next: "janus_dispatch_wait",
        }
        return JSON.stringify(envelope)
      },
      wait: async () => "never called",
    }
    const fake = createFakeSdk()
    const dispatchTool = createJanusDispatchTool(fake as unknown as PluginInput["client"], { lifecycle: spyLifecycle })

    await dispatchTool.execute({ role: "analyst", prompt: "analyze evidence" }, fakeContext())

    expect(captured).toHaveLength(1)
    expect(captured[0]!.waitMs ?? PRODUCTION_WAIT_BUDGET_MS).toBe(PRODUCTION_WAIT_BUDGET_MS)
  })
})
