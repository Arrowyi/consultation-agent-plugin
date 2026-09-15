// Hybrid recall: FTS5 MATCH + taxonomy branch + optional embedding cosine.
// Honors planRetrieval caps (limit/expandTop/tokenBudget/includeStatuses) and
// returns memoriesUsedDisclosure (item titles + preference keys that matched).

import { estimateTokens, planRetrieval } from "@consultation-agent/memory-core"
import type {
  Applicability,
  ClaimType,
  EvidenceConfidence,
  RecallCandidate,
  RecallQuery,
  RecallResult,
  RecommendationStability,
  RevisionStatus,
} from "@consultation-agent/memory-core"
import type { SqliteDatabase } from "./driver.ts"
import { blobToFloat32Array, cosineSimilarity, type EmbeddingProvider } from "./embedding.ts"

type Row = Record<string, unknown>

export async function runRecall(
  db: SqliteDatabase,
  query: RecallQuery,
  embedding: EmbeddingProvider | null,
): Promise<RecallResult> {
  const tierPlan = planRetrieval(query.tier)
  const limit = query.limit !== undefined ? Math.min(query.limit, tierPlan.limit) : tierPlan.limit
  const expandTop = query.expandTop !== undefined ? Math.min(query.expandTop, tierPlan.expandTop) : tierPlan.expandTop
  const tokenBudget = query.tokenBudget ?? tierPlan.tokenBudget
  const includeStatuses = query.includeStatuses ?? tierPlan.includeStatuses
  const statusSet = new Set<RevisionStatus>(includeStatuses)

  const rows = loadCandidates(db, query, statusSet)
  const scored = await scoreCandidates(db, rows, query, embedding)
  scored.sort((a, b) => b.score - a.score)
  const limited = scored.slice(0, limit)

  const candidates: RecallCandidate[] = limited.map((entry, index) => {
    const row = entry.row
    const level2 = index < expandTop ? buildLevel2(db, String(row.id), statusSet) : undefined
    return {
      itemId: String(row.id),
      title: String(row.title),
      oneLineSummary: String(row.one_line_summary),
      status: String(row.status) as RevisionStatus,
      updatedAt: String(row.updated_at),
      score: entry.score,
      applicability: parseApplicability(row.applicability),
      taxonomyNodeIds: loadTaxonomyForItem(db, String(row.id)),
      level2,
    }
  })

  let usedTokens = 0
  const bounded: RecallCandidate[] = []
  for (const candidate of candidates) {
    const tokens = estimateTokens(`${candidate.title} ${candidate.oneLineSummary}`)
    if (usedTokens + tokens > tokenBudget && bounded.length > 0) break
    usedTokens += tokens
    bounded.push(candidate)
  }

  const disclosure = [
    ...bounded.map((candidate) => candidate.title),
    ...loadActivePreferenceKeys(db, query.namespace),
  ]

  return { candidates: bounded, truncated: bounded.length < candidates.length, usedTokens, memoriesUsedDisclosure: disclosure }
}

type Scored = { readonly row: Row; readonly score: number }

function loadCandidates(db: SqliteDatabase, query: RecallQuery, statusSet: Set<RevisionStatus>): Row[] {
  const statuses = [...statusSet]
  const placeholders = statuses.map(() => "?").join(",")
  if (query.text !== undefined && query.text.length > 0) {
    const fts = sanitizeFts(query.text)
    const rows = db
      .prepare(`SELECT i.* FROM memory_fts f JOIN experience_items i ON i.id = f.item_id WHERE f.namespace = ? AND memory_fts MATCH ? AND i.status IN (${placeholders})`)
      .all(query.namespace, fts, ...statuses) as Row[]
    return rows.filter((row) => matchesApplicability(row, query))
  }
  if (query.taxonomyNodeId !== undefined) {
    const rows = db
      .prepare(`SELECT i.* FROM experience_items i JOIN tag_memberships t ON t.target_id = i.id AND t.target_kind = 'item' WHERE i.namespace = ? AND t.taxonomy_node_id = ? AND i.status IN (${placeholders})`)
      .all(query.namespace, query.taxonomyNodeId, ...statuses) as Row[]
    return rows.filter((row) => matchesApplicability(row, query))
  }
  const rows = db
    .prepare(`SELECT * FROM experience_items WHERE namespace = ? AND status IN (${placeholders})`)
    .all(query.namespace, ...statuses) as Row[]
  return rows.filter((row) => matchesApplicability(row, query))
}

