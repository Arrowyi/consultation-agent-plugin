import { describe, expect, it } from "bun:test";
import { MemoryExportSchema, type MemoryExport } from "./export-contract.ts";

const uuid = "00000000-0000-4000-8000-000000000000";
const iso = "2026-08-16T00:00:00Z";

function validExport() {
  return {
    formatVersion: 1,
    exportedAt: iso,
    namespaces: ["ns"],
    sessions: [],
    items: [],
    claims: [],
    evidence: [],
    links: [],
    decisions: [],
    revisions: [],
    outcomes: [],
    preferences: [],
    taxonomy: [],
    tags: [],
  };
}

describe("MemoryExportSchema", () => {
  it("parses a valid empty export", () => {
    // given // when
    const parsed = MemoryExportSchema.parse(validExport());

    // then
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.namespaces).toEqual(["ns"]);
  });

  it("rejects an unsupported format version", () => {
    // given
    const input = { ...validExport(), formatVersion: 2 };

    // when // then
    expect(() => MemoryExportSchema.parse(input)).toThrow();
  });

  it("requires exportedAt", () => {
    // given
    const input = { ...validExport(), exportedAt: undefined };

    // when // then
    expect(() => MemoryExportSchema.parse(input)).toThrow();
  });

  it("parses an export with a populated session and item", () => {
    // given
    const input = {
      ...validExport(),
      sessions: [{
        id: uuid, namespace: "ns", hostSessionId: "h", title: "T",
        previewToken: "tok", createdAt: iso, updatedAt: iso,
      }],
      items: [{
        id: uuid, sessionExperienceId: uuid, topicKey: "tk", title: "T",
        oneLineSummary: "s", createdAt: iso, updatedAt: iso,
      }],
    };

    // when
    const parsed = MemoryExportSchema.parse(input);

    // then
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.items).toHaveLength(1);
  });

  it("the MemoryExport type is derivable from the schema", () => {
    // given
    const value: MemoryExport = MemoryExportSchema.parse(validExport());

    // when // then
    expect(value.formatVersion).toBe(1);
  });
});
