import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
  registerAnalyst,
  registerVerifier,
  registerWriter,
  registerSimple,
  registerBuildLite,
  registerJanus,
  buildRuntimeBindings,
  buildSimpleRuntimeBindings,
  buildJanusRuntimeBindings,
  buildSimplePermission,
  buildBuildLitePermission,
  resolveSimpleWorkspaceDir,
  injectRuntimeBindings,
  injectModelPrompt,
  resolveModelPrompt,
  normalizeModelKey,
} from "./agent-registration.ts"
import { resolveAsset } from "./asset-paths.ts"
import type { ConsultationPluginConfig } from "./plugin-config.ts"

function makeConfig(overrides: Partial<ConsultationPluginConfig> = {}): ConsultationPluginConfig {
  return {
    install_skill: true,
    install_commands: true,
    memory_enabled: true,
    critic_agent: "consultation-critic",
    critic_enabled: true,
    explorer_agent: "consultation-explorer",
    analyst_agent: "consultation-analyst",
    verifier_agent: "consultation-verifier",
    verifier_enabled: true,
    writer_agent: "consultation-writer",
    writer_enabled: true,
    simple_agent: "simple",
    simple_enabled: true,
    build_lite_agent: "build-lite",
    build_lite_enabled: true,
    build_agent: "build",
    build_enabled: true,
    janus_agent: "janus",
    janus_enabled: true,
    ...overrides,
  }
}

describe("buildRuntimeBindings", () => {
  it("includes the memory MCP server line with tool names when memory is enabled", () => {
    // given
    const config = makeConfig({ memory_enabled: true })

    // when
    const block = buildRuntimeBindings(config, "oc-abcdef123456")

    // then
    expect(block).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(block).toContain("consultation-memory")
    expect(block).toContain("memory_recall")
    expect(block).toContain("memory_expand")
    expect(block).toContain("memory_prepare")
    expect(block).toContain("memory_commit")
    expect(block).toContain("memory_manage")
  })

  it("includes the namespace line", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-abcdef123456")

    // then
    expect(block).toContain("oc-abcdef123456")
    expect(block).toContain("Memory namespace")
  })

  it("says Memory DISABLED when memory_enabled is false", () => {
    // given
    const config = makeConfig({ memory_enabled: false })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("Memory: DISABLED by configuration (saving and recall are unavailable)")
    expect(block).not.toContain("consultation-memory")
  })

  it("includes the critic subagent name and model line when critic is enabled", () => {
    // given
    const config = makeConfig({ critic_model: "openrouter/qwen-max" })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("critic `consultation-critic`")
    expect(block).toContain("openrouter/qwen-max")
  })

  it("reports the default critic model when critic_model is unset", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("opencode/gemini-3.8-flash")
  })

  it("reports the consultant and team role models", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("Consultant model")
    expect(block).toContain("opencode-go/glm-5.3")
    expect(block).toContain("Team subagents")
    expect(block).toContain("consultation-explorer")
    expect(block).toContain("opencode-go/deepseek-v4.1-flash")
    expect(block).toContain("consultation-analyst")
    expect(block).toContain("opencode-go/qwen3.8-max")
  })

  it("reports the default team caps, tier matrix, and cost guard", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("round_cap=3")
    expect(block).toContain("explorer<=5")
    expect(block).toContain("critic_searches<=5")
    expect(block).toContain("fast(e5,a0,c0,v0,w0)")
    expect(block).toContain("standard(e5,a1,c1,v1,w1)")
    expect(block).toContain("deep(e5,a3,c2,v2,w2)")
    expect(block).toContain("~$10 per provider")
  })

  it("reports overridden team caps and cost guard", () => {
    // given
    const config = makeConfig({
      team_caps: { round_cap: 2, explorer_cap: 3, critic_search_cap: 4 },
      cost_guard_provider_usd: 7,
    })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("round_cap=2")
    expect(block).toContain("explorer<=3")
    expect(block).toContain("critic_searches<=4")
    expect(block).toContain("~$7 per provider")
  })

  it("reports overridden tier role caps", () => {
    // given
    const config = makeConfig({
      tier_role_caps: {
        fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0, writer: 0 },
        standard: { explorer: 5, analyst: 2, critic: 1, verifier: 1, writer: 0 },
        deep: { explorer: 5, analyst: 4, critic: 3, verifier: 2, writer: 0 },
      },
    })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("standard(e5,a2,c1,v1,w0)")
    expect(block).toContain("deep(e5,a4,c3,v2,w0)")
  })

  it("says critic DISABLED when critic_enabled is false", () => {
    // given
    const config = makeConfig({ critic_enabled: false })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("critic DISABLED by configuration")
  })

  it("reports writer enabled state in team subagents", () => {
    // given
    const config = makeConfig({ writer_model: "test/writer-model" })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("writer `consultation-writer` (test/writer-model)")
  })

  it("says writer DISABLED when writer_enabled is false", () => {
    // given
    const config = makeConfig({ writer_enabled: false })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("writer DISABLED by configuration")
  })

  it("reports the simple generalist line and its DISABLED state", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("Economical generalist: `simple` (`opencode-go/deepseek-v4.1-flash`)")

    // given
    const disabled = makeConfig({ simple_enabled: false })

    // when
    const disabledBlock = buildRuntimeBindings(disabled, "oc-ns")

    // then
    expect(disabledBlock).toContain("Economical generalist: simple DISABLED by configuration")

    // given — coding lanes
    const lanes = makeConfig()

    // when
    const lanesBlock = buildRuntimeBindings(lanes, "oc-ns")

    // then
    expect(lanesBlock).toContain("Mechanical coding lane: `build-lite` (`opencode-go/glm-5.3-flash`)")
    expect(lanesBlock).toContain("Strong coding lane: role `build` routes to agent `build` (`host default model`)")

    // given
    const lanesOff = makeConfig({ build_lite_enabled: false, build_enabled: false })

    // when
    const lanesOffBlock = buildRuntimeBindings(lanesOff, "oc-ns")

    // then
    expect(lanesOffBlock).toContain("Mechanical coding lane: build-lite DISABLED by configuration")
    expect(lanesOffBlock).toContain("Strong coding lane: build DISABLED by configuration")
  })
})

