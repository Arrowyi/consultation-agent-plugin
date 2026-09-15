// Manage actions: retire (status flip only), forget (delete canonical + derived
// + FTS), forget_session, list/upsert/delete preferences, stats.

import { assertTransition, MemoryError } from "@consultation-agent/memory-core"
import type { ExperienceItem, ManageInput, ManageResult, Outcome, RevisionStatus, SessionSummary, UserPreference } from "@consultation-agent/memory-core"
import type { SqliteDatabase } from "./driver.ts"

type Row = Record<string, unknown>

export function runManage(db: SqliteDatabase, input: ManageInput): ManageResult {
  switch (input.action) {
    case "retire":
      return retireItem(db, input)
    case "forget":
      forgetItem(db, input.namespace, input.itemId)
      return { action: "forget", ok: true }
    case "forget_session":
      forgetSession(db, input.namespace, input.hostSessionId)
      return { action: "forget_session", ok: true }
    case "list_preferences":
      return { action: "list_preferences", preferences: listPreferences(db, input.namespace, input.includeRetired ?? false) }
    case "upsert_preference":
      return { action: "upsert_preference", preference: upsertPreference(db, input) }
    case "delete_preference":
      db.prepare("DELETE FROM user_preferences WHERE namespace = ? AND key = ?").run(input.namespace, input.key)
      return { action: "delete_preference", ok: true }
    case "list_sessions":
      return { action: "list_sessions", sessions: listSessions(db, input.namespace, input.limit ?? 20) }
    case "edit_item":
      return { action: "edit_item", ...editItem(db, input) }
    case "record_outcome":
      return { action: "record_outcome", outcome: recordOutcome(db, input) }
    case "stats":
      return { action: "stats", ...collectStats(db, input.namespace) }
  }
}

function retireItem(db: SqliteDatabase, input: { readonly namespace: string; readonly itemId: string }): ManageResult {
  const row = db.prepare("SELECT status FROM experience_items WHERE id = ? AND namespace = ?").get(input.itemId, input.namespace) as Row | null
  if (row === null) throw new MemoryError("NOT_FOUND", `item ${input.itemId} not found in namespace ${input.namespace}`)
  const from = String(row.status) as RevisionStatus
  assertTransition(from, "retired")
  db.prepare("UPDATE experience_items SET status = 'retired' WHERE id = ?").run(input.itemId)
  return { action: "retire", ok: true }
}

function forgetItem(db: SqliteDatabase, namespace: string, itemId: string): void {
  const row = db.prepare("SELECT id FROM experience_items WHERE id = ? AND namespace = ?").get(itemId, namespace) as Row | null
  if (row === null) throw new MemoryError("NOT_FOUND", `item ${itemId} not found in namespace ${namespace}`)
  purgeDerivedForItem(db, itemId)
  db.prepare("DELETE FROM experience_items WHERE id = ?").run(itemId)
}

function forgetSession(db: SqliteDatabase, namespace: string, hostSessionId: string): void {
  const session = db.prepare("SELECT id FROM session_experiences WHERE namespace = ? AND host_session_id = ?").get(namespace, hostSessionId) as Row | null
  if (session === null) throw new MemoryError("NOT_FOUND", `session ${hostSessionId} not found in namespace ${namespace}`)
  const items = db.prepare("SELECT id FROM experience_items WHERE session_experience_id = ?").all(String(session.id)) as Row[]
  for (const item of items) {
    purgeDerivedForItem(db, String(item.id))
  }
  db.prepare("DELETE FROM session_experiences WHERE id = ?").run(String(session.id))
}

function purgeDerivedForItem(db: SqliteDatabase, itemId: string): void {
  db.prepare("DELETE FROM derived_summaries WHERE target_id = ?").run(itemId)
  db.prepare("DELETE FROM derived_embeddings WHERE item_id = ?").run(itemId)
  db.prepare("DELETE FROM tag_memberships WHERE target_kind = 'item' AND target_id = ?").run(itemId)
  db.prepare("DELETE FROM memory_fts WHERE item_id = ?").run(itemId)
}

