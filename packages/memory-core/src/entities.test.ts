import { describe, expect, it } from "bun:test";
import {
  ApplicabilitySchema,
  ClaimSchema,
  DecisionSchema,
  DerivedSummarySchema,
  EvidenceLinkSchema,
  EvidenceSchema,
  ExperienceItemSchema,
  RevisionSchema,
  SessionExperienceSchema,
  SourceMetaSchema,
  TagMembershipSchema,
  TaxonomyNodeSchema,
  UserPreferenceSchema,
} from "./entities.ts";

const uuid = "00000000-0000-4000-8000-000000000000";
const iso = "2026-08-16T00:00:00Z";

describe("ApplicabilitySchema", () => {
  it("accepts an empty object", () => {
    // given // when
    const parsed = ApplicabilitySchema.parse({});
    // then
    expect(parsed).toEqual({});
  });

  it("accepts all three fields", () => {
    // given
    const input = { time: "2026", region: "CN", conditions: "humid climate" };
    // when // then
    expect(ApplicabilitySchema.parse(input)).toEqual(input);
  });
});

describe("SourceMetaSchema", () => {
  it("rejects when neither url nor stableId is present", () => {
    // given
    const input = { title: "T", accessedAt: iso };
    // when // then
    expect(() => SourceMetaSchema.parse(input)).toThrow();
  });

  it("accepts when only url is present", () => {
    // given
    const input = { url: "https://example.test/a", title: "T", accessedAt: iso };
    // when // then
    expect(SourceMetaSchema.parse(input).title).toBe("T");
  });

  it("accepts when only stableId is present", () => {
    // given
    const input = { stableId: "doi:10.1000/abc", title: "T", accessedAt: iso };
    // when // then
    expect(SourceMetaSchema.parse(input).stableId).toBe("doi:10.1000/abc");
  });

  it("rejects an invalid url", () => {
    // given
    const input = { url: "not-a-url", title: "T", accessedAt: iso };
    // when // then
    expect(() => SourceMetaSchema.parse(input)).toThrow();
  });

  it("requires a non-empty title", () => {
    // given
    const input = { url: "https://example.test/a", title: "", accessedAt: iso };
    // when // then
    expect(() => SourceMetaSchema.parse(input)).toThrow();
  });

  it("requires accessedAt", () => {
    // given
    const input = { url: "https://example.test/a", title: "T" };
    // when // then
    expect(() => SourceMetaSchema.parse(input)).toThrow();
  });
});

describe("SessionExperienceSchema", () => {
  it("defaults status to active", () => {
    // given
    const input = { id: uuid, namespace: "ns", hostSessionId: "h", title: "T", previewToken: "tok", createdAt: iso, updatedAt: iso };
    // when
    const parsed = SessionExperienceSchema.parse(input);
    // then
    expect(parsed.status).toBe("active");
  });

  it("accepts an explicit status", () => {
    // given
    const input = { id: uuid, namespace: "ns", hostSessionId: "h", title: "T", status: "retired", previewToken: "tok", createdAt: iso, updatedAt: iso };
    // when // then
    expect(SessionExperienceSchema.parse(input).status).toBe("retired");
  });
});

describe("ExperienceItemSchema", () => {
  it("defaults applicability, status, and sensitiveFields", () => {
    // given
    const input = { id: uuid, sessionExperienceId: uuid, topicKey: "tk", title: "T", oneLineSummary: "s", createdAt: iso, updatedAt: iso };
    // when
    const parsed = ExperienceItemSchema.parse(input);
    // then
    expect(parsed.applicability).toEqual({});
    expect(parsed.status).toBe("active");
    expect(parsed.sensitiveFields).toEqual([]);
  });

  it("rejects a one-line summary over 280 chars", () => {
    // given
    const input = { id: uuid, sessionExperienceId: uuid, topicKey: "tk", title: "T", oneLineSummary: "x".repeat(281), createdAt: iso, updatedAt: iso };
    // when // then
    expect(() => ExperienceItemSchema.parse(input)).toThrow();
  });
});

describe("ClaimSchema", () => {
  it("defaults confidence to medium and status to active", () => {
    // given
    const input = { id: uuid, itemId: uuid, claimType: "verifiable_fact", text: "t", createdAt: iso };
    // when
    const parsed = ClaimSchema.parse(input);
    // then
    expect(parsed.confidence).toBe("medium");
    expect(parsed.status).toBe("active");
  });
});

