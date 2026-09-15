#!/usr/bin/env bun
// Evaluation runner for the consultation agent plugin.
//
// Loads the two fixture files (consultation-cases.json, memory-cases.json),
// prints a per-case checklist grouped by grading tier, marks deterministic
// cases with the package unit test file that covers them, and prints MANUAL
// plus the rubric question for model-graded cases. No live model calls.
//
// Run from the repo root:  bun run evals/run-evals.ts

import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, "..")
const fixturesDir = join(here, "fixtures")

type Grading = "deterministic" | "model"

interface EvalCase {
  id: string
  title: string
  given: string
  when: string
  then: string
  grading: Grading
  notes?: string
}

// Inline convention table: deterministic case id -> package unit test file(s)
// that cover it. Paths are relative to the repo root. Model-graded cases are
// intentionally absent; they need a live model.
const DETERMINISTIC_TEST_MAP: Record<string, string[]> = {
  C1: ["packages/consultation-core/src/tier-router.test.ts"],
  C2: [
    "packages/consultation-core/src/source-grading.test.ts",
    "packages/memory-core/src/provenance.test.ts",
  ],
  C9: ["packages/memory-core/src/injection.test.ts"],
  M1: ["packages/memory-sqlite/src/store.test.ts"],
  M2: ["packages/memory-sqlite/src/store.test.ts"],
  M4: [
    "packages/memory-sqlite/src/store.test.ts",
    "packages/memory-core/src/retrieval-plan.test.ts",
  ],
  M6: [
    "packages/memory-core/src/retrieval-plan.test.ts",
    "packages/memory-sqlite/src/store.test.ts",
  ],
  M7: ["packages/memory-sqlite/src/store.test.ts"],
  M8: ["packages/memory-sqlite/src/store.test.ts"],
  M9: ["packages/memory-sqlite/src/store.test.ts"],
  M10: ["packages/memory-sqlite/src/cli.test.ts"],
  M11: ["packages/memory-sqlite/src/store.test.ts"],
  M12: ["packages/memory-sqlite/src/writer-lock.test.ts"],
}

const FIXTURES: Array<{ file: string; label: string }> = [
  { file: "consultation-cases.json", label: "Consultation cases (architecture 17.1)" },
  { file: "memory-cases.json", label: "Memory cases (architecture 17.2)" },
]

function extractRubric(notes: string | undefined): string {
  if (notes === undefined) {
    return "Reviewer must judge whether the live model output satisfies the case's then-clause."
  }
  const marker = "Rubric:"
  const idx = notes.indexOf(marker)
  if (idx === -1) return notes
  return notes.slice(idx + marker.length).trim()
}

async function loadCases(file: string): Promise<EvalCase[]> {
  const path = join(fixturesDir, file)
  if (!existsSync(path)) {
    throw new Error(`fixture not found: ${path}`)
  }
  const data = (await Bun.file(path).json()) as EvalCase[]
  if (!Array.isArray(data)) {
    throw new Error(`fixture ${file} is not a JSON array`)
  }
  return data
}

function verifyTestFilesExist(files: string[]): string[] {
  const missing: string[] = []
  for (const file of files) {
    if (!existsSync(join(repoRoot, file))) {
      missing.push(file)
    }
  }
  return missing
}

function printGroup(label: string, cases: EvalCase[]): void {
  console.log("")
  console.log(`=== ${label} (${cases.length}) ===`)
  for (const c of cases) {
    console.log("")
    console.log(`  [${c.id}] ${c.title}`)
    console.log(`    given: ${c.given}`)
    console.log(`    when:  ${c.when}`)
    console.log(`    then:  ${c.then}`)
    if (c.grading === "deterministic") {
      const files = DETERMINISTIC_TEST_MAP[c.id]
      if (files === undefined) {
        console.log(`    status: UNMAPPED (graded deterministic but no test file in the inline table)`)
      } else {
        const missing = verifyTestFilesExist(files)
        if (missing.length > 0) {
          console.log(`    status: MISSING-TEST (${missing.join(", ")})`)
        } else {
          console.log(`    status: PASS (deterministic) -> ${files.join(", ")}`)
        }
      }
    } else {
      console.log(`    status: MANUAL (model-graded)`)
      console.log(`    rubric: ${extractRubric(c.notes)}`)
    }
  }
}

async function main(): Promise<void> {
  const loaded: Array<{ label: string; cases: EvalCase[] }> = []
  for (const fixture of FIXTURES) {
    loaded.push({ label: fixture.label, cases: await loadCases(fixture.file) })
  }

  const all = loaded.flatMap((g) => g.cases)
  const deterministic = all.filter((c) => c.grading === "deterministic")
  const model = all.filter((c) => c.grading === "model")

  console.log("consultation-agent-plugin evaluation checklist")
  for (const g of loaded) {
    console.log(`  ${g.label}: ${g.cases.length} cases`)
  }
  console.log(`totals: ${deterministic.length} deterministic, ${model.length} model, ${all.length} all`)

  printGroup("DETERMINISTIC (covered by package unit tests)", deterministic)
  printGroup("MODEL-GRADED (require a live model; reviewer rubric)", model)

  const unmapped = deterministic.filter((c) => DETERMINISTIC_TEST_MAP[c.id] === undefined)
  const missingOnDisk = deterministic.flatMap((c) =>
    (DETERMINISTIC_TEST_MAP[c.id] ?? [])
      .filter((f) => !existsSync(join(repoRoot, f)))
      .map((f) => `${c.id} -> ${f}`),
  )

  console.log("")
  console.log("=== summary ===")
  console.log(`  deterministic cases: ${deterministic.length}`)
  console.log(`  model-graded cases:  ${model.length}`)
  console.log(`  unmapped deterministic: ${unmapped.length}`)
  console.log(`  test files missing on disk: ${missingOnDisk.length}`)
  if (unmapped.length > 0) {
    console.log(`  unmapped ids: ${unmapped.map((c) => c.id).join(", ")}`)
  }
  if (missingOnDisk.length > 0) {
    console.log(`  missing: ${missingOnDisk.join("; ")}`)
  }

  console.log("")
  console.log("done. deterministic cases are run by: bun test")
  console.log("model-graded cases require a live model run and a reviewer against the rubric above.")
  process.exit(0)
}

await main()