function listPreferences(db: SqliteDatabase, namespace: string, includeRetired: boolean): UserPreference[] {
  const rows = includeRetired
    ? (db.prepare("SELECT * FROM user_preferences WHERE namespace = ?").all(namespace) as Row[])
    : (db.prepare("SELECT * FROM user_preferences WHERE namespace = ? AND status = 'active'").all(namespace) as Row[])
  return rows.map(rowToPreference)
}

function upsertPreference(db: SqliteDatabase, input: { readonly namespace: string; readonly key: string; readonly value: string; readonly sensitive: boolean; readonly confirmed: boolean }): UserPreference {
  if (input.sensitive && !input.confirmed) {
    throw new MemoryError("SENSITIVE_UNCONFIRMED", `sensitive preference ${input.key} requires confirmation`)
  }
  const now = new Date().toISOString()
  const existing = db.prepare("SELECT id FROM user_preferences WHERE namespace = ? AND key = ?").get(input.namespace, input.key) as Row | null
  const id = existing === null ? crypto.randomUUID() : String(existing.id)
  db.prepare("INSERT INTO user_preferences (id, namespace, key, value, sensitive, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, sensitive = excluded.sensitive, updated_at = excluded.updated_at").run(id, input.namespace, input.key, input.value, input.sensitive ? 1 : 0, now, now)
  const row = db.prepare("SELECT * FROM user_preferences WHERE id = ?").get(id) as Row
  return rowToPreference(row)
}