describe("injectRuntimeBindings", () => {
  it("replaces the RUNTIME-BINDINGS placeholder comment when present", () => {
    // given
    const body = "## Runtime Bindings\n\n<!-- RUNTIME-BINDINGS: do not edit. -->\n"
    const block = "## Runtime Bindings (injected)\n- stuff"

    // when
    const result = injectRuntimeBindings(body, block)

    // then
    expect(result).not.toContain("RUNTIME-BINDINGS:")
    expect(result).not.toContain("<!--")
    expect(result).toContain("## Runtime Bindings (injected)")
    expect(result).toContain("- stuff")
  })

  it("appends the block at the end when no placeholder is present", () => {
    // given
    const body = "# Consultant\n\nSome content without placeholder."
    const block = "## Runtime Bindings (injected)\n- stuff"

    // when
    const result = injectRuntimeBindings(body, block)

    // then
    expect(result).toContain("Some content without placeholder.")
    expect(result).toContain("## Runtime Bindings (injected)")
    expect(result.endsWith("## Runtime Bindings (injected)\n- stuff")).toBe(true)
  })
})

describe("injectModelPrompt", () => {
  it("replaces the MODEL-PROMPT placeholder when a block resolves", () => {
    // given
    const body = "# Agent\n\n## Role\n\nstuff\n\n<!-- MODEL-PROMPT: injected by the adapter. -->\n"
    // when
    const result = injectModelPrompt(body, "clamp formatting")
    // then
    expect(result).not.toContain("<!-- MODEL-PROMPT")
    expect(result).toContain("clamp formatting")
    expect(result).toContain("# Agent")
  })

  it("returns the body byte-identical when the block is empty", () => {
    // given
    const body = "# Agent\n\n<!-- MODEL-PROMPT: injected by the adapter. -->\n"
    // when
    const result = injectModelPrompt(body, "")
    // then
    expect(result).toBe(body)
  })

  it("appends a Driving This Model section when no placeholder exists", () => {
    // given
    const body = "# Agent\n\n## Role\n\nstuff"
    // when
    const result = injectModelPrompt(body, "drive carefully")
    // then
    expect(result).toContain("# Agent")
    expect(result).toContain("## Driving This Model")
    expect(result).toContain("drive carefully")
  })
})

describe("normalizeModelKey", () => {
  it("strips the provider, lowercases, and keeps only alphanumerics", () => {
    // given // when // then
    expect(normalizeModelKey("opencode-go/deepseek-v4.1-flash")).toBe("deepseekv41flash")
    expect(normalizeModelKey("deepseek/deepseek-v4-pro")).toBe("deepseekv4pro")
    expect(normalizeModelKey("opencode-go/deepseek-v4-pro")).toBe("deepseekv4pro")
    expect(normalizeModelKey("opencode/claude-sonnet-5-5")).toBe("claudesonnet55")
    expect(normalizeModelKey("DeepSeek-V4-Pro")).toBe("deepseekv4pro")
  })
})

