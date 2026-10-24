// Export dumps every canonical table into a MemoryExport; import validates and
// idempotently uperts every row by primary key. Both are namespace-agnostic.

import { MemoryExportSchema } from "@janus-agent/memory-core"
import type {
  Claim,
  Decision,
  Evidence,
  EvidenceLink,
  ExperienceItem,
  MemoryExport,
  Outcome,
  Revision,
  SessionExperience,
  TagMembership,
  TaxonomyNode,
  UserPreference,
} from "@janus-agent/memory-core"
import type { SqliteDatabase } from "./driver.ts"
import { runInTransaction } from "./driver.ts"

type Row = Record<string, unknown>

export function exportMemory(db: SqliteDatabase): MemoryExport {
  const sessions = mapRows(db, "SELECT * FROM session_experiences", rowToSession)
  const items = mapRows(db, "SELECT * FROM experience_items", rowToItem)
  const claims = mapRows(db, "SELECT * FROM claims", rowToClaim)
  const evidence = mapRows(db, "SELECT * FROM evidence", rowToEvidence)
  const links = mapRows(db, "SELECT * FROM evidence_links", rowToLink)
  const decisions = mapRows(db, "SELECT * FROM decisions", rowToDecision)
  const revisions = mapRows(db, "SELECT * FROM revisions", rowToRevision)
  const outcomes = mapRows(db, "SELECT * FROM outcomes", rowToOutcome)
  const preferences = mapRows(db, "SELECT * FROM user_preferences", rowToPreference)
  const taxonomy = mapRows(db, "SELECT * FROM taxonomy_nodes", rowToTaxonomy)
  const tags = mapRows(db, "SELECT * FROM tag_memberships", rowToTag)
  const namespaces = [...new Set(sessions.map((session) => session.namespace))]
  return {
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    namespaces,
    sessions,
    items,
    claims,
    evidence,
    links,
    decisions,
    revisions,
    outcomes,
    preferences,
    taxonomy,
    tags,
  }
}

