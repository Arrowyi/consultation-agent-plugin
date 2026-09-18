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
    expect(writer).toEqual({ agentName: "consultation-writer", model: "deepseek/deepseek-v4-pro" })
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
})