describe("resolveModelPrompt", () => {
  it("returns the user global map entry for the normalized model key", async () => {
    // given
    const config = makeConfig({ model_prompts: { glm53: "user block" } })

    // when // then
    expect(await resolveModelPrompt(config, "opencode-go/glm-5.3")).toBe("user block")
  })

  it("matches the same block across providers", async () => {
    // given
    const config = makeConfig({ model_prompts: { deepseekv4pro: "shared deepseek block" } })

    // when // then
    expect(await resolveModelPrompt(config, "deepseek/deepseek-v4-pro")).toBe("shared deepseek block")
    expect(await resolveModelPrompt(config, "opencode-go/deepseek-v4-pro")).toBe("shared deepseek block")
  })

  it("returns empty when the user entry is an explicit disable", async () => {
    // given
    const config = makeConfig({ model_prompts: { glm53: "" } })

    // when // then
    expect(await resolveModelPrompt(config, "opencode-go/glm-5.3")).toBe("")
  })

  it("returns empty for a model with no user entry and no shipped block file", async () => {
    // given
    const config = makeConfig()

    // when // then
    expect(await resolveModelPrompt(config, "no-such/model")).toBe("")
  })

  it("loads the shipped block file for a default model with no user entry", async () => {
    // given
    const config = makeConfig()

    // when
    const block = await resolveModelPrompt(config, "opencode-go/glm-5.3")

    // then
    expect(block.startsWith("## Driving GLM-5.3")).toBe(true)
  })

  it("returns empty when the user disables a model that has a shipped block file", async () => {
    // given — an explicit "" wins over the shipped block
    const config = makeConfig({ model_prompts: { deepseekv41flash: "" } })

    // when // then
    expect(await resolveModelPrompt(config, "opencode-go/deepseek-v4.1-flash")).toBe("")
  })

  it("loads the shipped block for the direct-provider DeepSeek Flash id", async () => {
    // given — deepseek/deepseek-flash normalizes to deepseekflash, not deepseekv41flash
    const config = makeConfig()

    // when
    const block = await resolveModelPrompt(config, "deepseek/deepseek-flash")

    // then
    expect(block.startsWith("## Driving DeepSeek V4.1-Flash")).toBe(true)
  })

  it("keeps the direct-provider DeepSeek Flash block in sync with the V4.1-Flash block", async () => {
    // given — the two ids name the same model; the alias file must not drift
    const [alias, canonical] = await Promise.all([
      readFile(resolveAsset("model-prompts/deepseekflash.md"), "utf8"),
      readFile(resolveAsset("model-prompts/deepseekv41flash.md"), "utf8"),
    ])

    // when // then
    expect(alias).toBe(canonical)
  })
})

describe("registerConsultantAgent", () => {
  it("registers config.agent.consultant with mode primary and a prompt containing the consultant.md body", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-testnamespace")

    // then
    expect(config.agent).toBeDefined()
    const consultant = config.agent?.["consultant"] as { mode: string; prompt: string }
    expect(consultant.mode).toBe("primary")
    expect(consultant.prompt).toContain("# Consultant")
    expect(consultant.prompt).toContain("## Role")
  })

  it("includes the runtime bindings block in the assembled prompt", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-mynamespace")

    // then
    const consultant = config.agent?.["consultant"] as { prompt: string }
    expect(consultant.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(consultant.prompt).toContain("oc-mynamespace")
  })

  it("sets model when agent_model is configured", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ agent_model: "anthropic/claude-sonnet" })

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { mode: string; model?: string }
    expect(consultant.model).toBe("anthropic/claude-sonnet")
  })

  it("defaults the model to glm-5.3 when agent_model is not configured", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { model?: string }
    expect(consultant.model).toBe("opencode-go/glm-5.3")
  })

  it("does NOT clobber a pre-existing user-defined consultant agent entry", async () => {
    // given
    const userPrompt = "This is the user's custom consultant prompt."
    const config: { agent?: Record<string, unknown> } = {
      agent: { consultant: { mode: "primary", prompt: userPrompt } },
    }
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { prompt: string }
    expect(consultant.prompt).toBe(userPrompt)
  })

  it("replaces the RUNTIME-BINDINGS placeholder in the real consultant.md asset", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { prompt: string }
    expect(consultant.prompt).not.toContain("<!-- RUNTIME-BINDINGS")
    expect(consultant.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
  })
})

