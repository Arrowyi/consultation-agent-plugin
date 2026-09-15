import type { SourceGrade } from "./enums.ts"

const grades: Readonly<Record<SourceGrade, number>> = { high: 4, medium: 3, low: 2, lead_only: 1 }

type ProvenanceItem = { readonly independenceChainId?: string; readonly grade?: SourceGrade }

export function dedupeByProvenance<T extends ProvenanceItem>(items: readonly T[]): T[] {
  const byChain = new Map<string, T>()
  const unchained: T[] = []
  for (const item of items) {
    if (item.independenceChainId === undefined) {
      unchained.push(item)
      continue
    }
    const existing = byChain.get(item.independenceChainId)
    if (existing === undefined || grade(item) > grade(existing)) byChain.set(item.independenceChainId, item)
  }
  return [...byChain.values(), ...unchained]
}

function grade(item: ProvenanceItem): number {
  return item.grade === undefined ? 0 : grades[item.grade]
}
