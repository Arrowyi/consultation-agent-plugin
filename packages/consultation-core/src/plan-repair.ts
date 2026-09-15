import type { Confidence, EpistemicStatus } from "./enums.ts"

/**
 * Bounded local backtrack for plan-mode robustness review. Each repair round
 * reconsiders only the nearest earlier decision points rather than re-opening
 * the whole plan; the round cap bounds total rounds, so the root is reached
 * only across cheap rounds, never by an exhaustive search.
 */
export const BACKTRACK_DEPTH_CAP = 2

export interface PlanStepLike {
  readonly support: EpistemicStatus
  readonly confidence?: Confidence
}

export function needsBacktrack(step: PlanStepLike): boolean {
  if (step.support === "unverifiable") return true
  return step.support === "inferred" && step.confidence === "low"
}

export function backtrackFrontier(flaggedIndex: number, depthCap: number = BACKTRACK_DEPTH_CAP): number[] {
  const frontier: number[] = []
  for (let index = flaggedIndex - 1; index >= 0 && frontier.length < depthCap; index--) {
    frontier.push(index)
  }
  return frontier
}
