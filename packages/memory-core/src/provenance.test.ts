import { describe, expect, it } from "bun:test";
import type { SourceGrade } from "./enums.ts";
import { dedupeByProvenance } from "./provenance.ts";

type TestItem = { independenceChainId?: string; grade: SourceGrade; id: string };

describe("dedupeByProvenance", () => {
  it("keeps the highest-grade evidence in each independence chain", () => {
    // given
    const items = [
      { independenceChainId: "shared", grade: "low", id: "low" },
      { independenceChainId: "shared", grade: "high", id: "high" },
      { independenceChainId: "other", grade: "medium", id: "other" },
    ] satisfies readonly TestItem[];

    // when
    const deduped = dedupeByProvenance(items);

    // then
    expect(deduped.map((item) => item.id)).toEqual(["high", "other"]);
  });

  it("keeps the first item when grades tie", () => {
    // given
    const items = [
      { independenceChainId: "chain", grade: "medium", id: "first" },
      { independenceChainId: "chain", grade: "medium", id: "second" },
    ] satisfies readonly TestItem[];

    // when
    const deduped = dedupeByProvenance(items);

    // then
    expect(deduped.map((item) => item.id)).toEqual(["first"]);
  });

  it("keeps every item that has no independence chain id", () => {
    // given
    const items = [
      { grade: "high", id: "a" },
      { grade: "low", id: "b" },
    ] satisfies readonly TestItem[];

    // when
    const deduped = dedupeByProvenance(items);

    // then
    expect(deduped.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("returns an empty array for empty input", () => {
    // given // when // then
    expect(dedupeByProvenance([])).toEqual([]);
  });

  it("treats lead_only as the lowest grade", () => {
    // given
    const items = [
      { independenceChainId: "chain", grade: "lead_only", id: "lead" },
      { independenceChainId: "chain", grade: "low", id: "low" },
    ] satisfies readonly TestItem[];

    // when
    const deduped = dedupeByProvenance(items);

    // then
    expect(deduped.map((item) => item.id)).toEqual(["low"]);
  });
});