function rowToPreference(row: Row): UserPreference {
  return {
    id: String(row.id),
    namespace: String(row.namespace),
    key: String(row.key),
    value: String(row.value),
    sensitive: Number(row.sensitive) !== 0,
    status: String(row.status) as RevisionStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function collectStats(db: SqliteDatabase, namespace: string): { sessions: number; items: number; claims: number; evidence: number; preferences: number; derivedSummaries: number; embeddings: number } {
  const count = (sql: string): number => {
    const row = db.prepare(sql).get(namespace) as { c: number }
    return Number(row.c)
  }
  return {
    sessions: count("SELECT count(*) AS c FROM session_experiences WHERE namespace = ?"),
    items: count("SELECT count(*) AS c FROM experience_items WHERE namespace = ?"),
    claims: count("SELECT count(*) AS c FROM claims WHERE namespace = ?"),
    evidence: count("SELECT count(*) AS c FROM evidence WHERE namespace = ?"),
    preferences: count("SELECT count(*) AS c FROM user_preferences WHERE namespace = ?"),
    derivedSummaries: count("SELECT count(*) AS c FROM derived_summaries WHERE target_id IN (SELECT id FROM experience_items WHERE namespace = ?)"),
    embeddings: count("SELECT count(*) AS c FROM derived_embeddings WHERE item_id IN (SELECT id FROM experience_items WHERE namespace = ?)"),
  }
}

function listSessions(db: SqliteDatabase, namespace: string, limit: number): SessionSummary[] {
  const rows = db.prepare("SELECT id, host_session_id, title, updated_at FROM session_experiences WHERE namespace = ? ORDER BY updated_at DESC LIMIT ?").all(namespace, limit) as Row[]
  return rows.map((row) => ({
    sessionExperienceId: String(row.id),
    hostSessionId: String(row.host_session_id),
    title: String(row.title),
    itemCount: countItemsForSession(db, String(row.id)),
    updatedAt: String(row.updated_at),
  }))
}

function countItemsForSession(db: SqliteDatabase, sessionId: string): number {
  const row = db.prepare("SELECT count(*) AS c FROM experience_items WHERE session_experience_id = ?").get(sessionId) as { c: number }
  return Number(row.c)
}

function editItem(db: SqliteDatabase, input: { readonly namespace: string; readonly itemId: string; readonly title?: string; readonly oneLineSummary?: string; readonly conclusion?: string; readonly reason?: string }): { item: ExperienceItem; revisedConclusion: boolean } {
  const row = db.prepare("SELECT * FROM experience_items WHERE id = ? AND namespace = ?").get(input.itemId, input.namespace) as Row | null
  if (row === null) throw new MemoryError("NOT_FOUND", `item ${input.itemId} not found in namespace ${input.namespace}`)
  const now = new Date().toISOString()
  if (input.title !== undefined || input.oneLineSummary !== undefined) {
    const title = input.title ?? String(row.title)
    const oneLineSummary = input.oneLineSummary ?? String(row.one_line_summary)
    db.prepare("UPDATE experience_items SET title = ?, one_line_summary = ?, updated_at = ? WHERE id = ?").run(title, oneLineSummary, now, input.itemId)
  }
  const revisedConclusion = input.conclusion === undefined
    ? false
    : reviseDecisionConclusion(db, input.itemId, input.namespace, input.conclusion, input.reason, now)
  const updated = db.prepare("SELECT * FROM experience_items WHERE id = ?").get(input.itemId) as Row
  return { item: rowToItem(updated), revisedConclusion }
}

function reviseDecisionConclusion(db: SqliteDatabase, itemId: string, namespace: string, conclusion: string, reason: string | undefined, now: string): boolean {
  const old = db.prepare("SELECT id, conclusion, assumptions, preferences_used, confidence, stability, change_conditions, pending_outcome FROM decisions WHERE item_id = ? AND status = 'active' LIMIT 1").get(itemId) as Row | null
  if (old === null || String(old.conclusion) === conclusion) return false
  if (reason === undefined || reason.length === 0) {
    throw new MemoryError("VALIDATION_FAILED", "reason required to revise a changed conclusion")
  }
  const oldId = String(old.id)
  const newId = crypto.randomUUID()
  db.prepare("UPDATE decisions SET status = 'superseded' WHERE id = ?").run(oldId)
  db.prepare("INSERT INTO decisions (id, item_id, namespace, conclusion, assumptions, preferences_used, confidence, stability, change_conditions, pending_outcome, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)").run(newId, itemId, namespace, conclusion, String(old.assumptions), String(old.preferences_used), String(old.confidence), String(old.stability), String(old.change_conditions), Number(old.pending_outcome), now)
  const revisionId = crypto.randomUUID()
  db.prepare("INSERT INTO revisions (id, item_id, supersedes_decision_id, new_decision_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(revisionId, itemId, oldId, newId, reason, now)
  return true
}

function recordOutcome(db: SqliteDatabase, input: { readonly namespace: string; readonly itemId: string; readonly decisionId?: string; readonly outcomeType: Outcome["outcomeType"]; readonly note?: string }): Outcome {
  const item = db.prepare("SELECT id FROM experience_items WHERE id = ? AND namespace = ?").get(input.itemId, input.namespace) as Row | null
  if (item === null) throw new MemoryError("NOT_FOUND", `item ${input.itemId} not found in namespace ${input.namespace}`)
  const now = new Date().toISOString()
  const id = crypto.randomUUID()
  db.prepare("INSERT INTO outcomes (id, item_id, namespace, decision_id, outcome_type, note, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, input.itemId, input.namespace, input.decisionId ?? null, input.outcomeType, input.note ?? null, now, now)
  db.prepare("UPDATE decisions SET pending_outcome = 0 WHERE item_id = ? AND status = 'active'").run(input.itemId)
  const row = db.prepare("SELECT * FROM outcomes WHERE id = ?").get(id) as Row
  return rowToOutcome(row)
}

function rowToItem(row: Row): ExperienceItem {
  return { id: String(row.id), sessionExperienceId: String(row.session_experience_id), topicKey: String(row.topic_key), title: String(row.title), oneLineSummary: String(row.one_line_summary), applicability: JSON.parse(String(row.applicability)), status: String(row.status) as ExperienceItem["status"], sensitiveFields: JSON.parse(String(row.sensitive_fields)), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function rowToOutcome(row: Row): Outcome {
  return { id: String(row.id), itemId: String(row.item_id), decisionId: row.decision_id === null ? undefined : String(row.decision_id), outcomeType: String(row.outcome_type) as Outcome["outcomeType"], note: row.note === null ? undefined : String(row.note), confirmedAt: String(row.confirmed_at), createdAt: String(row.created_at) }
}
