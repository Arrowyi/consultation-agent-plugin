import { describe, expect, it } from "bun:test"

import {
  DEFAULT_TEAM_CAPS,
  TeamRoleSchema,
  initialState,
  isConverged,
  nextAction,
  tierRoleCaps,
  withCritique,
  type ConsultationState,
  type CritiqueDraft,
} from "./team.ts"
import type { DecomposedClaim } from "./research-contracts.ts"

const budget = { maxSearches: 10, maxFetches: 10, maxSubagents: 6, maxTokens: 10000 }
const claims: DecomposedClaim[] = [
  { id: "c1", text: "claim one", kind: "fact", requiresCounterEvidence: false },
]

function crit(resolved: boolean, round: number): CritiqueDraft {
  return {
    round,
    counterEvidence: [],
    qualifyingEvidence: [],
    supersedingEvidence: [],
    flaws: [],
    missingAlternatives: [],
    provenanceProblems: [],
    riskAssessment: "ok",
    confidenceAdjustment: "keep",
    whatWouldChangeTheRecommendation: [],
    resolved,
  }
}

describe("initialState", () => {
  it("starts at phase explore, round 0, empty artifacts", () => {
    // given // when
    const state = initialState({ question: "q", tier: "standard", claims, budget })

    // then
    expect(state.phase).toBe("explore")
    expect(state.round).toBe(0)
    expect(state.evidence).toEqual([])
    expect(state.analysis).toEqual([])
    expect(state.critiques).toEqual([])
  })
})

describe("nextAction", () => {
  it("moves explore -> analyze -> critique on the first pass", () => {
    // given
    const state = initialState({ question: "q", tier: "standard", claims, budget })

    // when // then
    expect(nextAction(state)).toBe("analyze")
    const analyzed = { ...state, phase: "analyze" as const }
    expect(nextAction(analyzed)).toBe("critique")
  })

  it("returns explore after a non-resolved critique, starting a new round", () => {
    // given
    let state = initialState({ question: "q", tier: "standard", claims, budget })
    state = withCritique(state, crit(false, 0))

    // when // then
    expect(state.round).toBe(1)
    expect(nextAction(state)).toBe("explore")
  })

  it("synthesizes when the latest critique is resolved", () => {
    // given
    let state = initialState({ question: "q", tier: "deep", claims, budget })
    state = withCritique(state, crit(true, 0))

    // when // then
    expect(nextAction(state)).toBe("synthesize")
  })

  it("synthesizes at the round cap even when unresolved", () => {
    // given
    let state = initialState({ question: "q", tier: "deep", claims, budget })
    state = withCritique(state, crit(false, 0))
    state = withCritique(state, crit(false, 1))
    state = withCritique(state, crit(false, 2))

    // when // then
    expect(state.round).toBe(DEFAULT_TEAM_CAPS.roundCap)
    expect(nextAction(state)).toBe("synthesize")
  })

  it("respects an overridden smaller round cap", () => {
    // given
    let state = initialState({ question: "q", tier: "deep", claims, budget })
    state = withCritique(state, crit(false, 0))

    // when // then
    expect(nextAction(state, { ...DEFAULT_TEAM_CAPS, roundCap: 1 })).toBe("synthesize")
  })
})

describe("isConverged", () => {
  it("is false with no critiques and true when the latest is resolved", () => {
    // given // when // then
    expect(isConverged([])).toBe(false)
    expect(isConverged([crit(false, 0)])).toBe(false)
    expect(isConverged([crit(false, 0), crit(true, 1)])).toBe(true)
  })
})

describe("TeamRoleSchema", () => {
  it("lists every team role including writer", () => {
    // given // when // then
    expect(TeamRoleSchema.options).toEqual(["explorer", "analyst", "critic", "verifier", "writer"])
  })
})

describe("tierRoleCaps", () => {
  it("encodes the tier matrix including writer", () => {
    // given // when // then
    expect(tierRoleCaps("fast")).toEqual({ explorer: 5, analyst: 0, critic: 0, verifier: 0, writer: 0 })
    expect(tierRoleCaps("standard")).toEqual({ explorer: 5, analyst: 1, critic: 1, verifier: 1, writer: 1 })
    expect(tierRoleCaps("deep")).toEqual({ explorer: 5, analyst: 3, critic: 2, verifier: 2, writer: 2 })
  })
})

describe("DEFAULT_TEAM_CAPS", () => {
  it("caps rounds at 3, explorers at 5, critic searches at 5", () => {
    // given // when // then
    expect(DEFAULT_TEAM_CAPS).toEqual({ roundCap: 3, explorerCap: 5, criticSearchCap: 5 })
  })
})
