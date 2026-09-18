import { describe, expect, test } from "bun:test"
import {
  AuthorClaimSchema,
  AuthorDeliverySchema,
  AuthorProfileSchema,
  AuthorSectionSchema,
  AuthorVerificationSchema,
} from "./author-contracts.ts"

describe("author contracts", () => {
  test("accepts every author control value", () => {
    expect(AuthorProfileSchema.options).toEqual(["tutorial", "architecture", "explanation"])
    expect(AuthorDeliverySchema.options).toEqual(["inline", "single_file", "multi_file"])
    expect(AuthorVerificationSchema.options).toEqual(["light", "targeted", "strict"])
  })

  test("accepts a complete section manifest entry", () => {
    const section = AuthorSectionSchema.parse({
      id: "structured-concurrency",
      title: "Structured concurrency",
      purpose: "Explain ownership and cancellation propagation.",
      file: "03-structured-concurrency.md",
      learningObjectives: ["Trace cancellation through a coroutine tree."],
      prerequisites: ["Suspension and continuations"],
      verificationTargets: ["Cancellation reaches child jobs."],
    })
    expect(section.file).toBe("03-structured-concurrency.md")
  })

  test("rejects an inferred claim without a basis", () => {
    expect(() =>
      AuthorClaimSchema.parse({
        claim: "Cancellation always reaches detached work.",
        sectionIds: ["structured-concurrency"],
        status: "inferred",
        verificationMethod: "Source inspection",
      }),
    ).toThrow()
  })

  test("accepts an inferred claim with a basis", () => {
    const claim = AuthorClaimSchema.parse({
      claim: "Cancellation propagates through the parent Job hierarchy.",
      sectionIds: ["structured-concurrency"],
      status: "inferred",
      basis: "Inferred from Job parent-child linkage in the inspected source.",
      verificationMethod: "Source inspection",
    })
    expect(claim.status).toBe("inferred")
  })
})
