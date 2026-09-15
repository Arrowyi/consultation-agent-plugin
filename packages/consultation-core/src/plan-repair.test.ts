import { describe, expect, test } from "bun:test"

import { BACKTRACK_DEPTH_CAP, backtrackFrontier, needsBacktrack } from "./plan-repair.ts"

describe("needsBacktrack", () => {
  test("flags an unverifiable step regardless of confidence", () => {
    // given // when // then
    expect(needsBacktrack({ support: "unverifiable" })).toBe(true)
    expect(needsBacktrack({ support: "unverifiable", confidence: "high" })).toBe(true)
  })

  test("flags an inferred step only when confidence is low", () => {
    // given // when // then
    expect(needsBacktrack({ support: "inferred", confidence: "low" })).toBe(true)
    expect(needsBacktrack({ support: "inferred", confidence: "medium" })).toBe(false)
    expect(needsBacktrack({ support: "inferred", confidence: "high" })).toBe(false)
    expect(needsBacktrack({ support: "inferred" })).toBe(false)
  })

  test("does not flag verified or refuted steps", () => {
    // given // when // then
    expect(needsBacktrack({ support: "verified" })).toBe(false)
    expect(needsBacktrack({ support: "refuted", confidence: "low" })).toBe(false)
  })
})

describe("backtrackFrontier", () => {
  test("returns the nearest earlier steps first, bounded by the depth cap", () => {
    // given // when // then
    expect(backtrackFrontier(3)).toEqual([2, 1])
  })

  test("never goes below the root step", () => {
    // given // when // then
    expect(backtrackFrontier(1)).toEqual([0])
    expect(backtrackFrontier(0)).toEqual([])
  })

  test("honors a custom depth cap", () => {
    // given // when // then
    expect(backtrackFrontier(5, 3)).toEqual([4, 3, 2])
    expect(backtrackFrontier(5, 1)).toEqual([4])
  })

  test("the default depth cap is BACKTRACK_DEPTH_CAP", () => {
    // given // when // then
    expect(BACKTRACK_DEPTH_CAP).toBe(2)
    expect(backtrackFrontier(10)).toHaveLength(BACKTRACK_DEPTH_CAP)
  })
})