describe("registerConsultationCritic", () => {
  it("registers the critic as a subagent with the critic.md body and a read-only permission", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as {
      mode: string
      prompt: string
      description: string
      permission: { edit: string }
    }
    expect(critic.mode).toBe("subagent")
    expect(critic.prompt).toContain("# Consultation Critic")
    expect(critic.prompt).toContain("counterEvidence")
    expect(critic.description).toContain("counter-evidence")
    expect(critic.permission).toEqual({ edit: "deny" })
  })

  it("sets the critic model when critic_model is configured", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ critic_model: "anthropic/claude-sonnet-4" })

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { model?: string }
    expect(critic.model).toBe("anthropic/claude-sonnet-4")
  })

  it("defaults the critic model to gemini-3.8-flash when critic_model is unset", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { model?: string }
    expect(critic.model).toBe("opencode/gemini-3.8-flash")
  })

  it("uses the configured critic_agent name", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ critic_agent: "my-devil" })

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    expect(config.agent?.["my-devil"]).toBeDefined()
    expect(config.agent?.["consultation-critic"]).toBeUndefined()
  })

  it("does NOT clobber a pre-existing user-defined critic agent entry", async () => {
    // given
    const userPrompt = "user-defined critic prompt"
    const config: { agent?: Record<string, unknown> } = {
      agent: { "consultation-critic": { mode: "subagent", prompt: userPrompt } },
    }
    const pluginConfig = makeConfig()

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { prompt: string }
    expect(critic.prompt).toBe(userPrompt)
  })
})

describe("registerExplorer", () => {
  it("registers the explorer subagent with the explorer.md body and default model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerExplorer(config, pluginConfig)

    // then
    const explorer = config.agent?.["consultation-explorer"] as {
      mode: string
      prompt: string
      model: string
      permission: { edit: string }
    }
    expect(explorer.mode).toBe("subagent")
    expect(explorer.prompt).toContain("# Explorer")
    expect(explorer.model).toBe("opencode-go/deepseek-v4.1-flash")
    expect(explorer.permission).toEqual({ edit: "deny" })
  })

  it("overrides the explorer model from explorer_model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ explorer_model: "test/explorer-model" })

    // when
    await registerExplorer(config, pluginConfig)

    // then
    const explorer = config.agent?.["consultation-explorer"] as { model: string }
    expect(explorer.model).toBe("test/explorer-model")
  })
})

describe("registerAnalyst", () => {
  it("registers the analyst subagent with the analyst.md body and default model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerAnalyst(config, pluginConfig)

    // then
    const analyst = config.agent?.["consultation-analyst"] as {
      mode: string
      prompt: string
      model: string
      permission: { edit: string }
    }
    expect(analyst.mode).toBe("subagent")
    expect(analyst.prompt).toContain("# Analyst")
    expect(analyst.model).toBe("opencode-go/qwen3.8-max")
    expect(analyst.permission).toEqual({ edit: "deny" })
  })

  it("overrides the analyst model from analyst_model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ analyst_model: "test/analyst-model" })

    // when
    await registerAnalyst(config, pluginConfig)

    // then
    const analyst = config.agent?.["consultation-analyst"] as { model: string }
    expect(analyst.model).toBe("test/analyst-model")
  })
})

describe("registerVerifier", () => {
  it("uses the configured default critic-family model for the verifier", async () => {
    const config: { agent?: Record<string, unknown> } = {}

    await registerVerifier(config, makeConfig())

    expect(config.agent?.["consultation-verifier"]).toMatchObject({
      mode: "subagent",
      model: "opencode/gemini-3.8-flash",
      permission: { edit: "deny" },
    })
  })
})

describe("registerWriter", () => {
  it("installs a shell-free read-only writer", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerWriter(config, pluginConfig)

    // then
    expect(config.agent?.["consultation-writer"]).toMatchObject({
      mode: "subagent",
      model: "opencode/claude-sonnet-5-5",
      permission: { edit: "deny", bash: "deny" },
    })
  })

  it("does not register the bundled writer when a delegate agent is configured", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ writer_delegate_agent: "host-writer" })

    // when
    await registerWriter(config, pluginConfig)

    // then
    expect(config.agent?.["consultation-writer"]).toBeUndefined()
  })

  it("reports the delegate in runtime bindings when configured", () => {
    // given
    const config = makeConfig({ writer_delegate_agent: "host-writer" })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("writer delegated to `host-writer`")
  })

  it("reports the writer model without a fallback in runtime bindings", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("writer `consultation-writer` (opencode/claude-sonnet-5-5)")
  })
})

describe("resolveSimpleWorkspaceDir", () => {
  it("defaults under XDG data home", () => {
    // given
    const config = makeConfig()
    const env = { HOME: "/home/test-user", XDG_DATA_HOME: "/xdg/data" } as NodeJS.ProcessEnv

    // when
    const dir = resolveSimpleWorkspaceDir(config, env)

    // then
    expect(dir).toBe("/xdg/data/consultation-agent/simple")
  })

  it("falls back to HOME/.local/share when XDG_DATA_HOME is unset", () => {
    // given
    const config = makeConfig()
    const env = { HOME: "/home/test-user" } as NodeJS.ProcessEnv

    // when
    const dir = resolveSimpleWorkspaceDir(config, env)

    // then
    expect(dir).toBe("/home/test-user/.local/share/consultation-agent/simple")
  })

  it("honors simple_workspace_dir when configured", () => {
    // given
    const config = makeConfig({ simple_workspace_dir: "/custom/simple-ws" })

    // when
    const dir = resolveSimpleWorkspaceDir(config, { HOME: "/home/test-user" } as NodeJS.ProcessEnv)

    // then
    expect(dir).toBe("/custom/simple-ws")
  })
})

