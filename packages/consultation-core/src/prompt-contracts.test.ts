import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"

import { AuthorSectionSchema } from "./author-contracts.ts"
import { AnalysisDraftBaseSchema, CritiqueDraftSchema } from "./team.ts"

async function readAgentPrompt(file: string): Promise<string> {
  return readFile(new URL(`../../../assets/agents/${file}`, import.meta.url), "utf8")
}

function expectFields(prompt: string, fields: readonly string[]): void {
  for (const field of fields) expect(prompt).toContain(field)
}

const GRADED_SOURCE_FIELDS = [
  "id",
  "title",
  "isPrimary",
  "accountable",
  "methodTransparent",
  "independenceChainId",
  "hasCommercialOrIdeologicalConflict",
  "recent",
  "applicable",
  "grade",
  "accessedAt",
] as const

describe("agent prompt contracts", () => {
  it("explorer exposes the graded-source contract and search coverage", async () => {
    const prompt = await readAgentPrompt("explorer.md")

    expectFields(prompt, GRADED_SOURCE_FIELDS)
    expectFields(prompt, [
      "gradeBasis",
      "publishedAt",
      "publisher",
      "sourceType",
      "stance",
      "excerpt",
      "coverage",
      "queries",
      "channels",
      "blocked",
    ])
  })

  it("critic exposes the complete critique contract including loop control", async () => {
    const prompt = await readAgentPrompt("consultation-critic.md")

    expectFields(prompt, Object.keys(CritiqueDraftSchema.shape))
    expectFields(prompt, ["unresolvedGaps"])
  })

  it("analyst exposes the complete analysis contract", async () => {
    const prompt = await readAgentPrompt("analyst.md")

    expectFields(prompt, Object.keys(AnalysisDraftBaseSchema.shape))
    expectFields(prompt, ["verified", "refuted", "inferred", "unverifiable"])
  })

  it("writer exposes the author-section contract in its blueprint", async () => {
    const prompt = await readAgentPrompt("writer.md")

    expectFields(prompt, Object.keys(AuthorSectionSchema.shape))
    expectFields(prompt, ["sectionPlan", "continuityMap", "teachingBeats"])
  })

  it("consultant states dispatched-mode precedence and memory ownership", async () => {
    const prompt = await readAgentPrompt("consultant.md")

    expect(prompt).toContain("Dispatched mode overrides")
    expect(prompt).toContain("Memory ownership")
  })

  it("janus hands consultation memory to the consultant", async () => {
    const prompt = await readAgentPrompt("janus.md")

    expect(prompt).toContain("Memory ownership: consultant saves")
  })

  it("skill keeps the dispatched context and structured handoffs", async () => {
    const skill = await readFile(
      new URL("../../../assets/skills/consultation/SKILL.md", import.meta.url),
      "utf8",
    )

    expect(skill).toContain("Dispatched bounded task")
    expect(skill).toContain("Memory ownership")
    expect(skill).toContain("resolved")
    expect(skill).toContain("sectionPlan")
  })

  it("consultant prompt states the terminal-first double anchor", async () => {
    const prompt = await readAgentPrompt("consultant.md")

    for (const text of [
      "结论：",
      "下一步：",
      "证据与来源（可跳过）",
      "把握：高 / 中 / 低",
      "没有明显赢家",
      "100-120 characters",
    ]) {
      expect(prompt).toContain(text)
    }
  })

  it("skill defines the terminal readability rules and six mode templates", async () => {
    const skill = await readFile(
      new URL("../../../assets/skills/consultation/SKILL.md", import.meta.url),
      "utf8",
    )

    for (const text of [
      "Output Readability (Terminal-First)",
      "Double anchor",
      "Short vs full",
      "select: choose and try",
      "verify: verdict first",
      "plan: feasibility first",
      "research: bottom line then meaning",
      "guide: shortest path first",
      "author: delivery brief",
      "证据与来源（可跳过）",
      "没有明显赢家",
    ]) {
      expect(skill).toContain(text)
    }
  })
})
