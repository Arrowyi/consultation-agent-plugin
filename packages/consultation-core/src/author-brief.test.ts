import { describe, expect, test } from "bun:test"

import { validateDecisionBrief } from "./decision-brief.ts"
import { ConsultationError } from "./errors.ts"

const authorBrief = {
  mode: "author",
  conclusion: "The approved tutorial was written and its load-bearing examples were verified.",
  profile: "tutorial",
  audience: "Kotlin developers new to coroutines",
  goal: "Teach structured concurrency from mental model to tested examples.",
  delivery: "multi_file",
  verification: "targeted",
  styleSummary: "Progressive, example-led, and explicit about public APIs versus internals.",
  outline: [
    {
      id: "index",
      title: "Course map",
      purpose: "Describe audience, scope, and reading order.",
      file: "README.md",
    },
    {
      id: "structured-concurrency",
      title: "Structured concurrency",
      purpose: "Teach ownership and cancellation propagation.",
      file: "03-structured-concurrency.md",
      verificationTargets: ["Compile and run cancellation example."],
    },
  ],
  loadBearingClaims: [
    {
      claim: "A parent Job cancellation propagates to its children.",
      sectionIds: ["structured-concurrency"],
      status: "verified",
      verificationMethod: "Official API docs and executable example",
    },
  ],
  artifactPaths: ["README.md", "03-structured-concurrency.md"],
  assumptions: ["Kotlin 2.x and kotlinx.coroutines are available."],
  residualUncertainty: [],
  confidence: "high",
  stability: "conditional",
  verifiedFacts: ["The representative cancellation example compiled and ran."],
  synthesis: ["The tutorial separates stable API behavior from runtime internals."],
  sources: [{ title: "kotlinx.coroutines API", grade: "high" }],
  nextAction: "Review the course map and begin with the mental-model chapter.",
  memoryDisclosure: [],
}

function briefWith(base: Record<string, unknown>, override: Record<string, unknown>): unknown {
  return { ...base, ...override }
}

function outlineWith(patch: Record<string, unknown>): unknown {
  return [
    {
      id: "index",
      title: "Course map",
      purpose: "Describe audience, scope, and reading order.",
      file: "README.md",
    },
    {
      id: "structured-concurrency",
      title: "Structured concurrency",
      purpose: "Teach ownership and cancellation propagation.",
      file: "03-structured-concurrency.md",
      verificationTargets: ["Compile and run cancellation example."],
      ...patch,
    },
  ]
}

function claimsWith(patch: Record<string, unknown>): unknown {
  return [
    {
      claim: "A parent Job cancellation propagates to its children.",
      sectionIds: ["structured-concurrency"],
      status: "verified",
      verificationMethod: "Official API docs and executable example",
      ...patch,
    },
  ]
}

describe("validateDecisionBrief: author delivery", () => {
  test("accepts a valid multi-file final brief", () => {
    const brief = validateDecisionBrief(authorBrief)
    if (brief.mode !== "author") throw new Error("expected author mode")
    expect(brief.artifactPaths).toHaveLength(2)
  })

  test("accepts inline delivery with zero artifact paths", () => {
    const brief = validateDecisionBrief(briefWith(authorBrief, { delivery: "inline", artifactPaths: [] }))
    if (brief.mode !== "author") throw new Error("expected author mode")
    expect(brief.artifactPaths).toHaveLength(0)
  })

  test("rejects inline delivery with artifact paths", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(authorBrief, { delivery: "inline", artifactPaths: ["README.md"] }))
    }
    expect(validate).toThrow(ConsultationError)
    expect(validate).toThrow("VALIDATION_FAILED")
  })

  test("accepts single_file delivery with exactly one artifact path", () => {
    const brief = validateDecisionBrief(
      briefWith(authorBrief, { delivery: "single_file", artifactPaths: ["kotlin-coroutines-tutorial.md"] }),
    )
    if (brief.mode !== "author") throw new Error("expected author mode")
    expect(brief.artifactPaths).toEqual(["kotlin-coroutines-tutorial.md"])
  })

  test("rejects single_file delivery with zero artifact paths", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(authorBrief, { delivery: "single_file", artifactPaths: [] }))
    }
    expect(validate).toThrow(ConsultationError)
    expect(validate).toThrow("VALIDATION_FAILED")
  })

  test("rejects single_file delivery with two artifact paths", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(authorBrief, { delivery: "single_file" }))
    }
    expect(validate).toThrow(ConsultationError)
    expect(validate).toThrow("VALIDATION_FAILED")
  })

  test("rejects multi-file delivery with only one section", () => {
    const validate = (): void => {
      validateDecisionBrief({
        ...authorBrief,
        outline: [authorBrief.outline[0]],
        artifactPaths: ["README.md"],
      })
    }
    expect(validate).toThrow(ConsultationError)
    expect(validate).toThrow("VALIDATION_FAILED")
  })

  test("rejects multi-file delivery with only one artifact path", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(authorBrief, { artifactPaths: ["README.md"] }))
    }
    expect(validate).toThrow(ConsultationError)
    expect(validate).toThrow("VALIDATION_FAILED")
  })
})

