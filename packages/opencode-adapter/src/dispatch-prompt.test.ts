import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { z } from "zod"
import {
  registerAnalyst,
  registerConsultantAgent,
  registerConsultationCritic,
  registerExplorer,
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

const roles = [
  { asset: "explorer.md", name: "consultation-explorer", register: registerExplorer },
  { asset: "analyst.md", name: "consultation-analyst", register: registerAnalyst },
  { asset: "consultation-critic.md", name: "consultation-critic", register: registerConsultationCritic },
  { asset: "consultation-verifier.md", name: "consultation-verifier", register: registerVerifier },
  { asset: "writer.md", name: "consultation-writer", register: registerWriter },
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

    it(`passes the complete asset through when registering ${role.name}`, async () => {
      // given
      const config: { agent?: Record<string, unknown> } = {}
      const source = await readFile(resolveAsset(`agents/${role.asset}`), "utf8")
      // when
      await role.register(config, pluginConfig)
      // then
      expect(promptSchema.parse(config.agent?.[role.name]).prompt).toBe(source)
    })
  }

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