async function scoreCandidates(db: SqliteDatabase, rows: Row[], query: RecallQuery, embedding: EmbeddingProvider | null): Promise<Scored[]> {
  if (embedding === null || query.text === undefined || query.text.length === 0) {
    return rows.map((row) => ({ row, score: 1 }))
  }
  const queryVector = await embedding.embed([query.text])
  const first = queryVector[0]
  if (first === undefined) return rows.map((row) => ({ row, score: 1 }))
  const queryFloats = new Float32Array(first)
  return rows.map((row) => {
    const embRow = db.prepare("SELECT vector, dimensions FROM derived_embeddings WHERE item_id = ? AND model = ?").get(String(row.id), embedding.id) as Row | null
    let cosine = 0
    if (embRow !== null) {
      const blob = embRow.vector as Uint8Array
      const dims = Number(embRow.dimensions)
      cosine = cosineSimilarity(queryFloats, blobToFloat32Array(blob, dims))
    }
    return { row, score: 1 + cosine }
  })
}

function buildLevel2(db: SqliteDatabase, itemId: string, statusSet: Set<RevisionStatus>): RecallCandidate["level2"] {
  const statuses = [...statusSet]
  const placeholders = statuses.map(() => "?").join(",")
  const claimRows = db.prepare(`SELECT id, text, claim_type, status FROM claims WHERE item_id = ? AND status IN (${placeholders})`).all(itemId, ...statuses) as Row[]
  const decisionRow = db.prepare("SELECT id, conclusion, confidence, stability, pending_outcome FROM decisions WHERE item_id = ? AND status = 'active' LIMIT 1").get(itemId) as Row | null
  return {
    claims: claimRows.map((row) => ({
      id: String(row.id),
      text: String(row.text),
      claimType: String(row.claim_type) as ClaimType,
      status: String(row.status) as RevisionStatus,
    })),
    currentDecision: decisionRow === null ? undefined : {
      id: String(decisionRow.id),
      conclusion: String(decisionRow.conclusion),
      confidence: String(decisionRow.confidence) as EvidenceConfidence,
      stability: String(decisionRow.stability) as RecommendationStability,
      pendingOutcome: Number(decisionRow.pending_outcome) !== 0,
    },
  }
}

function loadTaxonomyForItem(db: SqliteDatabase, itemId: string): string[] {
  const rows = db.prepare("SELECT taxonomy_node_id FROM tag_memberships WHERE target_kind = 'item' AND target_id = ?").all(itemId) as Row[]
  return rows.map((row) => String(row.taxonomy_node_id))
}

function loadActivePreferenceKeys(db: SqliteDatabase, namespace: string): string[] {
  const rows = db.prepare("SELECT key FROM user_preferences WHERE namespace = ? AND status = 'active'").all(namespace) as Row[]
  return rows.map((row) => String(row.key))
}

function parseApplicability(value: unknown): Applicability {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Applicability
    } catch {
      return {}
    }
  }
  return {}
}

function matchesApplicability(row: Row, query: RecallQuery): boolean {
  const applicability = parseApplicability(row.applicability)
  if (query.region !== undefined && applicability.region !== undefined && applicability.region !== query.region) {
    return false
  }
  if (query.timeScope !== undefined && applicability.time !== undefined && applicability.time !== query.timeScope) {
    return false
  }
  return true
}

function sanitizeFts(text: string): string {
  const tokens = text.split(/\s+/).map((token) => token.replace(/[^A-Za-z0-9_]/g, "")).filter((token) => token.length > 0)
  if (tokens.length === 0) return text.replace(/['"]/g, "")
  return tokens.map((token) => `"${token}"`).join(" ")
}
