// Expand: levels 3 (evidence + revisions + decisions) and 4 (+ excerpts +
// full stored summaries). Loads by item ids within a namespace.

import { estimateTokens } from "@consultation-agent/memory-core"
import type { Decision, Evidence, EvidenceRelation, ExpandInput, ExpandResult, Revision } from "@consultation-agent/memory-core"
import type { SqliteDatabase } from "./driver.ts"

type Row = Record<string, unknown>

export function runExpand(db: SqliteDatabase, input: ExpandInput): ExpandResult {
  const items = input.itemIds.map((itemId) => buildExpandItem(db, input.namespace, itemId, input.level))
  const usedTokens = items.reduce((sum, item) => sum + estimateTokens(JSON.stringify(item)), 0)
  return { items, usedTokens }
}

type ExpandItem = ExpandResult["items"][number]

function buildExpandItem(db: SqliteDatabase, namespace: string, itemId: string, level: 3 | 4): ExpandItem {
  const evidence = loadEvidence(db, namespace, itemId)
  const revisions = loadRevisions(db, itemId)
  const decisions = loadDecisions(db, itemId)
  const excerpts = level >= 4 ? loadExcerpts(db, namespace, itemId) : undefined
  return { itemId, evidence, revisions, decisions, excerpts }
}

function loadEvidence(db: SqliteDatabase, namespace: string, itemId: string): (Evidence & { readonly relation?: EvidenceRelation; readonly claimId?: string })[] {
  const rows = db
    .prepare(
      "SELECT e.*, el.relation AS relation, el.claim_id AS claim_id FROM evidence e LEFT JOIN evidence_links el ON el.evidence_id = e.id WHERE e.item_id = ? AND e.namespace = ?",
    )
    .all(itemId, namespace) as Row[]
  return rows.map((row) => ({
    id: String(row.id),
    itemId: String(row.item_id),
    source: JSON.parse(String(row.source_json)) as Evidence["source"],
    excerpt: row.excerpt === null ? undefined : String(row.excerpt),
    fingerprint: String(row.fingerprint),
    grade: String(row.grade) as Evidence["grade"],
    independenceChainId: String(row.independence_chain_id),
    createdAt: String(row.created_at),
    relation: row.relation === null ? undefined : (String(row.relation) as EvidenceRelation),
    claimId: row.claim_id === null ? undefined : String(row.claim_id),
  }))
}

function loadRevisions(db: SqliteDatabase, itemId: string): Revision[] {
  const rows = db.prepare("SELECT * FROM revisions WHERE item_id = ? ORDER BY created_at").all(itemId) as Row[]
  return rows.map((row) => ({
    id: String(row.id),
    itemId: String(row.item_id),
    supersedesDecisionId: String(row.supersedes_decision_id),
    newDecisionId: String(row.new_decision_id),
    reason: String(row.reason),
    createdAt: String(row.created_at),
  }))
}

function loadDecisions(db: SqliteDatabase, itemId: string): Decision[] {
  const rows = db.prepare("SELECT * FROM decisions WHERE item_id = ? ORDER BY created_at").all(itemId) as Row[]
  return rows.map((row) => ({
    id: String(row.id),
    itemId: String(row.item_id),
    conclusion: String(row.conclusion),
    assumptions: JSON.parse(String(row.assumptions)) as string[],
    preferencesUsed: JSON.parse(String(row.preferences_used)) as string[],
    confidence: String(row.confidence) as Decision["confidence"],
    stability: String(row.stability) as Decision["stability"],
    changeConditions: JSON.parse(String(row.change_conditions)) as string[],
    pendingOutcome: Number(row.pending_outcome) !== 0,
    status: String(row.status) as Decision["status"],
    createdAt: String(row.created_at),
  }))
}

function loadExcerpts(db: SqliteDatabase, namespace: string, itemId: string): { readonly evidenceId: string; readonly excerpt: string }[] {
  const rows = db.prepare("SELECT id, excerpt FROM evidence WHERE item_id = ? AND namespace = ? AND excerpt IS NOT NULL").all(itemId, namespace) as Row[]
  return rows.map((row) => ({ evidenceId: String(row.id), excerpt: String(row.excerpt) }))
}
