import { describe, expect, test } from "bun:test"

import type { RiskLevel, Tier } from "./enums.ts"
import { routeTier } from "./tier-router.ts"
import type { TierRoutingInput } from "./tier-router.ts"

const risks = ["low", "medium", "high"] as const satisfies readonly RiskLevel[]
const booleans = [false, true] as const

// Independent transcription of the plan precedence rules (first match wins):
//   1. risk === "high" -> deep
//   2. reliableSourceConflict && synthesisDominated -> deep
//   3. !hasAuthoritativePrimarySource && synthesisDominated -> deep
//   4. risk === "low" && hasAuthoritativePrimarySource && !personalContextDependence && !synthesisDominated -> fast
//   5. otherwise -> standard
function expectedTier(input: TierRoutingInput): Tier {
  if (input.risk === "high") return "deep"
  if (input.reliableSourceConflict && input.synthesisDominated) return "deep"
  if (!input.hasAuthoritativePrimarySource && input.synthesisDominated) return "deep"
  if (
    input.risk === "low" &&
    input.hasAuthoritativePrimarySource &&
    !input.personalContextDependence &&
    !input.synthesisDominated
  ) {
    return "fast"
  }
  return "standard"
}

describe("routeTier", () => {
  test("selects the documented tier for every one of the 48 routing-input combinations", () => {
    // given: the full truth table over risk x auth x conflict x personal x synthesis
    let combinations = 0

    // when // then
    for (const risk of risks) {
      for (const hasAuthoritativePrimarySource of booleans) {
        for (const reliableSourceConflict of booleans) {
          for (const personalContextDependence of booleans) {
            for (const synthesisDominated of booleans) {
              const input: TierRoutingInput = {
                risk,
                hasAuthoritativePrimarySource,
                reliableSourceConflict,
                personalContextDependence,
                synthesisDominated,
              }
              expect(routeTier(input)).toBe(expectedTier(input))
              combinations += 1
            }
          }
        }
      }
    }

    // then: the table is exhaustive over 3 * 2 * 2 * 2 * 2 = 48 combinations
    expect(combinations).toBe(48)
  })

  test("routes to fast only for low-risk, authoritative, context-free, evidence-direct inputs", () => {
    // given: the two fast cases; conflict alone does not escalate when synthesis is off
    // when // then
    expect(
      routeTier({
        risk: "low",
        hasAuthoritativePrimarySource: true,
        reliableSourceConflict: false,
        personalContextDependence: false,
        synthesisDominated: false,
      }),
    ).toBe("fast")
    expect(
      routeTier({
        risk: "low",
        hasAuthoritativePrimarySource: true,
        reliableSourceConflict: true,
        personalContextDependence: false,
        synthesisDominated: false,
      }),
    ).toBe("fast")
  })

  test("routes every high-risk input to deep regardless of the other dimensions", () => {
    // given // when // then
    expect(
      routeTier({
        risk: "high",
        hasAuthoritativePrimarySource: true,
        reliableSourceConflict: false,
        personalContextDependence: false,
        synthesisDominated: false,
      }),
    ).toBe("deep")
    expect(
      routeTier({
        risk: "high",
        hasAuthoritativePrimarySource: false,
        reliableSourceConflict: false,
        personalContextDependence: true,
        synthesisDominated: true,
      }),
    ).toBe("deep")
  })

  test("routes to deep when synthesis is dominated and no authoritative primary source exists", () => {
    // given: medium risk, no authoritative source, synthesis dominated
    // when // then
    expect(
      routeTier({
        risk: "medium",
        hasAuthoritativePrimarySource: false,
        reliableSourceConflict: false,
        personalContextDependence: false,
        synthesisDominated: true,
      }),
    ).toBe("deep")
  })
})
