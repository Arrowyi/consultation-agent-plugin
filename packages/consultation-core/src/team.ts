import { z } from "zod"

import { ResearchBudgetSchema } from "./budget.ts"
import { ConfidenceSchema, SourceGradeSchema, TierSchema, type Tier } from "./enums.ts"
import { DecomposedClaimSchema } from "./research-contracts.ts"
import { GradedSourceSchema } from "./research-contracts.ts"

export const TeamRoleSchema = z.enum(["explorer", "analyst", "critic", "verifier"])
export type TeamRole = z.infer<typeof TeamRoleSchema>

export const TeamPhaseSchema = z.enum(["explore", "analyze", "critique", "synthesize"])
export type TeamPhase = z.infer<typeof TeamPhaseSchema>

export const TeamCapsSchema = z.object({
  roundCap: z.number().int().positive(),
  explorerCap: z.number().int().positive(),
  criticSearchCap: z.number().int().positive(),
})
export type TeamCaps = z.infer<typeof TeamCapsSchema>

export const DEFAULT_TEAM_CAPS: TeamCaps = {
  roundCap: 3,
  explorerCap: 5,
  criticSearchCap: 5,
}

export interface RoleCaps {
  explorer: number
  analyst: number
  critic: number
  verifier: number
}

export const TIER_ROLE_CAPS: Record<Tier, RoleCaps> = {
  fast: { explorer: 5, analyst: 0, critic: 0, verifier: 0 },
  standard: { explorer: 5, analyst: 1, critic: 1, verifier: 1 },
  deep: { explorer: 5, analyst: 3, critic: 2, verifier: 2 },
}

export function tierRoleCaps(tier: Tier): RoleCaps {
  return TIER_ROLE_CAPS[tier]
}

// Advisory only. The consultant watches usage and converges when approaching.
export const COST_GUARD_PROVIDER_USD = 10

export const ExplorerReportSchema = z.object({
  claims: z
    .array(
      z.object({
        claimId: z.string(),
        findings: z.string(),
        sources: z.array(GradedSourceSchema),
        gaps: z.array(z.string()).default([]),
      }),
    )
    .min(1),
})
export type ExplorerReport = z.infer<typeof ExplorerReportSchema>

export const AnalysisDraftSchema = z.object({
  claimId: z.string(),
  finding: z.string(),
  confidence: ConfidenceSchema,
  synthesisNote: z.string().optional(),
  gaps: z.array(z.string()).default([]),
})
export type AnalysisDraft = z.infer<typeof AnalysisDraftSchema>

export const ConfidenceAdjustmentSchema = z.enum(["raise", "keep", "lower", "reject"])
export type ConfidenceAdjustment = z.infer<typeof ConfidenceAdjustmentSchema>

export const CritiqueDraftSchema = z.object({
  round: z.number().int(),
  counterEvidence: z.array(
    z.object({
      claim: z.string(),
      sourceTitle: z.string(),
      sourceUrl: z.string().optional(),
      grade: SourceGradeSchema,
      whatItShows: z.string(),
    }),
  ),
  qualifyingEvidence: z.array(
    z.object({
      claim: z.string(),
      sourceTitle: z.string(),
      sourceUrl: z.string().optional(),
      condition: z.string(),
    }),
  ),
  supersedingEvidence: z.array(
    z.object({
      claim: z.string(),
      sourceTitle: z.string(),
      sourceUrl: z.string().optional(),
      replacesWhat: z.string(),
    }),
  ),
  flaws: z.array(z.string()),
  missingAlternatives: z.array(z.string()),
  provenanceProblems: z.array(z.string()),
  riskAssessment: z.string(),
  confidenceAdjustment: ConfidenceAdjustmentSchema,
  whatWouldChangeTheRecommendation: z.array(z.string()),
  resolved: z.boolean(),
})
export type CritiqueDraft = z.infer<typeof CritiqueDraftSchema>

export const ConsultationStateSchema = z.object({
  question: z.string(),
  constraints: z.array(z.string()).default([]),
  tier: TierSchema,
  round: z.number().int().default(0),
  phase: TeamPhaseSchema.default("explore"),
  claims: z.array(DecomposedClaimSchema).min(1),
  evidence: z.array(GradedSourceSchema).default([]),
  analysis: z.array(AnalysisDraftSchema).default([]),
  critiques: z.array(CritiqueDraftSchema).default([]),
  preferencesUsed: z.array(z.string()).default([]),
  budget: ResearchBudgetSchema,
})
export type ConsultationState = z.infer<typeof ConsultationStateSchema>

export interface InitialStateInput {
  question: string
  constraints?: string[]
  tier: Tier
  claims: z.infer<typeof DecomposedClaimSchema>[]
  budget: z.infer<typeof ResearchBudgetSchema>
}

export function initialState(input: InitialStateInput): ConsultationState {
  return {
    question: input.question,
    constraints: input.constraints ?? [],
    tier: input.tier,
    round: 0,
    phase: "explore",
    claims: input.claims,
    evidence: [],
    analysis: [],
    critiques: [],
    preferencesUsed: [],
    budget: input.budget,
  }
}

export function isConverged(critiques: readonly CritiqueDraft[]): boolean {
  if (critiques.length === 0) return false
  const latest = critiques[critiques.length - 1]
  return latest !== undefined && latest.resolved
}

/**
 * Deterministic phase transition for the team loop.
 *
 * explore -> analyze -> critique -> (explore | synthesize). A non-resolved
 * critique starts a new round (explore). The loop terminates with
 * "synthesize" when the latest critique is resolved or the round cap is
 * reached. A consultant that does not settle by the cap must deliver with
 * residual uncertainty annotated.
 */
export function nextAction(state: ConsultationState, caps: TeamCaps = DEFAULT_TEAM_CAPS): TeamPhase {
  if (isConverged(state.critiques)) return "synthesize"
  if (state.round >= caps.roundCap) return "synthesize"
  switch (state.phase) {
    case "explore":
      return "analyze"
    case "analyze":
      return "critique"
    case "critique":
      return "explore"
    case "synthesize":
      return "synthesize"
  }
}

/**
 * Record a critique pass: append it, increment the round, and move the phase
 * to "critique" (the phase the state was in when the critique landed). The
 * next `nextAction` call then resolves explore versus synthesize.
 */
export function withCritique(state: ConsultationState, critique: CritiqueDraft): ConsultationState {
  return {
    ...state,
    critiques: [...state.critiques, critique],
    round: state.round + 1,
    phase: "critique",
  }
}