export function importMemory(db: SqliteDatabase, raw: unknown): void {
  const data = MemoryExportSchema.parse(raw)
  const itemNamespace = new Map<string, string>()
  for (const session of data.sessions) {
    for (const item of data.items) {
      if (item.sessionExperienceId === session.id) {
        itemNamespace.set(item.id, session.namespace)
      }
    }
  }
  runInTransaction(db, () => {
    for (const session of data.sessions) {
      db.prepare("INSERT OR REPLACE INTO session_experiences (id, namespace, host_session_id, title, status, preview_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(session.id, session.namespace, session.hostSessionId, session.title, session.status, session.previewToken, session.createdAt, session.updatedAt)
    }
    for (const item of data.items) {
      db.prepare("INSERT OR REPLACE INTO experience_items (id, session_experience_id, namespace, topic_key, title, one_line_summary, applicability, status, sensitive_fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(item.id, item.sessionExperienceId, itemNamespace.get(item.id) ?? "", item.topicKey, item.title, item.oneLineSummary, JSON.stringify(item.applicability), item.status, JSON.stringify(item.sensitiveFields), item.createdAt, item.updatedAt)
    }
    for (const claim of data.claims) {
      db.prepare("INSERT OR REPLACE INTO claims (id, item_id, namespace, claim_type, text, applicability, status, confidence, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(claim.id, claim.itemId, itemNamespace.get(claim.itemId) ?? "", claim.claimType, claim.text, JSON.stringify(claim.applicability), claim.status, claim.confidence, claim.createdAt)
    }
    for (const evidence of data.evidence) {
      db.prepare("INSERT OR REPLACE INTO evidence (id, item_id, namespace, source_json, excerpt, fingerprint, grade, independence_chain_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(evidence.id, evidence.itemId, itemNamespace.get(evidence.itemId) ?? "", JSON.stringify(evidence.source), evidence.excerpt ?? null, evidence.fingerprint, evidence.grade, evidence.independenceChainId, evidence.createdAt)
    }
    for (const link of data.links) {
      db.prepare("INSERT OR REPLACE INTO evidence_links (id, claim_id, evidence_id, relation, note, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(link.id, link.claimId, link.evidenceId, link.relation, link.note ?? null, link.createdAt)
    }
    for (const decision of data.decisions) {
      db.prepare("INSERT OR REPLACE INTO decisions (id, item_id, namespace, conclusion, assumptions, preferences_used, confidence, stability, change_conditions, pending_outcome, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(decision.id, decision.itemId, itemNamespace.get(decision.itemId) ?? "", decision.conclusion, JSON.stringify(decision.assumptions), JSON.stringify(decision.preferencesUsed), decision.confidence, decision.stability, JSON.stringify(decision.changeConditions), decision.pendingOutcome ? 1 : 0, decision.status, decision.createdAt)
    }
    for (const outcome of data.outcomes) {
      db.prepare("INSERT OR REPLACE INTO outcomes (id, item_id, namespace, decision_id, outcome_type, note, confirmed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(outcome.id, outcome.itemId, itemNamespace.get(outcome.itemId) ?? "", outcome.decisionId ?? null, outcome.outcomeType, outcome.note ?? null, outcome.confirmedAt, outcome.createdAt)
    }
    for (const revision of data.revisions) {
      db.prepare("INSERT OR REPLACE INTO revisions (id, item_id, supersedes_decision_id, new_decision_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(revision.id, revision.itemId, revision.supersedesDecisionId, revision.newDecisionId, revision.reason, revision.createdAt)
    }
    for (const preference of data.preferences) {
      db.prepare("INSERT OR REPLACE INTO user_preferences (id, namespace, key, value, sensitive, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(preference.id, preference.namespace, preference.key, preference.value, preference.sensitive ? 1 : 0, preference.status, preference.createdAt, preference.updatedAt)
    }
    for (const node of data.taxonomy) {
      db.prepare("INSERT OR REPLACE INTO taxonomy_nodes (id, parent_id, name, version, status) VALUES (?, ?, ?, ?, ?)").run(node.id, node.parentId, node.name, node.version, node.status)
    }
    for (const tag of data.tags) {
      db.prepare("INSERT OR REPLACE INTO tag_memberships (id, target_kind, target_id, taxonomy_node_id) VALUES (?, ?, ?, ?)").run(tag.id, tag.targetKind, tag.targetId, tag.taxonomyNodeId)
    }
  })
}

function mapRows<T>(db: SqliteDatabase, sql: string, map: (row: Row) => T): T[] {
  return (db.prepare(sql).all() as Row[]).map(map)
}

function rowToSession(row: Row): SessionExperience {
  return { id: String(row.id), namespace: String(row.namespace), hostSessionId: String(row.host_session_id), title: String(row.title), status: String(row.status) as SessionExperience["status"], previewToken: String(row.preview_token), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function rowToItem(row: Row): ExperienceItem {
  return { id: String(row.id), sessionExperienceId: String(row.session_experience_id), topicKey: String(row.topic_key), title: String(row.title), oneLineSummary: String(row.one_line_summary), applicability: JSON.parse(String(row.applicability)), status: String(row.status) as ExperienceItem["status"], sensitiveFields: JSON.parse(String(row.sensitive_fields)), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function rowToClaim(row: Row): Claim {
  return { id: String(row.id), itemId: String(row.item_id), claimType: String(row.claim_type) as Claim["claimType"], text: String(row.text), applicability: JSON.parse(String(row.applicability)), status: String(row.status) as Claim["status"], confidence: String(row.confidence) as Claim["confidence"], createdAt: String(row.created_at) }
}

function rowToEvidence(row: Row): Evidence {
  return { id: String(row.id), itemId: String(row.item_id), source: JSON.parse(String(row.source_json)), excerpt: row.excerpt === null ? undefined : String(row.excerpt), fingerprint: String(row.fingerprint), grade: String(row.grade) as Evidence["grade"], independenceChainId: String(row.independence_chain_id), createdAt: String(row.created_at) }
}

function rowToLink(row: Row): EvidenceLink {
  return { id: String(row.id), claimId: String(row.claim_id), evidenceId: String(row.evidence_id), relation: String(row.relation) as EvidenceLink["relation"], note: row.note === null ? undefined : String(row.note), createdAt: String(row.created_at) }
}

function rowToDecision(row: Row): Decision {
  return { id: String(row.id), itemId: String(row.item_id), conclusion: String(row.conclusion), assumptions: JSON.parse(String(row.assumptions)), preferencesUsed: JSON.parse(String(row.preferences_used)), confidence: String(row.confidence) as Decision["confidence"], stability: String(row.stability) as Decision["stability"], changeConditions: JSON.parse(String(row.change_conditions)), pendingOutcome: Number(row.pending_outcome) !== 0, status: String(row.status) as Decision["status"], createdAt: String(row.created_at) }
}

function rowToOutcome(row: Row): Outcome {
  return { id: String(row.id), itemId: String(row.item_id), decisionId: row.decision_id === null ? undefined : String(row.decision_id), outcomeType: String(row.outcome_type) as Outcome["outcomeType"], note: row.note === null ? undefined : String(row.note), confirmedAt: String(row.confirmed_at), createdAt: String(row.created_at) }
}

function rowToRevision(row: Row): Revision {
  return { id: String(row.id), itemId: String(row.item_id), supersedesDecisionId: String(row.supersedes_decision_id), newDecisionId: String(row.new_decision_id), reason: String(row.reason), createdAt: String(row.created_at) }
}

function rowToPreference(row: Row): UserPreference {
  return { id: String(row.id), namespace: String(row.namespace), key: String(row.key), value: String(row.value), sensitive: Number(row.sensitive) !== 0, status: String(row.status) as UserPreference["status"], createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

function rowToTaxonomy(row: Row): TaxonomyNode {
  return { id: String(row.id), parentId: row.parent_id === null ? null : String(row.parent_id), name: String(row.name), version: Number(row.version), status: String(row.status) as TaxonomyNode["status"] }
}

function rowToTag(row: Row): TagMembership {
  return { id: String(row.id), targetKind: String(row.target_kind) as TagMembership["targetKind"], targetId: String(row.target_id), taxonomyNodeId: String(row.taxonomy_node_id) }
}
