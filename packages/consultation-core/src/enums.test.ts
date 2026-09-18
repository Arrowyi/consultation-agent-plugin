import { describe, expect, it } from "bun:test";
import {
  ClaimKindSchema,
  ConfidenceSchema,
  ConsultationModeSchema,
  RiskLevelSchema,
  SourceGradeSchema,
  StabilitySchema,
  TierSchema,
} from "./enums";

describe("enums", () => {
  it("ClaimKindSchema has the five epistemic kinds", () => {
    // given // when // then
    expect(ClaimKindSchema.options).toEqual([
      "fact",
      "causal",
      "experiential",
      "prediction",
      "preference",
    ]);
  });

  it("RiskLevelSchema has low/medium/high", () => {
    // given // when // then
    expect(RiskLevelSchema.options).toEqual(["low", "medium", "high"]);
  });

  it("TierSchema has fast/standard/deep", () => {
    // given // when // then
    expect(TierSchema.options).toEqual(["fast", "standard", "deep"]);
  });

  it("SourceGradeSchema has high/medium/low/lead_only", () => {
    // given // when // then
    expect(SourceGradeSchema.options).toEqual(["high", "medium", "low", "lead_only"]);
  });

  it("ConfidenceSchema has high/medium/low", () => {
    // given // when // then
    expect(ConfidenceSchema.options).toEqual(["high", "medium", "low"]);
  });

  it("StabilitySchema has stable/conditional/provisional", () => {
    // given // when // then
    expect(StabilitySchema.options).toEqual(["stable", "conditional", "provisional"]);
  });

  it("ConsultationModeSchema has the six public modes", () => {
    // given // when // then
    expect(ConsultationModeSchema.options).toEqual([
      "select",
      "verify",
      "plan",
      "research",
      "guide",
      "author",
    ]);
  });
});
