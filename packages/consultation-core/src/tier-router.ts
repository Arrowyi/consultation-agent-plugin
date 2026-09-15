import type { RiskLevel, Tier } from "./enums.ts"

export type TierRoutingInput = {
  readonly risk: RiskLevel
  readonly hasAuthoritativePrimarySource: boolean
  readonly reliableSourceConflict: boolean
  readonly personalContextDependence: boolean
  readonly synthesisDominated: boolean
}

export function routeTier(input: TierRoutingInput): Tier {
  switch (input.risk) {
    case "high":
      return "deep"
    case "low":
      if (
        (input.reliableSourceConflict && input.synthesisDominated) ||
        (!input.hasAuthoritativePrimarySource && input.synthesisDominated)
      ) {
        return "deep"
      }
      if (
        input.hasAuthoritativePrimarySource &&
        !input.personalContextDependence &&
        !input.synthesisDominated
      ) {
        return "fast"
      }
      return "standard"
    case "medium":
      if (
        (input.reliableSourceConflict && input.synthesisDominated) ||
        (!input.hasAuthoritativePrimarySource && input.synthesisDominated)
      ) {
        return "deep"
      }
      return "standard"
  }
}
