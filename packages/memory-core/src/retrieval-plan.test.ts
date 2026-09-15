import { describe, expect, it } from "bun:test";
import { estimateTokens, planRetrieval } from "./retrieval-plan.ts";

describe("planRetrieval", () => {
  it("uses the fast tier defaults exactly", () => {
    // given
    const tier = "fast" as const;

    // when
    const plan = planRetrieval(tier);

    // then
    expect(plan).toEqual({ limit: 3, expandTop: 0, tokenBudget: 300, includeStatuses: ["active"] });
  });

  it("uses the standard tier defaults exactly", () => {
    // given
    const tier = "standard" as const;

    // when
    const plan = planRetrieval(tier);

    // then
    expect(plan).toEqual({ limit: 8, expandTop: 3, tokenBudget: 1200, includeStatuses: ["active"] });
  });

  it("uses the deep tier defaults exactly", () => {
    // given
    const tier = "deep" as const;

    // when
    const plan = planRetrieval(tier);

    // then
    expect(plan).toEqual({ limit: 8, expandTop: 3, tokenBudget: 3000, includeStatuses: ["active", "superseded", "refuted"] });
  });

  it("applies partial overrides on top of tier defaults", () => {
    // given
    const overrides = { limit: 5 };

    // when
    const plan = planRetrieval("standard", overrides);

    // then
    expect(plan.limit).toBe(5);
    expect(plan.expandTop).toBe(3);
    expect(plan.tokenBudget).toBe(1200);
    expect(plan.includeStatuses).toEqual(["active"]);
  });

  it("applies full overrides", () => {
    // given
    const overrides = { limit: 2, expandTop: 1, tokenBudget: 100, includeStatuses: ["retired"] as const };

    // when
    const plan = planRetrieval("standard", overrides);

    // then
    expect(plan).toEqual(overrides);
  });
});

describe("estimateTokens", () => {
  it("rounds text length up in four-character units", () => {
    // given
    const text = "abcde";

    // when
    const tokens = estimateTokens(text);

    // then
    expect(tokens).toBe(2);
  });

  it("returns 0 for the empty string", () => {
    // given // when // then
    expect(estimateTokens("")).toBe(0);
  });

  it("returns 1 for exactly four characters", () => {
    // given // when // then
    expect(estimateTokens("abcd")).toBe(1);
  });
});
