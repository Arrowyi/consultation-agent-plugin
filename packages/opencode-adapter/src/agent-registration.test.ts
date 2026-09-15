import { describe, expect, it } from "bun:test"
import {
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
  registerAnalyst,
  buildRuntimeBindings,
  injectRuntimeBindings,
} from "./agent-registration.ts"
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

  it("falls back to the default critic model when critic_model is unset", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("opencode-go/glm-5.2")
  })

  it("reports the consultant and team role models", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("Consultant model")
    expect(block).toContain("deepseek/deepseek-v4-pro")
    expect(block).toContain("Team subagents")
    expect(block).toContain("consultation-explorer")
    expect(block).toContain("deepseek/deepseek-flash")
    expect(block).toContain("consultation-analyst")
    expect(block).toContain("opencode-go/qwen3.7-max")
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
    expect(block).toContain("fast(e5,a0,c0,v0)")
    expect(block).toContain("standard(e5,a1,c1,v1)")
    expect(block).toContain("deep(e5,a3,c2,v2)")
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
        fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0 },
        standard: { explorer: 5, analyst: 2, critic: 1, verifier: 1 },
        deep: { explorer: 5, analyst: 4, critic: 3, verifier: 2 },
      },
    })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("standard(e5,a2,c1,v1)")
    expect(block).toContain("deep(e5,a4,c3,v2)")
  })

  it("says critic DISABLED when critic_enabled is false", () => {
    // given
    const config = makeConfig({ critic_enabled: false })

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("critic DISABLED by configuration")
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

  it("defaults the model to deepseek-v4-pro when agent_model is not configured", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultantAgent(config, pluginConfig, "oc-ns")

    // then
    const consultant = config.agent?.["consultant"] as { model?: string }
    expect(consultant.model).toBe("deepseek/deepseek-v4-pro")
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
    expect(critic.permission.edit).toBe("deny")
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

  it("defaults the critic model to glm-5.2 when critic_model is unset", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { model?: string }
    expect(critic.model).toBe("opencode-go/glm-5.2")
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
    expect(explorer.model).toBe("deepseek/deepseek-flash")
    expect(explorer.permission.edit).toBe("deny")
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
    expect(analyst.model).toBe("opencode-go/qwen3.7-max")
    expect(analyst.permission.edit).toBe("deny")
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
