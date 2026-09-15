import { describe, expect, test } from "bun:test"

import { BudgetEnforcer } from "./budget.ts"
import { ConsultationError } from "./errors.ts"

const fullBudget = {
  maxSearches: 2,
  maxFetches: 3,
  maxSubagents: 1,
  maxTokens: 100,
}

describe("BudgetEnforcer", () => {
  test("tracks consumption and remaining budget by resource kind", () => {
    // given
    const budget = new BudgetEnforcer(fullBudget)

    // when
    budget.consume("searches")
    budget.consume("tokens", 40)

    // then
    expect(budget.remaining("searches")).toBe(1)
    expect(budget.remaining("tokens")).toBe(60)
    expect(budget.remaining("fetches")).toBe(3)
    expect(budget.remaining("subagents")).toBe(1)
  })

  test("throws BUDGET_EXCEEDED when consuming past zero remaining", () => {
    // given: a single-unit budget, already exhausted
    const budget = new BudgetEnforcer({
      maxSearches: 1,
      maxFetches: 1,
      maxSubagents: 1,
      maxTokens: 1,
    })
    budget.consume("searches")

    // when
    const consumePastBudget = (): void => budget.consume("searches")

    // then
    expect(consumePastBudget).toThrow(ConsultationError)
    expect(consumePastBudget).toThrow("BUDGET_EXCEEDED")
  })

  test("throws BUDGET_EXCEEDED when a token consumption would exceed remaining", () => {
    // given
    const budget = new BudgetEnforcer({
      maxSearches: 1,
      maxFetches: 1,
      maxSubagents: 1,
      maxTokens: 50,
    })

    // when
    const overConsume = (): void => budget.consume("tokens", 51)

    // then
    expect(overConsume).toThrow(ConsultationError)
    expect(overConsume).toThrow("BUDGET_EXCEEDED")
  })

  test("does not throw when consuming exactly the remaining budget", () => {
    // given
    const budget = new BudgetEnforcer({
      maxSearches: 1,
      maxFetches: 1,
      maxSubagents: 1,
      maxTokens: 50,
    })

    // when
    const consumeExactly = (): void => budget.consume("tokens", 50)

    // then: consuming exactly the remaining budget leaves zero and does not throw
    expect(consumeExactly).not.toThrow()
    expect(budget.remaining("tokens")).toBe(0)
  })
})