describe("buildSimplePermission", () => {
  it("allows reads and its own workspace, asks for every other write and non-readonly bash", () => {
    // given
    const workspace = "/xdg/data/consultation-agent/simple"

    // when
    const permission = buildSimplePermission(workspace)

    // then
    expect(permission.webfetch).toBe("allow")
    expect(permission.websearch).toBe("allow")
    const edit = permission.edit as Record<string, string>
    expect(edit["*"]).toBe("ask")
    expect(edit[`${workspace}/**`]).toBe("allow")
    const bash = permission.bash as Record<string, string>
    expect(bash["*"]).toBe("ask")
    expect(bash["cat *"]).toBe("allow")
    expect(bash["git status"]).toBe("allow")
    expect(bash["git log *"]).toBe("allow")
    expect(bash["mkdir *"]).toBeUndefined()
    expect(bash["find *"]).toBeUndefined()
    expect(bash["curl *"]).toBeUndefined()
    const external = permission.external_directory as Record<string, string>
    expect(external[`${workspace}/**`]).toBe("allow")
  })
})

describe("buildSimpleRuntimeBindings", () => {
  it("reports memory, own model, explorer, dispatch discipline, workspace, and namespace", () => {
    // given
    const config = makeConfig()
    const workspace = "/xdg/data/consultation-agent/simple"

    // when
    const block = buildSimpleRuntimeBindings(config, workspace, "oc-ns")

    // then
    expect(block).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(block).toContain("consultation-memory")
    expect(block).toContain("Simple model: `opencode-go/deepseek-v4.1-flash`")
    expect(block).toContain("consultation-explorer")
    expect(block).toContain("consultation_dispatch_wait")
    expect(block).toContain(`Your writable workspace: \`${workspace}\``)
    expect(block).toContain("oc-ns")
    expect(block).toContain("Mechanical coding lane: `build-lite` (`opencode-go/glm-5.3-flash`)")
    expect(block).toContain("Strong coding lane: role `build` routes to agent `build`")
  })

  it("says Memory DISABLED when memory_enabled is false", () => {
    // given
    const config = makeConfig({ memory_enabled: false })

    // when
    const block = buildSimpleRuntimeBindings(config, "/ws", "oc-ns")

    // then
    expect(block).toContain("Memory: DISABLED by configuration (saving and recall are unavailable)")
  })
})

