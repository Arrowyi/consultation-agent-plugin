import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
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
  buildRuntimeBindings,
  buildSimpleRuntimeBindings,
  buildSimplePermission,
  resolveSimpleWorkspaceDir,
  injectRuntimeBindings,
  injectModelPrompt,
  resolveModelPrompt,
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
    expect(block).toContain("opencode-go/glm-5.3")
  })

  it("reports the consultant and team role models", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("Consultant model")
    expect(block).toContain("opencode-go/deepseek-v4-pro")
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
    expect(block).toContain("writer `consultation-writer` (test/writer-model, fallback: opencode-go/kimi-k3)")
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

describe("resolveModelPrompt", () => {
  it("returns the user map entry for the exact resolved model, including an explicit empty string", async () => {
    // given
    const config = makeConfig({
      simple_model_prompts: { "opencode-go/deepseek-v4.1-flash": "user block", "other/model": "" },
    })

    // when // then
    expect(await resolveModelPrompt(config, "simple", "opencode-go/deepseek-v4.1-flash")).toBe("user block")
    expect(await resolveModelPrompt(config, "simple", "other/model")).toBe("")
  })

  it("returns empty for a non-default model with no user entry (never default-model advice on a swapped model)", async () => {
    // given
    const config = makeConfig()

    // when // then
    expect(await resolveModelPrompt(config, "explorer", "some/other-model")).toBe("")
  })

  it("returns empty for the default model when no shipped block file exists", async () => {
    // given — critic's default model has no shipped block in this repo
    const config = makeConfig()

    // when // then
    expect(await resolveModelPrompt(config, "critic", "opencode-go/glm-5.3")).toBe("")
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
    expect(consultant.model).toBe("opencode-go/deepseek-v4-pro")
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

  it("defaults the critic model to glm-5.3 when critic_model is unset", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { model?: string }
    expect(critic.model).toBe("opencode-go/glm-5.3")
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
      model: "opencode-go/glm-5.3",
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
      model: "opencode/claude-sonnet-5",
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

  it("reports the writer fallback chain in runtime bindings", () => {
    // given
    const config = makeConfig()

    // when
    const block = buildRuntimeBindings(config, "oc-ns")

    // then
    expect(block).toContain("writer `consultation-writer` (opencode/claude-sonnet-5, fallback: opencode-go/kimi-k3)")
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

  it("injects the user model block over the shipped default", async () => {
    // given
    const workspaceParent = mkdtempSync(join(tmpdir(), "simple-ws-"))
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig({
      simple_workspace_dir: join(workspaceParent, "simple"),
      simple_model_prompts: { "opencode-go/deepseek-v4.1-flash": "user flash block" },
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
    ]

    // when // then
    for (const asset of assets) {
      const source = await readFile(resolveAsset(asset), "utf8")
      expect(source).toContain("<!-- MODEL-PROMPT")
    }
  })

  it("assembles consultant byte-stably when no model block resolves (placeholder stays inert)", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfig = makeConfig()

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
      agent_model_prompts: { "my-provider/consultant-m": "drive the consultant carefully" },
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
      critic_model_prompts: { "my/critic-m": "challenge aggressively" },
    })

    // when
    await registerConsultationCritic(config, pluginConfig)

    // then
    const critic = config.agent?.["consultation-critic"] as { prompt: string }
    expect(critic.prompt).toContain("challenge aggressively")
    expect(critic.prompt).not.toContain("<!-- MODEL-PROMPT")
  })
})
