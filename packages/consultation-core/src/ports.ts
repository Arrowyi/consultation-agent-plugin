import type { Tier } from "./enums.ts"

export type SearchHit = {
  title: string
  url?: string
  snippet: string
  publishedAt?: string
}

export interface SearchPort {
  search(query: string, opts?: { limit?: number }): Promise<SearchHit[]>
}

export interface MemoryPort {
  recall(q: { text?: string; tier: Tier; limit?: number }): Promise<
    { itemId: string; title: string; oneLineSummary: string }[]
  >
}

export interface ClockPort {
  now(): string
}
