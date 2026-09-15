import { describe, expect, test } from "bun:test"

import { assertNoNumericConfidence, validateDecisionBrief } from "./decision-brief.ts"
import { ConsultationError } from "./errors.ts"

const selectBrief = {
  mode: "select",
  conclusion: "Choose the reversible option first.",
  suitedFor: "People who value a cautious trial.",
  benefits: ["Reversible", "Lower cost", "Clear stopping condition"],
  risks: ["Requires monitoring", "May take longer", "Evidence can change"],
  candidates: [
    { option: "Option A", evidenceGrade: "high", intent: "clean", trialAdvice: "Try a sample first." },
    { option: "Option B", evidenceGrade: "low" },
  ],
  switchConditions: ["Switch to B if A fails its stopping condition."],
  confidence: "medium",
  stability: "conditional",
  verifiedFacts: ["The trial is reversible."],
  synthesis: ["The reversible option better fits a cautious preference."],
  sources: [
    { title: "Source 1", grade: "high" },
    { title: "Source 2", grade: "high" },
    { title: "Source 3", grade: "medium" },
    { title: "Source 4", grade: "medium" },
    { title: "Source 5", grade: "low" },
  ],
  nextAction: "Confirm the stopping condition before starting.",
  memoryDisclosure: ["A preference for reversibility shaped the recommendation."],
}

const verifyBrief = {
  mode: "verify",
  conclusion: "The claim is unverifiable.",
  verdict: "unverifiable",
  claimVerdicts: [
    { claim: "It works.", status: "inferred", basis: "Based on three independent user reports." },
    { claim: "It is safe.", status: "verified", evidence: ["Lab report"] },
  ],
  supportingEvidence: ["Three independent reports"],
  opposingEvidence: ["No controlled trial"],
  contaminationNote: "Evidence may be contaminated by positive shilling.",
  confidence: "low",
  stability: "provisional",
  verifiedFacts: ["No controlled trial exists."],
  synthesis: ["The efficacy claim rests on inference."],
  sources: [{ title: "Source 1", grade: "low" }],
  nextAction: "Seek a controlled trial before relying on this.",
  memoryDisclosure: [],
}

const planBrief = {
  mode: "plan",
  conclusion: "Follow a progressive plan.",
  goal: "Build strength safely.",
  suitedFor: "Healthy adults.",
  steps: [
    { step: "Start with bodyweight.", support: "verified" },
    { step: "Add load weekly.", support: "inferred", basis: "Standard progressive overload principle." },
  ],
  assumptions: ["No prior injury."],
  healthNote: "Consult a professional if you have a chronic condition.",
  alternatives: [{ option: "Hire a coach", switchCondition: "If form stalls." }],
  confidence: "high",
  stability: "stable",
  verifiedFacts: ["Progressive overload builds strength."],
  synthesis: ["A gradual plan reduces injury risk."],
  sources: [{ title: "Source 1", grade: "high" }],
  nextAction: "Schedule the first session.",
  memoryDisclosure: [],
}

const researchBrief = {
  mode: "research",
  conclusion: "Intermittent fasting helps some people lose weight, mainly by reducing intake.",
  keyPoints: [
    "Weight loss comes mostly from eating less, not a metabolic trick.",
    "It suits people who prefer simple rules over counting calories.",
  ],
  soWhat: "If you dislike tracking calories, a time window is a simpler rule to follow.",
  hypotheses: [
    {
      hypothesis: "The benefit is mostly caloric restriction",
      confidence: "high",
      support: "RCTs show similar loss to daily restriction",
      counter: "Some people adhere better to a time window",
    },
  ],
  disagreements: ["Long-term adherence data is mixed"],
  residualUncertainty: ["Effects beyond 12 months are not well studied"],
  confidence: "medium",
  stability: "conditional",
  verifiedFacts: ["Several RCTs compare intermittent fasting to daily caloric restriction."],
  synthesis: ["The main mechanism is reduced intake."],
  sources: [{ title: "IF meta-analysis", grade: "high" }],
  nextAction: "Try a 16:8 window for two weeks and watch energy.",
  memoryDisclosure: [],
}

function briefWith(base: Record<string, unknown>, override: Record<string, unknown>): unknown {
  return { ...base, ...override }
}

describe("validateDecisionBrief: select", () => {
  test("accepts a maximal valid select brief", () => {
    const brief = validateDecisionBrief(selectBrief)
    if (brief.mode !== "select") throw new Error("expected select mode")
    expect(brief.benefits).toHaveLength(3)
    expect(brief.sources).toHaveLength(5)
  })

  test("defaults candidate intent to unknown when omitted", () => {
    const brief = validateDecisionBrief(selectBrief)
    if (brief.mode !== "select") throw new Error("expected select mode")
    expect(brief.candidates[1]?.intent).toBe("unknown")
  })

  test("rejects more than three benefits", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(selectBrief, { benefits: ["b1", "b2", "b3", "b4"] }))
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects more than five sources", () => {
    const sources = Array.from({ length: 6 }, (_, i) => ({ title: `s${i}`, grade: "high" }))
    const validate = (): void => {
      validateDecisionBrief(briefWith(selectBrief, { sources }))
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects a brief with zero sources", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(selectBrief, { sources: [] }))
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects a brief with zero candidates", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(selectBrief, { candidates: [] }))
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects a brief with a missing next action", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(selectBrief, { nextAction: "" }))
    }
    expect(validate).toThrow(ConsultationError)
  })
})

