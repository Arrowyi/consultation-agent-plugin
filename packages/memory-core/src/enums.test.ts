import { describe, expect, it } from "bun:test";
import {
  RevisionStatusSchema,
  ClaimTypeSchema,
  SourceGradeSchema,
  ConsultationTierSchema,
  EvidenceConfidenceSchema,
  RecommendationStabilitySchema,
  EvidenceRelationSchema,
} from "./enums.ts";

describe("RevisionStatusSchema", () => {
  it("accepts all five statuses", () => {
    // given // when // then
    for (const v of ["active", "superseded", "refuted", "retired", "forgotten"] as const) {
      expect(RevisionStatusSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown status", () => {
    // given // when // then
    expect(() => RevisionStatusSchema.parse("archived")).toThrow();
  });
});

describe("ClaimTypeSchema", () => {
  it("accepts all five claim types", () => {
    // given // when // then
    for (const v of [
      "verifiable_fact",
      "causal_efficacy",
      "experiential_judgment",
      "future_prediction",
      "value_preference",
    ] as const) {
      expect(ClaimTypeSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown claim type", () => {
    // given // when // then
    expect(() => ClaimTypeSchema.parse("opinion")).toThrow();
  });
});

describe("SourceGradeSchema", () => {
  it("accepts all four grades", () => {
    // given // when // then
    for (const v of ["high", "medium", "low", "lead_only"] as const) {
      expect(SourceGradeSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown grade", () => {
    // given // when // then
    expect(() => SourceGradeSchema.parse("ultra")).toThrow();
  });
});

describe("ConsultationTierSchema", () => {
  it("accepts all three tiers", () => {
    // given // when // then
    for (const v of ["fast", "standard", "deep"] as const) {
      expect(ConsultationTierSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown tier", () => {
    // given // when // then
    expect(() => ConsultationTierSchema.parse("ultra")).toThrow();
  });
});

describe("EvidenceConfidenceSchema", () => {
  it("accepts all three confidence levels", () => {
    // given // when // then
    for (const v of ["high", "medium", "low"] as const) {
      expect(EvidenceConfidenceSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown confidence", () => {
    // given // when // then
    expect(() => EvidenceConfidenceSchema.parse("certain")).toThrow();
  });
});

describe("RecommendationStabilitySchema", () => {
  it("accepts all three stability levels", () => {
    // given // when // then
    for (const v of ["stable", "conditional", "provisional"] as const) {
      expect(RecommendationStabilitySchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown stability", () => {
    // given // when // then
    expect(() => RecommendationStabilitySchema.parse("permanent")).toThrow();
  });
});

describe("EvidenceRelationSchema", () => {
  it("accepts all four relations", () => {
    // given // when // then
    for (const v of ["supports", "refutes", "qualifies", "supersedes"] as const) {
      expect(EvidenceRelationSchema.parse(v)).toBe(v);
    }
  });

  it("rejects an unknown relation", () => {
    // given // when // then
    expect(() => EvidenceRelationSchema.parse("contradicts")).toThrow();
  });
});