describe("registerSimple", () => {
  // registerSimple always mkdirs its resolved workspace — every test in this
  // describe must point it at a temp dir so nothing lands under the real HOME.
  function tempWorkspaceConfig(overrides: Partial<ConsultationPluginConfig> = {}): { pluginConfig: ConsultationPluginConfig; cleanup: () => void } {
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    return {
      pluginConfig: makeConfig({ simple_workspace_dir: join(workspaceParent, "simple"), ...overrides }),
      cleanup: () => rmSync(workspaceParent, { recursive: true, force: true }),
    }
  }

  it("registers mode all with the simple.md body, injected bindings, and patterned permission", async () => {
    // given — temp workspace so the test never creates anything under the real HOME
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    const workspace = join(workspaceParent, "simple")
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ simple_workspace_dir: workspace })

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-testns")

      // then
      const simple = config.agent?.["simple"] as {
        mode: string
        description: string
        prompt: string
        model: string
        permission: Record<string, unknown>
      }
      expect(simple.mode).toBe("all")
      expect(simple.model).toBe("opencode-go/deepseek-v4.1-flash")
      expect(simple.description).toContain("Economical daily-consultation agent")
      expect(simple.prompt).toContain("# Simple")
      // The default model resolves its shipped slug block, which replaces
      // the placeholder.
      expect(simple.prompt).toContain("## Driving DeepSeek V4.1-Flash")
      expect(simple.prompt).not.toContain("<!-- MODEL-PROMPT")
      expect(simple.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
      expect(simple.prompt).toContain("oc-testns")
      expect(simple.prompt).toContain(workspace)
      expect(simple.prompt).not.toContain("<!-- RUNTIME-BINDINGS")
      expect(simple.permission.webfetch).toBe("allow")
      const edit = simple.permission.edit as Record<string, string>
      expect(edit[`${workspace}/**`]).toBe("allow")
    } finally {
      rmSync(workspaceParent, { recursive: true, force: true })
    }
  })

  it("skips the default model block when the model is swapped and no user block exists", async () => {
    // given — a swapped model with no user model-prompt entry
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      simple_workspace_dir: join(workspaceParent, "simple"),
      simple_model: "my-provider/other-model",
    })

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-ns")

      // then
      const simple = config.agent?.["simple"] as { prompt: string }
      expect(simple.prompt).toContain("<!-- MODEL-PROMPT")
      expect(simple.prompt).not.toContain("Driving DeepSeek V4.1-Flash")
    } finally {
      rmSync(workspaceParent, { recursive: true, force: true })
    }
  })

  it("injects the user model block over the shipped block", async () => {
    // given
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      simple_workspace_dir: join(workspaceParent, "simple"),
      model_prompts: { deepseekv41flash: "user flash block" },
    })

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-ns")

      // then
      const simple = config.agent?.["simple"] as { prompt: string }
      expect(simple.prompt).toContain("user flash block")
      expect(simple.prompt).not.toContain("Driving DeepSeek V4.1-Flash")
      expect(simple.prompt).not.toContain("<!-- MODEL-PROMPT")
    } finally {
      rmSync(workspaceParent, { recursive: true, force: true })
    }
  })

  it("creates the workspace directory under the resolved data home", async () => {
    // given
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ simple_workspace_dir: join(workspaceParent, "simple") })

    // when
    await registerSimple(config, pluginConfig, "oc-ns")

    // then
    expect(existsSync(join(workspaceParent, "simple"))).toBe(true)
    rmSync(workspaceParent, { recursive: true, force: true })
  })

  it("overrides the model from simple_model", async () => {
    // given
    const { pluginConfig, cleanup } = tempWorkspaceConfig({ simple_model: "test/simple-m" })
    const config: { agent?: Record<string, unknown> } = {}

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-ns")

      // then
      const simple = config.agent?.["simple"] as { model: string }
      expect(simple.model).toBe("test/simple-m")
    } finally {
      cleanup()
    }
  })

  it("uses the configured simple_agent name", async () => {
    // given
    const { pluginConfig, cleanup } = tempWorkspaceConfig({ simple_agent: "my-simple" })
    const config: { agent?: Record<string, unknown> } = {}

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-ns")

      // then
      expect(config.agent?.["my-simple"]).toBeDefined()
      expect(config.agent?.["simple"]).toBeUndefined()
    } finally {
      cleanup()
    }
  })

  it("does NOT clobber a pre-existing user-defined simple agent entry", async () => {
    // given
    const userPrompt = "user-defined simple prompt"
    const config: { agent?: Record<string, unknown> } = {
      agent: { simple: { mode: "all", prompt: userPrompt } },
    }
    const { pluginConfig, cleanup } = tempWorkspaceConfig()

    try {
      // when
      await registerSimple(config, pluginConfig, "oc-ns")

      // then
      const simple = config.agent?.["simple"] as { prompt: string }
      expect(simple.prompt).toBe(userPrompt)
    } finally {
      cleanup()
    }
  })
})

describe("buildBuildLitePermission", () => {
  it("allows workspace edits, asks for external, denies further dispatch", () => {
    // given // when
    const permission = buildBuildLitePermission()

    // then
    const edit = permission.edit as Record<string, string>
    expect(edit["*"]).toBe("allow")
    expect(edit["/*"]).toBe("ask")
    expect(edit).toEqual({ "*": "allow", "/*": "ask" })
    const bash = permission.bash as Record<string, string>
    expect(bash["*"]).toBe("ask")
    expect(bash["cat *"]).toBe("allow")
    expect(permission.webfetch).toBe("allow")
    expect(permission.websearch).toBe("allow")
    expect(permission.task).toBe("deny")
  })
})

describe("registerBuildLite", () => {
  it("registers a leaf subagent with steps 50 and the role body", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerBuildLite(config, pluginConfig)

    // then
    const lite = config.agent?.["build-lite"] as {
      mode: string
      description: string
      prompt: string
      model: string
      steps: number
      permission: Record<string, unknown>
    }
    expect(lite.mode).toBe("subagent")
    expect(lite.model).toBe("opencode-go/glm-5.3-flash")
    expect(lite.steps).toBe(50)
    expect(lite.description).toContain("mechanical coding")
    expect(lite.prompt).toContain("# Build-Lite")
    expect(lite.prompt).toContain("Report-Up discipline")
    // The default model resolves its shipped slug block, which replaces the
    // placeholder.
    expect(lite.prompt).toContain("## Driving GLM-5.3-Flash")
    expect(lite.prompt).not.toContain("<!-- MODEL-PROMPT")
    expect(lite.permission.task).toBe("deny")
  })

  it("keeps the asset byte-identical when the model is swapped and no user block exists", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ build_lite_model: "my-provider/other-model" })

    // when
    await registerBuildLite(config, pluginConfig)

    // then
    const lite = config.agent?.["build-lite"] as { prompt: string }
    const source = await readFile(resolveAsset("agents/build-lite.md"), "utf8")
    expect(lite.prompt).toBe(source)
  })

  it("injects the user model block over the shipped block", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      model_prompts: { glm53flash: "user glm block" },
    })

    // when
    await registerBuildLite(config, pluginConfig)

    // then
    const lite = config.agent?.["build-lite"] as { prompt: string }
    expect(lite.prompt).toContain("user glm block")
    expect(lite.prompt).not.toContain("Driving GLM-5.3-Flash")
    expect(lite.prompt).not.toContain("<!-- MODEL-PROMPT")
  })

  it("overrides the model from build_lite_model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ build_lite_model: "test/glm-flash" })

    // when
    await registerBuildLite(config, pluginConfig)

    // then
    const lite = config.agent?.["build-lite"] as { model: string }
    expect(lite.model).toBe("test/glm-flash")
  })

  it("uses the configured build_lite_agent name and never clobbers", async () => {
    // given
    const userPrompt = "user-defined build-lite prompt"
    const config: { agent?: Record<string, unknown> } = {
      agent: { "build-lite": { mode: "subagent", prompt: userPrompt } },
    }
    const pluginConfig = makeConfig()

    // when
    await registerBuildLite(config, pluginConfig)

    // then
    const lite = config.agent?.["build-lite"] as { prompt: string }
    expect(lite.prompt).toBe(userPrompt)
  })
})