describe("validateDecisionBrief: verify", () => {
  test("accepts a valid verify brief with basis on inferred claims", () => {
    const brief = validateDecisionBrief(verifyBrief)
    expect(brief.mode).toBe("verify")
    if (brief.mode !== "verify") throw new Error("expected verify mode")
    expect(brief.claimVerdicts).toHaveLength(2)
  })

  test("rejects an inferred claim without a basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(verifyBrief, { claimVerdicts: [{ claim: "It works.", status: "inferred" }] }),
      )
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("rejects an unverifiable claim without a basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(verifyBrief, { claimVerdicts: [{ claim: "It works.", status: "unverifiable" }] }),
      )
    }
    expect(validate).toThrow(ConsultationError)
  })
})

describe("validateDecisionBrief: plan", () => {
  test("accepts a valid plan brief", () => {
    const brief = validateDecisionBrief(planBrief)
    expect(brief.mode).toBe("plan")
    if (brief.mode !== "plan") throw new Error("expected plan mode")
    expect(brief.steps).toHaveLength(2)
  })

  test("rejects an inferred step without a basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(planBrief, { steps: [{ step: "Add load.", support: "inferred" }] }),
      )
    }
    expect(validate).toThrow(ConsultationError)
  })

  test("accepts a plan with step alternatives, per-step confidence, and residual uncertainty", () => {
    const brief = validateDecisionBrief(
      briefWith(planBrief, {
        steps: [
          { step: "Start with bodyweight.", support: "verified", alternatives: ["Start with bands"] },
          { step: "Add load weekly.", support: "inferred", basis: "Overload principle.", confidence: "low" },
        ],
        residualUncertainty: "The loading rate is uncertain; start conservatively.",
      }),
    )
    if (brief.mode !== "plan") throw new Error("expected plan mode")
    expect(brief.steps[0]?.alternatives).toEqual(["Start with bands"])
    expect(brief.residualUncertainty).toContain("uncertain")
  })
})

describe("validateDecisionBrief: research", () => {
  test("accepts a valid research brief", () => {
    const brief = validateDecisionBrief(researchBrief)
    if (brief.mode !== "research") throw new Error("expected research mode")
    expect(brief.keyPoints).toHaveLength(2)
    expect(brief.hypotheses).toHaveLength(1)
    expect(brief.residualUncertainty).toHaveLength(1)
  })

  test("rejects a research brief with zero key points", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(researchBrief, { keyPoints: [] }))
    }
    expect(validate).toThrow(ConsultationError)
  })
})

describe("validateDecisionBrief: numeric confidence", () => {
  const selectNumericCases: Array<[string, Record<string, unknown>]> = [
    ["conclusion", { conclusion: "I am 85% sure." }],
    ["suitedFor", { suitedFor: "Suits 85% of users." }],
    ["a benefit", { benefits: ["85% effective"] }],
    ["a risk", { risks: ["85% failure rate"] }],
    ["a candidate option", { candidates: [{ option: "85% option", evidenceGrade: "high" }] }],
    ["a switch condition", { switchConditions: ["85% condition"] }],
    ["a verified fact", { verifiedFacts: ["85% verified"] }],
    ["a synthesis line", { synthesis: ["85% inferred"] }],
    ["a source title", { sources: [{ title: "85% Source", grade: "high" }] }],
    ["a source url", { sources: [{ title: "Source", url: "https://example.com/85%-off", grade: "high" }] }],
    ["the next action", { nextAction: "85% confident, proceed." }],
    ["a memory disclosure", { memoryDisclosure: ["85% from memory"] }],
  ]

  for (const [label, override] of selectNumericCases) {
    test(`rejects invented numeric confidence in ${label}`, () => {
      const validate = (): void => {
        validateDecisionBrief(briefWith(selectBrief, override))
      }
      expect(validate).toThrow(ConsultationError)
      expect(validate).toThrow("NUMERIC_CONFIDENCE")
    })
  }

  test("rejects numeric confidence in a verify claim basis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(verifyBrief, {
          claimVerdicts: [{ claim: "It works.", status: "inferred", basis: "85% of reports agree." }],
        }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a plan step risk", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(planBrief, { steps: [{ step: "Add load.", support: "verified", risk: "85% injury risk" }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a plan step alternative", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(planBrief, { steps: [{ step: "Add load.", support: "verified", alternatives: ["85% better"] }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in residual uncertainty", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(planBrief, { residualUncertainty: "85% likely to fail" }))
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a research key point", () => {
    const validate = (): void => {
      validateDecisionBrief(briefWith(researchBrief, { keyPoints: ["Works 85% of the time"] }))
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })

  test("rejects numeric confidence in a research hypothesis", () => {
    const validate = (): void => {
      validateDecisionBrief(
        briefWith(researchBrief, { hypotheses: [{ hypothesis: "85% adherence", confidence: "high" }] }),
      )
    }
    expect(validate).toThrow("NUMERIC_CONFIDENCE")
  })
})

describe("assertNoNumericConfidence", () => {
  test("rejects a percentage confidence pattern", () => {
    const assert = (): void => assertNoNumericConfidence("The confidence is 85%.")
    expect(assert).toThrow("NUMERIC_CONFIDENCE")
  })

  test("allows text without a numeric confidence pattern", () => {
    const assert = (): void => assertNoNumericConfidence("The evidence supports a cautious trial.")
    expect(assert).not.toThrow()
  })

  test("rejects a percentage with surrounding whitespace", () => {
    const assert = (): void => assertNoNumericConfidence("confidence 85 %")
    expect(assert).toThrow("NUMERIC_CONFIDENCE")
  })
})