describe("validateDecisionBrief: author numeric confidence", () => {
  const authorNumericCases: Array<[string, Record<string, unknown>]> = [
    ["the conclusion", { conclusion: "The tutorial is 85% complete." }],
    ["the audience", { audience: "85% of Kotlin developers" }],
    ["the goal", { goal: "Teach 85% of structured concurrency." }],
    ["the style summary", { styleSummary: "Examples are 95% reliable." }],
    ["an artifact path", { artifactPaths: ["README.md", "85%-notes.md"] }],
    ["an assumption", { assumptions: ["85% of readers know Kotlin."] }],
    ["a residual uncertainty", { residualUncertainty: ["Coroutine internals may shift 85%."] }],
    ["a verified fact", { verifiedFacts: ["The example compiled in 85% of runs."] }],
    ["a synthesis line", { synthesis: ["85% of the tutorial is example-led."] }],
    ["a source title", { sources: [{ title: "85% coroutines API", grade: "high" }] }],
    ["a source url", { sources: [{ title: "kotlinx.coroutines API", url: "https://example.com/85%-off", grade: "high" }] }],
    ["the next action", { nextAction: "85% confident, start writing." }],
    ["a memory disclosure", { memoryDisclosure: ["85% from memory"] }],
    ["a section id", { outline: outlineWith({ id: "85%-section" }) }],
    ["a section title", { outline: outlineWith({ title: "85% concurrency" }) }],
    ["a section purpose", { outline: outlineWith({ purpose: "Teach 85% of cancellation." }) }],
    ["a section file", { outline: outlineWith({ file: "85%-file.md" }) }],
    ["a learning objective", { outline: outlineWith({ learningObjectives: ["Explain 85% of jobs."] }) }],
    ["a section prerequisite", { outline: outlineWith({ prerequisites: ["85% Kotlin knowledge"] }) }],
    ["a verification target", { outline: outlineWith({ verificationTargets: ["Passes 85% of runs."] }) }],
    ["a load-bearing claim", { loadBearingClaims: claimsWith({ claim: "Cancellation propagates 85% of the time." }) }],
    ["a claim section id", { loadBearingClaims: claimsWith({ sectionIds: ["85%-section"] }) }],
    ["a verification method", { loadBearingClaims: claimsWith({ verificationMethod: "85% of docs agree." }) }],
    ["a claim basis", { loadBearingClaims: claimsWith({ status: "inferred", basis: "85% of reports agree." }) }],
  ]

  for (const [label, override] of authorNumericCases) {
    test(`rejects invented numeric confidence in ${label}`, () => {
      const validate = (): void => {
        validateDecisionBrief(briefWith(authorBrief, override))
      }
      expect(validate).toThrow(ConsultationError)
      expect(validate).toThrow("NUMERIC_CONFIDENCE")
    })
  }
})
