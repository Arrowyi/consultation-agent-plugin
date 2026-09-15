// Transactional, idempotent commit. One transaction: upsert session by
// (namespace, host_session_id); upsert items by (session, topic_key); revise
// changed conclusions with a Revision; reject unconfirmed sensitive fields and
// secrets. Same previewToken replay returns the existing result with created=false.

import { MemoryError, computeFingerprint, containsSecret } from "@consultation-agent/memory-core"
import type { CommitInput, CommitResult, PreparedItem } from "@consultation-agent/memory-core"
import type { SqliteDatabase } from "./driver.ts"
import { runInTransaction } from "./driver.ts"
import type { EmbeddingProvider } from "./embedding.ts"
import { float32ArrayToBlob } from "./embedding.ts"

type Row = Record<string, unknown>

export async function runCommit(
  db: SqliteDatabase,
  input: CommitInput,
  embedding: EmbeddingProvider | null,
  clock: () => string,
): Promise<CommitResult> {
  validateCommit(input)
  const now = input.now ?? clock()
  const existing = db
    .prepare("SELECT id, preview_token FROM session_experiences WHERE namespace = ? AND host_session_id = ?")
    .get(input.namespace, input.hostSessionId) as Row | null

  if (existing !== null && String(existing.preview_token) === input.previewToken) {
    return { sessionExperienceId: String(existing.id), created: false, itemIds: loadItemIds(db, String(existing.id)), revisionIds: [], warnings: [] }
  }

  const sessionId = existing === null ? crypto.randomUUID() : String(existing.id)
  const itemIds: Record<string, string> = {}
  const revisionIds: string[] = []

  runInTransaction(db, () => {
    db.prepare(
      "INSERT INTO session_experiences (id, namespace, host_session_id, title, status, preview_token, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(namespace, host_session_id) DO UPDATE SET title = excluded.title, preview_token = excluded.preview_token, updated_at = excluded.updated_at",
    ).run(sessionId, input.namespace, input.hostSessionId, input.title, input.previewToken, now, now)

    for (const prepared of input.items) {
      itemIds[prepared.topicKey] = upsertItem(db, sessionId, input.namespace, prepared, now, revisionIds)
    }
    upsertPreferences(db, input, now)
  })

  if (embedding !== null) {
    await storeEmbeddings(db, embedding, sessionId, itemIds, input.items, now)
  }

  return { sessionExperienceId: sessionId, created: existing === null, itemIds, revisionIds, warnings: [] }
}

