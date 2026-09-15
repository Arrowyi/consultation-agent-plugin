// Single DDL string for migration 0001. PRAGMAs + every canonical/derived table
// + the FTS5 virtual table and the triggers that keep it in sync.
// The plan had a typo (REFERENCES experience_items_id_fk) — fixed to
// REFERENCES session_experiences(id) ON DELETE CASCADE.

export const SCHEMA_DDL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_experiences (
  id TEXT PRIMARY KEY, namespace TEXT NOT NULL, host_session_id TEXT NOT NULL,
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active',
  preview_token TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (namespace, host_session_id)
);

CREATE TABLE IF NOT EXISTS experience_items (
  id TEXT PRIMARY KEY,
  session_experience_id TEXT NOT NULL REFERENCES session_experiences(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, topic_key TEXT NOT NULL, title TEXT NOT NULL,
  one_line_summary TEXT NOT NULL, applicability TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active', sensitive_fields TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE (session_experience_id, topic_key)
);

CREATE TABLE IF NOT EXISTS claims (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, claim_type TEXT NOT NULL, text TEXT NOT NULL,
  applicability TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active',
  confidence TEXT NOT NULL DEFAULT 'medium', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, source_json TEXT NOT NULL, excerpt TEXT,
  fingerprint TEXT NOT NULL, grade TEXT NOT NULL, independence_chain_id TEXT NOT NULL,
  created_at TEXT NOT NULL, UNIQUE (item_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS evidence_links (
  id TEXT PRIMARY KEY, claim_id TEXT NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
  relation TEXT NOT NULL, note TEXT, created_at TEXT NOT NULL,
  UNIQUE (claim_id, evidence_id, relation)
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, conclusion TEXT NOT NULL, assumptions TEXT NOT NULL DEFAULT '[]',
  preferences_used TEXT NOT NULL DEFAULT '[]', confidence TEXT NOT NULL, stability TEXT NOT NULL,
  change_conditions TEXT NOT NULL DEFAULT '[]', pending_outcome INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outcomes (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  namespace TEXT NOT NULL, decision_id TEXT, outcome_type TEXT NOT NULL,
  note TEXT, confirmed_at TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  supersedes_decision_id TEXT NOT NULL, new_decision_id TEXT NOT NULL,
  reason TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id TEXT PRIMARY KEY, namespace TEXT NOT NULL, key TEXT NOT NULL,
  value TEXT NOT NULL, sensitive INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (namespace, key)
);

CREATE TABLE IF NOT EXISTS taxonomy_nodes (
  id TEXT PRIMARY KEY, parent_id TEXT REFERENCES taxonomy_nodes(id),
  name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (parent_id, name)
);

CREATE TABLE IF NOT EXISTS tag_memberships (
  id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
  taxonomy_node_id TEXT NOT NULL REFERENCES taxonomy_nodes(id),
  UNIQUE (target_kind, target_id, taxonomy_node_id)
);

CREATE TABLE IF NOT EXISTS derived_summaries (
  id TEXT PRIMARY KEY, target_kind TEXT NOT NULL, target_id TEXT NOT NULL,
  kind TEXT NOT NULL, model TEXT NOT NULL, prompt_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS derived_embeddings (
  item_id TEXT NOT NULL REFERENCES experience_items(id) ON DELETE CASCADE,
  model TEXT NOT NULL, dimensions INTEGER NOT NULL, vector BLOB NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (item_id, model)
);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  item_id UNINDEXED, namespace UNINDEXED, title, one_line_summary, claims_text, decision_text
);

CREATE TRIGGER IF NOT EXISTS memory_fts_ai AFTER INSERT ON experience_items BEGIN
  INSERT INTO memory_fts (item_id, namespace, title, one_line_summary, claims_text, decision_text)
  SELECT NEW.id, NEW.namespace, NEW.title, NEW.one_line_summary,
    COALESCE((SELECT group_concat(text, ' ') FROM claims WHERE item_id = NEW.id), ''),
    COALESCE((SELECT group_concat(conclusion, ' ') FROM decisions WHERE item_id = NEW.id AND status = 'active'), '');
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_au AFTER UPDATE ON experience_items BEGIN
  UPDATE memory_fts SET title = NEW.title, one_line_summary = NEW.one_line_summary,
    claims_text = COALESCE((SELECT group_concat(text, ' ') FROM claims WHERE item_id = NEW.id), ''),
    decision_text = COALESCE((SELECT group_concat(conclusion, ' ') FROM decisions WHERE item_id = NEW.id AND status = 'active'), '')
  WHERE item_id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_ad AFTER DELETE ON experience_items BEGIN
  DELETE FROM memory_fts WHERE item_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_claim_ai AFTER INSERT ON claims BEGIN
  UPDATE memory_fts SET claims_text = COALESCE((SELECT group_concat(text, ' ') FROM claims WHERE item_id = NEW.item_id), '')
  WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_claim_au AFTER UPDATE ON claims BEGIN
  UPDATE memory_fts SET claims_text = COALESCE((SELECT group_concat(text, ' ') FROM claims WHERE item_id = NEW.item_id), '')
  WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_claim_ad AFTER DELETE ON claims BEGIN
  UPDATE memory_fts SET claims_text = COALESCE((SELECT group_concat(text, ' ') FROM claims WHERE item_id = OLD.item_id), '')
  WHERE item_id = OLD.item_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_decision_ai AFTER INSERT ON decisions BEGIN
  UPDATE memory_fts SET decision_text = COALESCE((SELECT group_concat(conclusion, ' ') FROM decisions WHERE item_id = NEW.item_id AND status = 'active'), '')
  WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_decision_au AFTER UPDATE ON decisions BEGIN
  UPDATE memory_fts SET decision_text = COALESCE((SELECT group_concat(conclusion, ' ') FROM decisions WHERE item_id = NEW.item_id AND status = 'active'), '')
  WHERE item_id = NEW.item_id;
END;

CREATE TRIGGER IF NOT EXISTS memory_fts_decision_ad AFTER DELETE ON decisions BEGIN
  UPDATE memory_fts SET decision_text = COALESCE((SELECT group_concat(conclusion, ' ') FROM decisions WHERE item_id = OLD.item_id AND status = 'active'), '')
  WHERE item_id = OLD.item_id;
END;
`

export const REINDEX_FTS_SQL = `
DELETE FROM memory_fts;
INSERT INTO memory_fts (item_id, namespace, title, one_line_summary, claims_text, decision_text)
SELECT i.id, i.namespace, i.title, i.one_line_summary,
  COALESCE((SELECT group_concat(c.text, ' ') FROM claims c WHERE c.item_id = i.id), ''),
  COALESCE((SELECT group_concat(d.conclusion, ' ') FROM decisions d WHERE d.item_id = i.id AND d.status = 'active'), '')
FROM experience_items i;
`
