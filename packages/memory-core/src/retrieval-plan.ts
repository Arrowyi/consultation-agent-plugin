import type { ConsultationTier, RevisionStatus } from "./enums.ts"

export type RetrievalPlan = {
  readonly limit: number
  readonly expandTop: number
  readonly tokenBudget: number
  readonly includeStatuses: readonly RevisionStatus[]
}

export type RetrievalPlanOverrides = Partial<RetrievalPlan>

const plans: Readonly<Record<ConsultationTier, RetrievalPlan>> = {
  fast: { limit: 3, expandTop: 0, tokenBudget: 300, includeStatuses: ["active"] },
  standard: { limit: 8, expandTop: 3, tokenBudget: 1200, includeStatuses: ["active"] },
  deep: { limit: 8, expandTop: 3, tokenBudget: 3000, includeStatuses: ["active", "superseded", "refuted"] },
}

export function planRetrieval(tier: ConsultationTier, overrides: RetrievalPlanOverrides = {}): RetrievalPlan {
  return { ...plans[tier], ...overrides }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