function upsertItem(
  db: SqliteDatabase,
  sessionId: string,
  namespace: string,
  prepared: PreparedItem,
  now: string,
  revisionIds: string[],
): string {
  const row = db.prepare("SELECT id FROM experience_items WHERE session_experience_id = ? AND topic_key = ?").get(sessionId, prepared.topicKey) as Row | null
  const id = row === null ? crypto.randomUUID() : String(row.id)
  db.prepare(
    "INSERT INTO experience_items (id, session_experience_id, namespace, topic_key, title, one_line_summary, applicability, status, sensitive_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?) ON CONFLICT(session_experience_id, topic_key) DO UPDATE SET title = excluded.title, one_line_summary = excluded.one_line_summary, applicability = excluded.applicability, sensitive_fields = excluded.sensitive_fields, updated_at = excluded.updated_at",
  ).run(id, sessionId, namespace, prepared.topicKey, prepared.title, prepared.oneLineSummary, JSON.stringify(prepared.applicability ?? {}), JSON.stringify(prepared.sensitiveFields ?? []), now, now)

  db.prepare("DELETE FROM claims WHERE item_id = ?").run(id)
  const claimTextToId = new Map<string, string>()
  for (const claim of prepared.claims ?? []) {
    const claimId = crypto.randomUUID()
    claimTextToId.set(claim.text, claimId)
    db.prepare("INSERT INTO claims (id, item_id, namespace, claim_type, text, applicability, status, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)").run(claimId, id, namespace, claim.claimType, claim.text, JSON.stringify(claim.applicability ?? {}), claim.confidence ?? "medium", now)
  }
  for (const evidence of prepared.evidence ?? []) {
    const fingerprint = computeFingerprint(evidence.source, evidence.excerpt)
    db.prepare("INSERT OR IGNORE INTO evidence (id, item_id, namespace, source_json, excerpt, fingerprint, grade, independence_chain_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), id, namespace, JSON.stringify(evidence.source), evidence.excerpt ?? null, fingerprint, evidence.grade, evidence.independenceChainId, now)
    const evidenceRow = db.prepare("SELECT id FROM evidence WHERE item_id = ? AND fingerprint = ?").get(id, fingerprint) as Row | null
    const claimId = claimTextToId.get(evidence.claimText)
    if (evidenceRow !== null && claimId !== undefined) {
      db.prepare("INSERT OR IGNORE INTO evidence_links (id, claim_id, evidence_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(crypto.randomUUID(), claimId, String(evidenceRow.id), evidence.relation, evidence.note ?? null, now)
    }
  }
  for (const taxonomyNodeId of prepared.taxonomyNodeIds ?? []) {
    db.prepare("INSERT OR IGNORE INTO taxonomy_nodes (id, name, version, status) VALUES (?, ?, 1, 'active')").run(taxonomyNodeId, taxonomyNodeId)
    db.prepare("INSERT OR IGNORE INTO tag_memberships (id, target_kind, target_id, taxonomy_node_id) VALUES (?, 'item', ?, ?)").run(crypto.randomUUID(), id, taxonomyNodeId)
  }
  if (prepared.decision !== undefined) {
    handleDecision(db, id, namespace, prepared.decision, now, revisionIds)
  }
  return id
}

function handleDecision(
  db: SqliteDatabase,
  itemId: string,
  namespace: string,
  decision: NonNullable<PreparedItem["decision"]>,
  now: string,
  revisionIds: string[],
): void {
  const old = db.prepare("SELECT id, conclusion FROM decisions WHERE item_id = ? AND status = 'active' LIMIT 1").get(itemId) as Row | null
  if (old !== null && String(old.conclusion) !== decision.conclusion) {
    if (decision.reason === undefined || decision.reason.length === 0) {
      throw new MemoryError("VALIDATION_FAILED", "reason required to revise a changed conclusion")
    }
    const oldId = String(old.id)
    const newId = crypto.randomUUID()
    db.prepare("UPDATE decisions SET status = 'superseded' WHERE id = ?").run(oldId)
    insertDecision(db, newId, itemId, namespace, decision, now)
    const revisionId = crypto.randomUUID()
    db.prepare("INSERT INTO revisions (id, item_id, supersedes_decision_id, new_decision_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(revisionId, itemId, oldId, newId, decision.reason, now)
    revisionIds.push(revisionId)
  } else if (old === null) {
    insertDecision(db, crypto.randomUUID(), itemId, namespace, decision, now)
  }
}

function insertDecision(db: SqliteDatabase, id: string, itemId: string, namespace: string, decision: NonNullable<PreparedItem["decision"]>, now: string): void {
  db.prepare("INSERT INTO decisions (id, item_id, namespace, conclusion, assumptions, preferences_used, confidence, stability, change_conditions, pending_outcome, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)").run(id, itemId, namespace, decision.conclusion, JSON.stringify(decision.assumptions ?? []), JSON.stringify(decision.preferencesUsed ?? []), decision.confidence, decision.stability, JSON.stringify(decision.changeConditions ?? []), decision.pendingOutcome ? 1 : 0, now)
}

function upsertPreferences(db: SqliteDatabase, input: CommitInput, now: string): void {
  for (const pref of input.preferences ?? []) {
    db.prepare("INSERT INTO user_preferences (id, namespace, key, value, sensitive, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, sensitive = excluded.sensitive, updated_at = excluded.updated_at").run(crypto.randomUUID(), input.namespace, pref.key, pref.value, pref.sensitive ? 1 : 0, now, now)
  }
}

async function storeEmbeddings(db: SqliteDatabase, embedding: EmbeddingProvider, sessionId: string, itemIds: Record<string, string>, items: readonly PreparedItem[], now: string): Promise<void> {
  const texts = items.map((item) => `${item.title} ${item.oneLineSummary} ${(item.claims ?? []).map((c) => c.text).join(" ")}`)
  const vectors = await embedding.embed(texts)
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item === undefined) continue
    const id = itemIds[item.topicKey]
    if (id === undefined) continue
    const vector = vectors[i]
    if (vector === undefined) continue
    db.prepare("INSERT OR REPLACE INTO derived_embeddings (item_id, model, dimensions, vector, created_at) VALUES (?, ?, ?, ?, ?)").run(id, embedding.id, embedding.dimensions, float32ArrayToBlob(vector), now)
  }
}

function loadItemIds(db: SqliteDatabase, sessionId: string): Record<string, string> {
  const rows = db.prepare("SELECT topic_key, id FROM experience_items WHERE session_experience_id = ?").all(sessionId) as Row[]
  const ids: Record<string, string> = {}
  for (const row of rows) {
    ids[String(row.topic_key)] = String(row.id)
  }
  return ids
}

function validateCommit(input: CommitInput): void {
  const unconfirmed = input.items.flatMap((item) => item.sensitiveFields ?? []).filter((field) => !field.confirmed)
  if (unconfirmed.length > 0) {
    throw new MemoryError("SENSITIVE_UNCONFIRMED", `unconfirmed sensitive fields: ${unconfirmed.map((f) => f.field).join(", ")}`)
  }
  if (allText(input).some(containsSecret)) {
    throw new MemoryError("SECRET_DETECTED", "secret-like text rejected")
  }
}

export function allText(input: { readonly title: string; readonly items: readonly PreparedItem[]; readonly preferences?: readonly { readonly value: string }[] }): readonly string[] {
  return [
    input.title,
    ...input.items.flatMap((item) => [
      item.title,
      item.oneLineSummary,
      ...(item.claims ?? []).map((claim) => claim.text),
      ...(item.evidence ?? []).flatMap((evidence) => [evidence.source.title, evidence.excerpt ?? ""]),
      item.decision?.conclusion ?? "",
    ]),
    ...(input.preferences ?? []).map((preference) => preference.value),
  ]
}