describe("EvidenceSchema", () => {
  it("accepts valid evidence with a source", () => {
    // given
    const input = {
      id: uuid, itemId: uuid,
      source: { url: "https://example.test/a", title: "S", accessedAt: iso },
      fingerprint: "fp", grade: "high", independenceChainId: "chain-1", createdAt: iso,
    };
    // when // then
    expect(EvidenceSchema.parse(input).grade).toBe("high");
  });

  it("rejects an excerpt over 2000 chars", () => {
    // given
    const input = {
      id: uuid, itemId: uuid,
      source: { url: "https://example.test/a", title: "S", accessedAt: iso },
      excerpt: "x".repeat(2001), fingerprint: "fp", grade: "high", independenceChainId: "chain-1", createdAt: iso,
    };
    // when // then
    expect(() => EvidenceSchema.parse(input)).toThrow();
  });
});

describe("EvidenceLinkSchema", () => {
  it("accepts a valid link", () => {
    // given
    const input = { id: uuid, claimId: uuid, evidenceId: uuid, relation: "supports", createdAt: iso };
    // when // then
    expect(EvidenceLinkSchema.parse(input).relation).toBe("supports");
  });
});

describe("DecisionSchema", () => {
  it("defaults assumptions, preferencesUsed, changeConditions, status", () => {
    // given
    const input = { id: uuid, itemId: uuid, conclusion: "c", confidence: "high", stability: "stable", createdAt: iso };
    // when
    const parsed = DecisionSchema.parse(input);
    // then
    expect(parsed.assumptions).toEqual([]);
    expect(parsed.preferencesUsed).toEqual([]);
    expect(parsed.changeConditions).toEqual([]);
    expect(parsed.status).toBe("active");
  });
});

describe("RevisionSchema", () => {
  it("accepts a valid revision", () => {
    // given
    const input = { id: uuid, itemId: uuid, supersedesDecisionId: uuid, newDecisionId: uuid, reason: "r", createdAt: iso };
    // when // then
    expect(RevisionSchema.parse(input).reason).toBe("r");
  });

  it("rejects an empty reason", () => {
    // given
    const input = { id: uuid, itemId: uuid, supersedesDecisionId: uuid, newDecisionId: uuid, reason: "", createdAt: iso };
    // when // then
    expect(() => RevisionSchema.parse(input)).toThrow();
  });
});

describe("UserPreferenceSchema", () => {
  it("defaults sensitive to false and status to active", () => {
    // given
    const input = { id: uuid, namespace: "ns", key: "k", value: "v", createdAt: iso, updatedAt: iso };
    // when
    const parsed = UserPreferenceSchema.parse(input);
    // then
    expect(parsed.sensitive).toBe(false);
    expect(parsed.status).toBe("active");
  });
});

describe("TaxonomyNodeSchema", () => {
  it("accepts a root node with null parentId", () => {
    // given
    const input = { id: uuid, parentId: null, name: "root", version: 1 };
    // when // then
    expect(TaxonomyNodeSchema.parse(input).parentId).toBeNull();
  });

  it("rejects a non-positive version", () => {
    // given
    const input = { id: uuid, parentId: null, name: "root", version: 0 };
    // when // then
    expect(() => TaxonomyNodeSchema.parse(input)).toThrow();
  });
});

describe("TagMembershipSchema", () => {
  it("accepts an item tag", () => {
    // given
    const input = { id: uuid, targetKind: "item", targetId: uuid, taxonomyNodeId: uuid };
    // when // then
    expect(TagMembershipSchema.parse(input).targetKind).toBe("item");
  });

  it("rejects an unknown targetKind", () => {
    // given
    const input = { id: uuid, targetKind: "session", targetId: uuid, taxonomyNodeId: uuid };
    // when // then
    expect(() => TagMembershipSchema.parse(input)).toThrow();
  });
});

describe("DerivedSummarySchema", () => {
  it("accepts a valid summary", () => {
    // given
    const input = { id: uuid, targetKind: "item", targetId: uuid, kind: "one_line", model: "m", promptVersion: "v", schemaVersion: 1, text: "t", createdAt: iso };
    // when // then
    expect(DerivedSummarySchema.parse(input).kind).toBe("one_line");
  });
});