describe("buildJanusRuntimeBindings", () => {
  it("reports own model, consultant/explorer/coding-lane/simple routes, and job-tool discipline, with no memory line", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildJanusRuntimeBindings(config)

    // then
    expect(block).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(block).toContain("Janus model: `opencode-go/glm-5.3`")
    expect(block).toContain("`consultant` (agent `consultant`, `opencode-go/glm-5.3`)")
    expect(block).toContain("`explorer` (agent `consultation-explorer`")
    expect(block).toContain("`build-lite` (agent `build-lite`, `opencode-go/glm-5.3-flash`)")
    expect(block).toContain("`build` (agent `build`, `host default model`)")
    expect(block).toContain("`simple` (agent `simple`, `opencode-go/deepseek-v4.1-flash`)")
    expect(block).toContain("consultation_dispatch_wait")
    expect(block).not.toContain("consultation-memory")
    expect(block).not.toContain("Memory namespace")
  })

  it("reports DISABLED variants for the coding lanes and simple", () => {
    // given
    const config = makeConfig({ build_lite_enabled: false, build_enabled: false, simple_enabled: false })

    // when
    const block = buildJanusRuntimeBindings(config)

    // then
    expect(block).toContain("build-lite DISABLED by configuration")
    expect(block).toContain("build DISABLED by configuration")
    expect(block).toContain("simple DISABLED by configuration")
  })
})

describe("registerJanus", () => {
  it("registers mode all with the janus.md body, injected model block and bindings, no memory", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerJanus(config, pluginConfig)

    // then
    const janus = config.agent?.["janus"] as {
      mode: string
      description: string
      prompt: string
      model: string
      permission: Record<string, unknown>
    }
    expect(janus.mode).toBe("all")
    expect(janus.model).toBe("opencode-go/glm-5.3")
    expect(janus.description).toContain("Daily-driver primary agent")
    expect(janus.prompt).toContain("# Janus")
    expect(janus.prompt).toContain("Before Implementing")
    // The default model resolves its shipped slug block, replacing the placeholder.
    expect(janus.prompt).toContain("## Driving GLM-5.3")
    expect(janus.prompt).not.toContain("<!-- MODEL-PROMPT")
    expect(janus.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(janus.prompt).not.toContain("<!-- RUNTIME-BINDINGS")
    expect(janus.prompt).not.toContain("consultation-memory")
  })

  it("overrides the model from janus_model", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ janus_model: "test/janus-m" })

    // when
    await registerJanus(config, pluginConfig)

    // then
    const janus = config.agent?.["janus"] as { model: string }
    expect(janus.model).toBe("test/janus-m")
  })

  it("uses the configured janus_agent name and never clobbers a pre-existing entry", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {
      agent: { janus: { mode: "all", prompt: "user-defined janus prompt" } },
    }
    const pluginConfig = makeConfig()

    // when
    await registerJanus(config, pluginConfig)

    // then
    const janus = config.agent?.["janus"] as { prompt: string }
    expect(janus.prompt).toBe("user-defined janus prompt")
  })

  it("keeps the asset byte-identical when the model is swapped and no user block exists", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ janus_model: "my-provider/other-model" })

    // when
    await registerJanus(config, pluginConfig)

    // then
    const janus = config.agent?.["janus"] as { prompt: string }
    expect(janus.prompt).toContain("<!-- MODEL-PROMPT")
    expect(janus.prompt).not.toContain("Driving GLM-5.3")
  })
})

