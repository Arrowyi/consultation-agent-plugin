import { describe, expect, test } from "bun:test"

import { gradeIntent, gradeSource, groupByChain } from "./source-grading.ts"
import type { IntentSignals, SourceInput } from "./source-grading.ts"

const source = (overrides: Partial<SourceInput> = {}): SourceInput => ({
  id: "source-1",
  title: "Source",
  isPrimary: false,
  accountable: false,
  methodTransparent: true,
  independenceChainId: "chain-1",
  hasCommercialOrIdeologicalConflict: false,
  recent: true,
  applicable: true,
  ...overrides,
})

describe("gradeSource", () => {
  test("returns lead_only for an inapplicable source before every other rule", () => {
    // given: primary + accountable + transparent, but not applicable
    const input = source({ isPrimary: true, accountable: true, methodTransparent: true, applicable: false })

    // when
    const grade = gradeSource(input)

    // then: first-match-wins, inapplicability dominates even a perfect primary source
    expect(grade).toBe("lead_only")
  })

  test("returns high for a transparent accountable primary source without conflict", () => {
    // given // when
    const grade = gradeSource(source({ isPrimary: true, accountable: true }))

    // then
    expect(grade).toBe("high")
  })

  test("returns medium for a recent transparent primary source without accountability", () => {
    // given: primary but not accountable -> rule 2 fails, rule 3 matches via isPrimary
    // when
    const grade = gradeSource(source({ isPrimary: true, accountable: false }))

    // then
    expect(grade).toBe("medium")
  })

  test("returns medium for a recent transparent accountable secondary source", () => {
    // given: accountable but not primary -> rule 2 fails, rule 3 matches via accountable
    // when
    const grade = gradeSource(source({ isPrimary: false, accountable: true }))

    // then
    expect(grade).toBe("medium")
  })

  test("returns low for a conflicted source even when primary, accountable, and transparent", () => {
    // given: conflict short-circuits past the high rule
    const input = source({
      isPrimary: true,
      accountable: true,
      methodTransparent: true,
      hasCommercialOrIdeologicalConflict: true,
    })

    // when
    const grade = gradeSource(input)

    // then
    expect(grade).toBe("low")
  })

  test("returns low for an opaque source even when primary and accountable", () => {
    // given: !methodTransparent short-circuits past the medium rule
    const input = source({ isPrimary: true, accountable: true, methodTransparent: false })

    // when
    const grade = gradeSource(input)

    // then
    expect(grade).toBe("low")
  })

  test("returns lead_only when no stronger rule applies (neither primary nor accountable)", () => {
    // given: applicable, transparent, no conflict, but neither primary nor accountable
    const input = source({ isPrimary: false, accountable: false, recent: true })

    // when
    const grade = gradeSource(input)

    // then
    expect(grade).toBe("lead_only")
  })

  test("returns lead_only for a stale transparent primary source without conflict", () => {
    // given: primary but not recent -> rule 3 fails on !recent, rule 4 no conflict, falls through
    const input = source({ isPrimary: true, accountable: false, recent: false })

    // when
    const grade = gradeSource(input)

    // then
    expect(grade).toBe("lead_only")
  })
})

describe("groupByChain", () => {
  test("collapses correlated reposts into a single independence chain", () => {
    // given: two sources share an independence chain id (a repost), one is independent
    const sources = [
      { independenceChainId: "original", title: "Original report" },
      { independenceChainId: "original", title: "Repost" },
      { independenceChainId: "independent", title: "Independent report" },
    ]

    // when
    const grouped = groupByChain(sources)

    // then: one chain entry per independenceChainId, reposts grouped together
    expect(grouped.size).toBe(2)
    expect(grouped.get("original")?.map((item) => item.title)).toEqual(["Original report", "Repost"])
    expect(grouped.get("independent")?.map((item) => item.title)).toEqual(["Independent report"])
  })

  test("returns an empty map for no sources", () => {
    // given // when
    const grouped = groupByChain([])

    // then
    expect(grouped.size).toBe(0)
  })
})

const signals = (overrides: Partial<IntentSignals> = {}): IntentSignals => ({
  temporalBurst: false,
  phraseRepetition: false,
  singleProductAccount: false,
  ratingTextMismatch: false,
  newHighVolumeAccount: false,
  missingDisclosure: false,
  targetConcentration: false,
  crossAccountReuse: false,
  incentivizedSignal: false,
  sentimentSkewPositive: false,
  sentimentSkewNegative: false,
  ...overrides,
})

describe("gradeIntent", () => {
  test("returns clean when no mechanics fire", () => {
    // given // when // then
    expect(gradeIntent(signals())).toBe("clean")
  })

  test("returns clean when only one mechanic fires even with a direction signal", () => {
    // given: one mechanic + a smear direction -> still below the 2-mechanic threshold
    const input = signals({ temporalBurst: true, targetConcentration: true })

    // when // then
    expect(gradeIntent(input)).toBe("clean")
  })

  test("returns clean for a direction signal with zero mechanics", () => {
    // given: targetConcentration alone is a direction hint, not a mechanic
    const input = signals({ targetConcentration: true })

    // when // then
    expect(gradeIntent(input)).toBe("clean")
  })

  test("returns suspect_smear for two mechanics plus a negative direction", () => {
    // given: burst + repetition mechanics, targetConcentration points negative
    const input = signals({ temporalBurst: true, phraseRepetition: true, targetConcentration: true })

    // when // then
    expect(gradeIntent(input)).toBe("suspect_smear")
  })

  test("returns suspect_shill for two mechanics plus missing disclosure", () => {
    // given: burst + single-product mechanics, missing disclosure points positive
    const input = signals({ temporalBurst: true, singleProductAccount: true, missingDisclosure: true })

    // when // then
    expect(gradeIntent(input)).toBe("suspect_shill")
  })

  test("returns suspect_shill for two mechanics plus a positive sentiment skew", () => {
    // given: new-high-volume + cross-account-reuse mechanics, positive skew
    const input = signals({ newHighVolumeAccount: true, crossAccountReuse: true, sentimentSkewPositive: true })

    // when // then
    expect(gradeIntent(input)).toBe("suspect_shill")
  })

  test("returns unknown for two mechanics with no direction", () => {
    // given: two mechanics but neither a positive nor a negative direction signal
    const input = signals({ temporalBurst: true, phraseRepetition: true })

    // when // then
    expect(gradeIntent(input)).toBe("unknown")
  })

  test("returns unknown for two mechanics with conflicting directions", () => {
    // given: two mechanics plus both a positive and a negative skew -> ambiguous
    const input = signals({ temporalBurst: true, phraseRepetition: true, sentimentSkewPositive: true, sentimentSkewNegative: true })

    // when // then
    expect(gradeIntent(input)).toBe("unknown")
  })
})
