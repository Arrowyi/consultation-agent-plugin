import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"

import {
  createConsultationDispatchTool,
  resolveRoleTarget,
  splitModel,
} from "./dispatch-tool.ts"
import { ConsultationPluginConfigSchema, type ConsultationPluginConfig } from "./plugin-config.ts"

function config(overrides: Partial<ConsultationPluginConfig> = {}): ConsultationPluginConfig {
  return ConsultationPluginConfigSchema.parse(overrides)
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

describe("resolveRoleTarget", () => {
  it("maps each role to its own agent and default model", () => {
    // given // when
    const explorer = resolveRoleTarget(config(), "explorer")
    const analyst = resolveRoleTarget(config(), "analyst")
    const critic = resolveRoleTarget(config(), "critic")
    const writer = resolveRoleTarget(config(), "writer")

    // then
    expect(explorer).toEqual({ agentName: "consultation-explorer", model: "deepseek/deepseek-flash" })
    expect(analyst).toEqual({ agentName: "consultation-analyst", model: "opencode-go/qwen3.7-max" })
    expect(critic).toEqual({ agentName: "consultation-critic", model: "opencode-go/glm-5.2" })
    expect(writer).toEqual({ agentName: "consultation-writer", model: "opencode/claude-sonnet-5" })
  })

  it("routes the writer to a delegate agent without pinning a model by default", () => {
    // given
    const cfg = config({ writer_delegate_agent: "host-writer" })

    // when // then
    expect(resolveRoleTarget(cfg, "writer")).toEqual({ agentName: "host-writer", model: undefined })
  })

  it("pins the delegate model only when writer_delegate_model is set", () => {
    // given
    const cfg = config({ writer_delegate_agent: "host-writer", writer_delegate_model: "p/m" })

    // when // then
    expect(resolveRoleTarget(cfg, "writer")).toEqual({ agentName: "host-writer", model: "p/m" })
  })

  it("honors model overrides", () => {
    // given
    const cfg = config({ analyst_model: "test/analyst" })

    // when
    const analyst = resolveRoleTarget(cfg, "analyst")

    // then
    expect(analyst.model).toBe("test/analyst")
  })

  it("resolves the configured writer target", () => {
    // given
    const cfg = config({
      writer_agent: "custom-writer",
      writer_model: "provider/writer-model",
    })

    // when
    const writer = resolveRoleTarget(cfg, "writer")

    // then
    expect(writer).toEqual({ agentName: "custom-writer", model: "provider/writer-model" })
  })
})

describe("splitModel", () => {
  it("splits provider/model on the first slash", () => {
    // given // when // then
    expect(splitModel("deepseek/deepseek-v4-pro")).toEqual({ providerID: "deepseek", modelID: "deepseek-v4-pro" })
    expect(splitModel("opencode-go/qwen3.7-max")).toEqual({ providerID: "opencode-go", modelID: "qwen3.7-max" })
  })

  it("throws on a model id without a provider separator", () => {
    // given // when // then
    expect(() => splitModel("no-slash")).toThrow(/provider\/model/)
    expect(() => splitModel("/leading")).toThrow()
    expect(() => splitModel("trailing/")).toThrow()
  })
})

describe("createConsultationDispatchTool", () => {
  const savedEnv: Record<string, string | undefined> = {}
  let tmpConfigDir: string
  let configPath: string

  beforeEach(() => {
    savedEnv.CONSULTATION_CONFIG = process.env.CONSULTATION_CONFIG
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
    process.env.CONSULTATION_CONFIG = configPath
  })

  afterEach(() => {
    if (savedEnv.CONSULTATION_CONFIG === undefined) delete process.env.CONSULTATION_CONFIG
    else process.env.CONSULTATION_CONFIG = savedEnv.CONSULTATION_CONFIG
    if (savedEnv.HOME === undefined) delete process.env.HOME
    else process.env.HOME = savedEnv.HOME
    rmSync(tmpConfigDir, { recursive: true, force: true })
  })

  it("dispatches to the right agent and model and returns the subagent text", async () => {
    // given
    const createCalls: unknown[] = []
    const promptCalls: unknown[] = []
    const abortCalls: unknown[] = []
    const fakeClient = {
      session: {
        create: async (input: unknown) => {
          createCalls.push(input)
          return { data: { id: "ses_child" } }
        },
        prompt: async (input: unknown) => {
          promptCalls.push(input)
          return { data: { parts: [{ type: "text", text: "the analyst result" }] } }
        },
        abort: async (input: unknown) => {
          abortCalls.push(input)
          return {}
        },
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "analyst", prompt: "analyze claims" }, fakeContext())

    // then
    expect(result).toBe("the analyst result")

    const create = createCalls[0] as { body: { parentID?: string }; query: { directory?: string } }
    expect(create.body.parentID).toBe("ses_parent")
    expect(create.query.directory).toBe("/tmp/project")

    const prompt = promptCalls[0] as {
      path: { id: string }
      body: { agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] }
    }
    expect(prompt.path.id).toBe("ses_child")
    expect(prompt.body.agent).toBe("consultation-analyst")
    expect(prompt.body.model).toEqual({ providerID: "provider-b", modelID: "analyst-m" })
    expect(prompt.body.parts).toEqual([{ type: "text", text: "analyze claims" }])

    const abort = abortCalls[0] as { path: { id: string } }
    expect(abort.path.id).toBe("ses_child")
  })

  it("returns a clear error string when session create fails", async () => {
    // given
    const fakeClient = {
      session: {
        create: async () => ({ error: "boom", data: undefined }),
        prompt: async () => ({ data: { parts: [] } }),
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "critic", prompt: "challenge" }, fakeContext())

    // then
    expect(result).toContain("failed to create subagent session")
    expect(result).toContain("boom")
  })

  it("returns a clear error string when the prompt fails", async () => {
    // given
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: "ses_child" } }),
        prompt: async () => ({ error: "model auth failed", data: undefined }),
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "explorer", prompt: "search" }, fakeContext())

    // then
    expect(result).toContain("explorer dispatch failed")
    expect(result).toContain("model auth failed")
  })

  it("falls back to kimi-k3 when the writer model hits a quota error", async () => {
    // given
    const promptCalls: Array<{ body: { model?: { providerID: string; modelID: string } } }> = []
    let attempt = 0
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: "ses_child" } }),
        prompt: async (input: { body: { model?: { providerID: string; modelID: string } } }) => {
          promptCalls.push(input)
          attempt += 1
          if (attempt === 1) return { error: { status: 402, message: "quota exhausted" }, data: undefined }
          return { data: { parts: [{ type: "text", text: "kimi wrote it" }] } }
        },
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    // then
    expect(result).toBe("kimi wrote it")
    expect(promptCalls).toHaveLength(2)
    expect(promptCalls[0]?.body.model).toEqual({ providerID: "opencode", modelID: "claude-sonnet-5" })
    expect(promptCalls[1]?.body.model).toEqual({ providerID: "moonshotai-cn", modelID: "kimi-k3" })
  })

  it("reports every tried model when the whole chain fails", async () => {
    // given
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: "ses_child" } }),
        prompt: async () => ({ error: { status: 429, message: "rate limited" }, data: undefined }),
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    // then
    expect(result).toContain("opencode/claude-sonnet-5")
    expect(result).toContain("moonshotai-cn/kimi-k3")
    expect(result).toContain("degrade")
  })

  it("does not fall back on a non-retryable writer error", async () => {
    // given
    const promptCalls: unknown[] = []
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: "ses_child" } }),
        prompt: async (input: unknown) => {
          promptCalls.push(input)
          return { error: "model auth failed", data: undefined }
        },
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    // then
    expect(result).toContain("writer dispatch failed")
    expect(promptCalls).toHaveLength(1)
  })

  it("dispatches a delegated writer without pinning a model", async () => {
    // given
    writeFileSync(
      configPath,
      JSON.stringify({ writer_delegate_agent: "host-writer" }),
    )
    const promptCalls: Array<{ body: { agent?: string; model?: { providerID: string; modelID: string } } }> = []
    const fakeClient = {
      session: {
        create: async () => ({ data: { id: "ses_child" } }),
        prompt: async (input: { body: { agent?: string; model?: { providerID: string; modelID: string } } }) => {
          promptCalls.push(input)
          return { data: { parts: [{ type: "text", text: "host wrote it" }] } }
        },
        abort: async () => {},
      },
    }
    const dispatchTool = createConsultationDispatchTool(fakeClient as unknown as PluginInput["client"])

    // when
    const result = await dispatchTool.execute({ role: "writer", prompt: "blueprint" }, fakeContext())

    // then
    expect(result).toBe("host wrote it")
    expect(promptCalls).toHaveLength(1)
    expect(promptCalls[0]?.body.agent).toBe("host-writer")
    expect(promptCalls[0]?.body.model).toBeUndefined()
  })
})
