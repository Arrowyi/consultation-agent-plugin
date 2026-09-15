import { z } from "zod"

import { ConsultationError, ConsultationErrorCode } from "./errors.ts"

export const ResearchBudgetSchema = z.object({
  maxSearches: z.number().int().positive(),
  maxFetches: z.number().int().positive(),
  maxSubagents: z.number().int().positive(),
  maxTokens: z.number().int().positive(),
})

export type ResearchBudget = z.infer<typeof ResearchBudgetSchema>

export const BudgetKind = {
  searches: "searches",
  fetches: "fetches",
  subagents: "subagents",
  tokens: "tokens",
} as const

export type BudgetKind = (typeof BudgetKind)[keyof typeof BudgetKind]

export class BudgetEnforcer {
  readonly #used: Record<BudgetKind, number> = {
    searches: 0,
    fetches: 0,
    subagents: 0,
    tokens: 0,
  }

  constructor(readonly budget: ResearchBudget) {}

  consume(kind: BudgetKind, amount = 1): void {
    if (this.remaining(kind) < amount) {
      throw new ConsultationError(ConsultationErrorCode.BUDGET_EXCEEDED)
    }
    this.#addUsed(kind, amount)
  }

  #addUsed(kind: BudgetKind, amount: number): void {
    switch (kind) {
      case "searches":
        this.#used.searches += amount
        return
      case "fetches":
        this.#used.fetches += amount
        return
      case "subagents":
        this.#used.subagents += amount
        return
      case "tokens":
        this.#used.tokens += amount
        return
    }
  }

  remaining(kind: BudgetKind): number {
    switch (kind) {
      case "searches":
        return this.budget.maxSearches - this.#used.searches
      case "fetches":
        return this.budget.maxFetches - this.#used.fetches
      case "subagents":
        return this.budget.maxSubagents - this.#used.subagents
      case "tokens":
        return this.budget.maxTokens - this.#used.tokens
    }
  }
}