describe("existing agents carry the inert MODEL-PROMPT placeholder", () => {
  it("every plugin-owned agent asset contains the placeholder", async () => {
    // given
    const assets = [
      "agents/consultant.md",
      "agents/explorer.md",
      "agents/analyst.md",
      "agents/consultation-critic.md",
      "agents/consultation-verifier.md",
      "agents/writer.md",
      "agents/janus.md",
      "agents/simple.md",
      "agents/build-lite.md",
    ]

    // when // then
    for (const asset of assets) {
      const source = await readFile(resolveAsset(asset), "utf8")
      expect(source).toContain("<!-- MODEL-PROMPT")
    }
  })

  it("assembles consultant byte-stably when no model block resolves (placeholder stays inert)", async () => {
    // given — a model with neither a user entry nor a shipped slug file
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({ agent_model: "my-provider/no-block-model" })

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { prompt: string }
    expect(consultant.prompt).toContain("<!-- MODEL-PROMPT")
    expect(consultant.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
  })

  it("injects a user model block into the consultant and still injects runtime bindings", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      agent_model: "my-provider/consultant-m",
      model_prompts: { consultantm: "drive the consultant carefully" },
    })

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { prompt: string }
    expect(consultant.prompt).not.toContain("<!-- MODEL-PROMPT")
    expect(consultant.prompt).toContain("drive the consultant carefully")
    expect(consultant.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
  })

  it("injects a user model block into a read-only specialist", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      critic_model: "my/critic-m",
      model_prompts: { criticm: "challenge aggressively" },
    })

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { prompt: string }
    expect(critic.prompt).toContain("challenge aggressively")
    expect(critic.prompt).not.toContain("<!-- MODEL-PROMPT")
  })
})

describe("model-prompt blocks are model-property only", () => {
  it("contains no role name, role rule, or price/pool positioning", async () => {
    // given
    const dir = resolveAsset("model-prompts")
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"))
    expect(files.length).toBeGreaterThan(0)
    const forbidden = [
      /report[- ]up/i,
      /stop-and-report/i,
      /step cap/i,
      /doubly binding/i,
      /approved outline/i,
      /evidence packet/i,
      /answer first/i,
      /answer format/i,
      /best for/i,
      /provided source material/i,
      /one question per reply/i,
      /source-intent/i,
      /evidence interpretation/i,
      /mechanism analysis/i,
      /trade-off resolution/i,
      /critique,? verification/i,
      /\bcheap\b/i,
      /\bat flash cost\b/i,
      /cost-sensitive/i,
      /\bprice\b/i,
      /\bbudget\b/i,
      /\bsubscription\b/i,
      /\bpool\b/i,
      /\bdelegate\b/i,
      /\b(writer|critic|verifier|analyst|explorer|consultant|janus)\b/i,
      /\bbuild-lite\b/i,
      /\bsimple agent\b/i,
      // runtime/operator controls the agent cannot set — keep them out of the prompt
      /thinking[_ -]?level/i,
      /reasoning[_ -]?effort/i,
      /thinking[_ -]?budget/i,
      /\btemperature\b/i,
      /\btop[_-]?p\b/i,
      /\bmax[_-]?tokens\b/i,
      /\bxhigh\b/i,
    ]

    // when // then
    for (const file of files) {
      const source = await readFile(join(dir, file), "utf8")
      for (const pattern of forbidden) {
        expect(source).not.toMatch(pattern)
      }
    }
  })

  it("each block carries a model profile and agent-actionable operating notes", async () => {
    // given
    const dir = resolveAsset("model-prompts")
    const files = readdirSync(dir).filter((f) => f.endsWith(".md"))

    // when // then
    for (const file of files) {
      const source = await readFile(join(dir, file), "utf8")
      expect(source).toMatch(/^## Driving /m)
      expect(source).toContain("Profile")
      expect(source).toContain("Operating notes:")
    }
  })

  it("role assets do not hard-code model names or benchmark tokens", async () => {
    // given — role positioning lives here; model properties live in model-prompts
    const roleAssets = [
      "agents/consultant.md",
      "agents/explorer.md",
      "agents/analyst.md",
      "agents/consultation-critic.md",
      "agents/consultation-verifier.md",
      "agents/writer.md",
      "agents/janus.md",
      "agents/simple.md",
      "agents/build-lite.md",
      "skills/consultation/SKILL.md",
    ]
    const modelTokens = /(GLM-|DeepSeek|Gemini|Qwen|Claude|Sonnet|Haiku|Kimi|MiMo|Terminal-Bench|GPQA|HLE|IFBench|ARC-AGI|SkillsBench|DeepSWE)/i

    // when // then
    for (const asset of roleAssets) {
      const source = await readFile(resolveAsset(asset), "utf8")
      expect(source).not.toMatch(modelTokens)
    }
  })
})
