import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import {
  injectModelPrompt,
  registerAnalyst,
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
  registerSimple,
  registerVerifier,
  registerWriter,
} from "./agent-registration.ts"
import { resolveAsset } from "./asset-paths.ts"
import type { ConsultationPluginConfig } from "./plugin-config.ts"

const pluginConfig = {
  install_skill: true,
  install_commands: true,
  memory_enabled: true,
  explorer_agent: "consultation-explorer",
  analyst_agent: "consultation-analyst",
  critic_agent: "consultation-critic",
  critic_enabled: true,
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
} satisfies ConsultationPluginConfig

// Each read-only role runs a default model that resolves a shipped
// model-prompt block (slug = model id with "/" → "-").
const roles = [
  {
    asset: "explorer.md",
    name: "consultation-explorer",
    block: "opencode-go-deepseek-v4.1-flash.md",
    register: registerExplorer,
  },
  {
    asset: "analyst.md",
    name: "consultation-analyst",
    block: "opencode-go-qwen3.8-max.md",
    register: registerAnalyst,
  },
  {
    asset: "consultation-critic.md",
    name: "consultation-critic",
    block: "opencode-gemini-3.8-flash.md",
    register: registerConsultationCritic,
  },
  {
    asset: "consultation-verifier.md",
    name: "consultation-verifier",
    block: "opencode-gemini-3.8-flash.md",
    register: registerVerifier,
  },
  {
    asset: "writer.md",
    name: "consultation-writer",
    block: "opencode-claude-sonnet-5-5.md",
    register: registerWriter,
  },
] as const

const controls = ["consultation_dispatch_wait", "consultation_dispatch_cancel"] as const
const statuses = ["pending", "unknown", "cancelling", "cancelled"] as const
const promptSchema = z.object({ prompt: z.string() })

describe("dispatch prompt routing contract", () => {
  for (const asset of ["agents/consultant.md", "skills/consultation/SKILL.md"] as const) {
    for (const tool of controls) {
      it(`exposes ${tool} when loading ${asset}`, async () => {
        // given
        const path = resolveAsset(asset)
        // when
        const source = await readFile(path, "utf8")
        // then
        expect(source).toContain(`\`${tool}\``)
      })
    }

    it(`exposes envelope identifiers when loading ${asset}`, async () => {
      // given
      const path = resolveAsset(asset)
      // when
      const source = await readFile(path, "utf8")
      // then
      expect(source).toContain("`job_id`")
      for (const status of statuses) expect(source).toContain(`\`${status}\``)
    })
  }

  it("retains job-control identifiers when assembling the consultant", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    // when
    await registerConsultantAgent(config, pluginConfig, "oc-dispatch-prompt")
    // then
    const prompt = promptSchema.parse(config.agent?.["consultant"]).prompt
    for (const tool of controls) expect(prompt).toContain(`\`${tool}\``)
    for (const status of statuses) expect(prompt).toContain(`\`${status}\``)
    expect(prompt).toContain("`job_id`")
    expect(prompt).not.toContain("<!-- RUNTIME-BINDINGS")
  })

  for (const role of roles) {
    it(`exposes nonterminal status identifiers when loading ${role.asset}`, async () => {
      // given
      const path = resolveAsset(`agents/${role.asset}`)
      // when
      const source = await readFile(path, "utf8")
      // then
      expect(source).toContain("`pending`")
      expect(source).toContain("`unknown`")
    })

    it(`passes the complete asset through with its shipped model block when registering ${role.name}`, async () => {
      // given
      const config: { agent?: Record<string, unknown> } = {}
      const source = await readFile(resolveAsset(`agents/${role.asset}`), "utf8")
      const block = await readFile(resolveAsset(`model-prompts/${role.block}`), "utf8")
      // when
      await role.register(config, pluginConfig)
      // then
      expect(promptSchema.parse(config.agent?.[role.name]).prompt).toBe(injectModelPrompt(source, block))
    })
  }

  it("exposes nonterminal status identifiers when loading simple.md", async () => {
    // given
    const path = resolveAsset("agents/simple.md")
    // when
    const source = await readFile(path, "utf8")
    // then
    expect(source).toContain("`pending`")
    expect(source).toContain("`unknown`")
    expect(source).toContain("`consultation_dispatch_wait`")
  })

  it("injects runtime bindings when registering simple", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfigWithWorkspace = { ...pluginConfig, simple_workspace_dir: "/tmp/simple-ws-prompt" }
    // when
    await registerSimple(config, pluginConfigWithWorkspace, "oc-simple-prompt")
    // then
    const prompt = promptSchema.parse(config.agent?.["simple"]).prompt
    expect(prompt).toContain("# Simple")
    expect(prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(prompt).toContain("oc-simple-prompt")
    expect(prompt).toContain("/tmp/simple-ws-prompt")
    expect(prompt).not.toContain("<!-- RUNTIME-BINDINGS")
  })

  it("preserves the host agent when registering an external writer delegate", async () => {
    // given
    const hostEntry = { prompt: "host-owned", permission: { edit: "allow", bash: "allow" } }
    const config: { agent?: Record<string, unknown> } = { agent: { "host-writer": hostEntry } }
    const delegatedConfig = { ...pluginConfig, writer_delegate_agent: "host-writer" }
    // when
    await registerWriter(config, delegatedConfig)
    // then
    expect(config.agent?.["host-writer"]).toBe(hostEntry)
    expect(config.agent?.[pluginConfig.writer_agent]).toBeUndefined()
  })
})
