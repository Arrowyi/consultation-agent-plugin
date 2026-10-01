import { describe, expect, it, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import type { Plugin, PluginInput, Config } from "@opencode-ai/plugin"
import { ConsultationAgentPlugin, createConsultationConfigHook } from "./plugin.ts"
import { resolveAsset } from "./asset-paths.ts"
import { computeNamespace } from "./namespace.ts"

function makeTempHome(): string {
  return mkdtempSync(join(tmpdir(), "plugin-integration-"))
}

describe("createConsultationConfigHook", () => {
  const savedEnv: Record<string, string | undefined> = {}
  const envKeys = ["CONSULTATION_CONFIG", "XDG_CONFIG_HOME", "HOME", "OPENCODE_CONFIG_DIR"]

  beforeEach(() => {
    for (const key of envKeys) savedEnv[key] = process.env[key]
  })

  afterEach(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  it("registers config.agent.consultant with mode primary and the consultant.md body plus runtime bindings", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.agent).toBeDefined()
      const consultant = config.agent?.["consultant"] as { mode: string; prompt: string }
      expect(consultant.mode).toBe("primary")
      expect(consultant.prompt).toContain("# Consultant")
      expect(consultant.prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("registers the consultation-critic subagent by default", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const critic = config.agent?.["consultation-critic"] as { mode: string }
      expect(critic.mode).toBe("subagent")
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("registers the full team: explorer, analyst, and critic subagents with default models", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const consultant = config.agent?.["consultant"] as { model: string }
      expect(consultant.model).toBe("opencode-go/deepseek-v4-pro")
      const explorer = config.agent?.["consultation-explorer"] as { mode: string; model: string }
      expect(explorer.mode).toBe("subagent")
      expect(explorer.model).toBe("opencode-go/deepseek-v4.1-flash")
      const analyst = config.agent?.["consultation-analyst"] as { mode: string; model: string }
      expect(analyst.mode).toBe("subagent")
      expect(analyst.model).toBe("opencode-go/qwen3.8-max")
      const critic = config.agent?.["consultation-critic"] as { mode: string; model: string }
      expect(critic.mode).toBe("subagent")
      expect(critic.model).toBe("opencode-go/glm-5.3")
      expect(config.agent?.["consultation-verifier"]).toMatchObject({
        mode: "subagent",
        model: "opencode-go/glm-5.3",
      })
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("registers the writer subagent by default", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const writer = config.agent?.["consultation-writer"] as { mode: string; permission: { edit: string; bash: string } }
      expect(writer.mode).toBe("subagent")
      expect(writer.permission).toEqual({ edit: "deny", bash: "deny" })
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("omits the bundled writer subagent when a delegate agent is configured", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-writerdelegate-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "writer_delegate_agent": "host-writer"}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.agent?.["consultation-writer"]).toBeUndefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("omits the writer subagent when writer_enabled=false", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-writeroff-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "writer_enabled": false}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.agent?.["consultation-writer"]).toBeUndefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("still registers explorer and analyst when critic_enabled=false", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-critoff2-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "critic_enabled": false\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.agent?.["consultation-critic"]).toBeUndefined()
      expect(config.agent?.["consultation-explorer"]).toBeDefined()
      expect(config.agent?.["consultation-analyst"]).toBeDefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("omits the critic subagent when critic_enabled=false", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-critoff-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "critic_enabled": false\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.agent?.["consultation-critic"]).toBeUndefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("sets the critic model from critic_model in the plugin config", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-critmodel-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "critic_model": "opencode-go/qwen3.7-plus"\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const critic = config.agent?.["consultation-critic"] as { model?: string }
      expect(critic.model).toBe("opencode-go/qwen3.7-plus")
      const consultant = config.agent?.["consultant"] as { prompt: string }
      expect(consultant.prompt).toContain("opencode-go/qwen3.7-plus")
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("does NOT clobber a pre-existing user-defined consultant agent entry", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const userPrompt = "user-defined consultant prompt"
    const config: Config = {
      agent: { consultant: { mode: "primary", prompt: userPrompt } },
    }
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const consultant = config.agent?.["consultant"] as { prompt: string }
      expect(consultant.prompt).toBe(userPrompt)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("registers config.mcp.consultation-memory as local with enabled true and CONSULTATION_NAMESPACE when memory enabled", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.mcp).toBeDefined()
      const mcp = config.mcp?.["consultation-memory"] as {
        type: string
        command: string[]
        enabled: boolean
        environment: Record<string, string>
      }
      expect(mcp.type).toBe("local")
      expect(mcp.enabled).toBe(true)
      expect(mcp.command).toHaveLength(2)
      expect(mcp.environment.CONSULTATION_NAMESPACE).toBe(computeNamespace("proj-123", "/tmp/project"))
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("omits the MCP entry when memory_enabled=false", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-memoff-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "memory_enabled": false\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(config.mcp?.["consultation-memory"]).toBeUndefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("prompt runtime block says Memory DISABLED when memory_enabled=false", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-memoff2-"))
    const configPath = join(tmpConfigDir, "config.jsonc")
    writeFileSync(configPath, '{\n  "memory_enabled": false\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const consultant = config.agent?.["consultant"] as { prompt: string }
      const runtimeBlock = consultant.prompt.split("## Runtime Bindings (injected by opencode-adapter)")[1] ?? ""
      expect(runtimeBlock).toContain("Memory: DISABLED by configuration (saving and recall are unavailable)")
      expect(runtimeBlock).not.toContain("Memory MCP server name")
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("skill install writes SKILL.md to the opencode config dir when missing", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const targetFile = join(tmpHome, "skills", "consultation", "SKILL.md")
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      expect(existsSync(targetFile)).toBe(false)

      // when
      await hook(config)

      // then
      expect(existsSync(targetFile)).toBe(true)
      const assetContent = await readFile(resolveAsset("skills/consultation/SKILL.md"), "utf8")
      expect(readFileSync(targetFile, "utf8")).toBe(assetContent)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("skill install never overwrites a file whose first line is <!-- user-modified -->", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const targetDir = join(tmpHome, "skills", "consultation")
    mkdirSync(targetDir, { recursive: true })
    const targetFile = join(targetDir, "SKILL.md")
    const userContent = "<!-- user-modified -->\n# custom\n"
    writeFileSync(targetFile, userContent)
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      expect(readFileSync(targetFile, "utf8")).toBe(userContent)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("namespace is oc- plus first 12 hex chars of sha256 of project.id", async () => {
    // given
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const projectId = "namespace-test-id"
    const expectedNs = "oc-" + createHash("sha256").update(projectId).digest("hex").slice(0, 12)
    const hook = createConsultationConfigHook({ id: projectId }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const mcp = config.mcp?.["consultation-memory"] as {
        environment: Record<string, string>
      }
      expect(mcp.environment.CONSULTATION_NAMESPACE).toBe(expectedNs)
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("plugin config loads from $CONSULTATION_CONFIG", async () => {
    // given
    const tmpHome = makeTempHome()
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-direct-"))
    const configPath = join(tmpConfigDir, "custom.jsonc")
    writeFileSync(configPath, '{\n  "agent_model": "test/model"\n}')
    process.env.HOME = tmpHome
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const consultant = config.agent?.["consultant"] as { model?: string }
      expect(consultant.model).toBe("test/model")
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })

  it("plugin config loads from $XDG_CONFIG_HOME/consultation-agent/config.jsonc when CONSULTATION_CONFIG is unset", async () => {
    // given
    const xdgHome = mkdtempSync(join(tmpdir(), "plugin-cfg-xdg-int-"))
    const consultationConfigDir = join(xdgHome, "consultation-agent")
    mkdirSync(consultationConfigDir, { recursive: true })
    writeFileSync(join(consultationConfigDir, "config.jsonc"), '{\n  "critic_agent": "xdg-critic"\n}')
    const tmpHome = makeTempHome()
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    process.env.XDG_CONFIG_HOME = xdgHome
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then
      const consultant = config.agent?.["consultant"] as { prompt: string }
      expect(consultant.prompt).toContain("xdg-critic")
    } finally {
      rmSync(xdgHome, { recursive: true, force: true })
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("plugin config loads from ~/.config/consultation-agent/config.jsonc when no env overrides", async () => {
    // given
    const tmpHome = makeTempHome()
    const consultationConfigDir = join(tmpHome, ".config", "consultation-agent")
    mkdirSync(consultationConfigDir, { recursive: true })
    writeFileSync(join(consultationConfigDir, "config.jsonc"), '{\n  "install_skill": false\n}')
    process.env.HOME = tmpHome
    delete process.env.CONSULTATION_CONFIG
    delete process.env.XDG_CONFIG_HOME
    process.env.OPENCODE_CONFIG_DIR = tmpHome
    const targetFile = join(tmpHome, "skills", "consultation", "SKILL.md")
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when
      await hook(config)

      // then — install_skill=false means no SKILL.md written
      expect(existsSync(targetFile)).toBe(false)
      // but the agent is still registered
      expect(config.agent?.["consultant"]).toBeDefined()
    } finally {
      rmSync(tmpHome, { recursive: true, force: true })
    }
  })

  it("rejects invalid config with a thrown Error", async () => {
    // given
    const tmpConfigDir = mkdtempSync(join(tmpdir(), "plugin-cfg-invalid-"))
    const configPath = join(tmpConfigDir, "bad.jsonc")
    writeFileSync(configPath, '{\n  "memory_enabled": 42\n}')
    process.env.HOME = makeTempHome()
    process.env.CONSULTATION_CONFIG = configPath
    delete process.env.XDG_CONFIG_HOME
    const config: Config = {}
    const hook = createConsultationConfigHook({ id: "proj-123" }, "/tmp/project")

    try {
      // when / then
      await expect(hook(config)).rejects.toThrow()
    } finally {
      rmSync(tmpConfigDir, { recursive: true, force: true })
    }
  })
})

describe("ConsultationAgentPlugin", () => {
  it("is a function that returns a Promise of hooks with a config property", async () => {
    // given
    const input: PluginInput = {
      project: { id: "wiring-test", worktree: "/wt", time: { created: 0 } },
      directory: "/tmp/project",
      worktree: "/wt",
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:3000"),
      client: undefined as never,
      $: undefined as never,
    }

    // when
    const hooks = await ConsultationAgentPlugin(input)

    // then
    expect(typeof hooks.config).toBe("function")
  })

  it("registers the consultation_dispatch tool and nothing else", async () => {
    // given
    const input: PluginInput = {
      project: { id: "wiring-test", worktree: "/wt", time: { created: 0 } },
      directory: "/tmp/project",
      worktree: "/wt",
      experimental_workspace: { register: () => {} },
      serverUrl: new URL("http://localhost:3000"),
      client: undefined as never,
      $: undefined as never,
    }

    // when
    const hooks = await ConsultationAgentPlugin(input)

    // then
    expect(hooks.tool).toBeDefined()
    expect(Object.keys(hooks.tool ?? {})).toEqual(["consultation_dispatch"])
    expect(hooks.tool?.["consultation_dispatch"]).toBeDefined()
  })

  it("is typed as Plugin", () => {
    // then — the export is assignable to Plugin
    const p: Plugin = ConsultationAgentPlugin
    expect(typeof p).toBe("function")
  })
})
