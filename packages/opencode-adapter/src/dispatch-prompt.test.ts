import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import {
  injectModelPrompt,
  registerAnalyst,
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
  registerLite,
  registerVerifier,
  registerWriter,
} from "./agent-registration.ts"
import { resolveAsset } from "./asset-paths.ts"
import type { JanusPluginConfig } from "./plugin-config.ts"

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
  coder_agent: "coder",
  coder_enabled: true,
  lite_agent: "lite",
  lite_enabled: true,
  coder_lite_agent: "coder-lite",
  coder_lite_enabled: true,
  build_agent: "build",
  build_enabled: true,
  janus_agent: "janus",
  janus_enabled: true,
} satisfies JanusPluginConfig

// Each read-only role runs a default model that resolves a shipped
// model-prompt block, keyed by the normalized model key (provider-agnostic).
const roles = [
  {
    asset: "explorer.md",
    name: "consultation-explorer",
    block: "deepseekv41flash.md",
    register: registerExplorer,
  },
  {
    asset: "analyst.md",
    name: "consultation-analyst",
    block: "qwen38max.md",
    register: registerAnalyst,
  },
  {
    asset: "consultation-critic.md",
    name: "consultation-critic",
    block: "gemini38flash.md",
    register: registerConsultationCritic,
  },
  {
    asset: "consultation-verifier.md",
    name: "consultation-verifier",
    block: "gemini38flash.md",
    register: registerVerifier,
  },
  {
    asset: "writer.md",
    name: "consultation-writer",
    block: "claudesonnet55.md",
    register: registerWriter,
  },
] as const

const controls = ["janus_dispatch_wait", "janus_dispatch_cancel"] as const
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

  it("keeps lite as a leaf with escalation lines instead of dispatch discipline", async () => {
    // given
    const path = resolveAsset("agents/lite.md")
    // when
    const source = await readFile(path, "utf8")
    // then
    expect(source).toContain("You are a leaf: you never dispatch another agent.")
    expect(source).toContain("escalate to `consultant`")
    expect(source).toContain("escalate to `coder`")
    expect(source).not.toContain("janus_dispatch_wait")
  })

  it("injects runtime bindings when registering lite", async () => {
    // given
    const config: { agent?: Record<string, unknown> } = {}
    const pluginConfigWithWorkspace = { ...pluginConfig, lite_workspace_dir: "/tmp/lite-ws-prompt" }
    // when
    await registerLite(config, pluginConfigWithWorkspace, "oc-lite-prompt")
    // then
    const prompt = promptSchema.parse(config.agent?.["lite"]).prompt
    expect(prompt).toContain("# Lite")
    expect(prompt).toContain("## Runtime Bindings (injected by opencode-adapter)")
    expect(prompt).toContain("oc-lite-prompt")
    expect(prompt).toContain("/tmp/lite-ws-prompt")
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
