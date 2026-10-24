#!/usr/bin/env bun
// janus-memory CLI. Maintenance: export | import | migrate | check | reindex.
// Browsing the consultation record: list | show <id> | search <q> | delete <id> | forget <id>.
// Minimal argv parsing, no external dependency. Opens the store from
// JANUS_* env vars (falling back to XDG defaults).

import { readFile, writeFile } from "node:fs/promises"
import { openMemoryStore, type OpenStoreOptions } from "./store.ts"
import { exportMemory, importMemory } from "./export-import.ts"

type Row = Record<string, unknown>
type Store = Awaited<ReturnType<typeof openMemoryStore>>

const USAGE = "usage: janus-memory <export [--out f] | import --in f | migrate | check | reindex | list [--limit N] [--namespace NS] | show <id> | search <q> [--limit N] | delete <id> | forget <id>> [--json]\n"

export async function runCli(argv: string[], env: NodeJS.ProcessEnv): Promise<number> {
  const [command, ...rest] = argv
  if (command === undefined) {
    process.stderr.write(USAGE)
    return 1
  }
  const options = storeOptionsFromEnv(env)
  const store = await openMemoryStore(options)
  try {
    switch (command) {
      case "export":
        return await runExport(store, rest)
      case "import":
        return await runImport(store, rest)
      case "migrate":
        return 0
      case "check":
        return await runCheck(store)
      case "reindex":
        return await runReindex(store)
      case "list":
        return runList(store, rest)
      case "show":
        return runShow(store, rest)
      case "search":
        return runSearch(store, rest)
      case "delete":
        return await runDelete(store, rest, "retire")
      case "forget":
        return await runDelete(store, rest, "forget")
      default:
        process.stderr.write(`unknown command: ${command}\n`)
        return 1
    }
  } finally {
    await store.close()
  }
}

function storeOptionsFromEnv(env: NodeJS.ProcessEnv): OpenStoreOptions {
  return {
    ...(env.JANUS_DATA_DIR !== undefined && env.JANUS_DATA_DIR.length > 0 ? { dataDir: env.JANUS_DATA_DIR } : {}),
    ...(env.JANUS_STATE_DIR !== undefined && env.JANUS_STATE_DIR.length > 0 ? { stateDir: env.JANUS_STATE_DIR } : {}),
    ...(env.JANUS_CACHE_DIR !== undefined && env.JANUS_CACHE_DIR.length > 0 ? { cacheDir: env.JANUS_CACHE_DIR } : {}),
  }
}

async function runExport(store: Store, rest: readonly string[]): Promise<number> {
  const outPath = flagValue(rest, "--out")
  const payload = exportMemory(store.db)
  const json = JSON.stringify(payload, null, 2)
  if (outPath !== undefined) {
    await writeFile(outPath, json, "utf8")
  } else {
    process.stdout.write(`${json}\n`)
  }
  return 0
}

async function runImport(store: Store, rest: readonly string[]): Promise<number> {
  const inPath = flagValue(rest, "--in")
  if (inPath === undefined) {
    process.stderr.write("import requires --in <file>\n")
    return 1
  }
  const raw: unknown = JSON.parse(await readFile(inPath, "utf8"))
  importMemory(store.db, raw)
  return 0
}

async function runCheck(store: Store): Promise<number> {
  const integrity = store.integrityCheck()
  const orphanCount = store.db.prepare("SELECT count(*) AS c FROM memory_fts f LEFT JOIN experience_items i ON i.id = f.item_id WHERE i.id IS NULL").get() as { c: number }
  const ok = integrity === "ok" && Number(orphanCount.c) === 0
  process.stdout.write(`${JSON.stringify({ integrity_check: integrity, orphan_fts_rows: Number(orphanCount.c), ok })}\n`)
  return ok ? 0 : 1
}

async function runReindex(store: Store): Promise<number> {
  store.reindexFts()
  process.stdout.write("reindexed\n")
  return 0
}

const CONCLUSION_SUBQUERY = "(SELECT d.conclusion FROM decisions d WHERE d.item_id = i.id AND d.status = 'active' ORDER BY d.created_at DESC LIMIT 1) AS conclusion"

function runList(store: Store, rest: readonly string[]): number {
  const { flags } = splitArgs(rest)
  const limit = intFlag(flags, "--limit", 20)
  const namespace = flags.get("--namespace")
  const where = namespace === undefined || namespace === true
    ? "WHERE i.status = 'active'"
    : "WHERE i.status = 'active' AND i.namespace = ?"
  const sql = `SELECT i.id, i.namespace, i.title, i.one_line_summary, i.updated_at, ${CONCLUSION_SUBQUERY} FROM experience_items i ${where} ORDER BY i.updated_at DESC LIMIT ?`
  const rows = (namespace === undefined || namespace === true
    ? store.db.prepare(sql).all(limit)
    : store.db.prepare(sql).all(namespace, limit)) as Row[]
  return emit(rows.map(rowToConsultation), rest, (items) => items.length === 0 ? "no consultations found" : items.map(formatConsultation).join("\n\n"))
}

function runShow(store: Store, rest: readonly string[]): number {
  const { positional } = splitArgs(rest)
  const id = positional[0]
  if (id === undefined) {
    process.stderr.write("show requires an item id (see `list`)\n")
    return 1
  }
  const item = store.db.prepare("SELECT * FROM experience_items WHERE id = ?").get(id) as Row | null
  if (item === null) {
    process.stderr.write(`no consultation with id ${id}\n`)
    return 1
  }
  const claims = store.db.prepare("SELECT text, claim_type, status FROM claims WHERE item_id = ? AND status = 'active'").all(id) as Row[]
  const decision = store.db.prepare("SELECT conclusion, confidence, stability FROM decisions WHERE item_id = ? AND status = 'active' LIMIT 1").get(id) as Row | null
  const sources = store.db.prepare("SELECT source_json, grade FROM evidence WHERE item_id = ?").all(id) as Row[]
  return emit({ item, claims, decision, sources }, rest, () => formatFullConsultation(item, claims, decision, sources))
}

function runSearch(store: Store, rest: readonly string[]): number {
  const { positional, flags } = splitArgs(rest)
  const query = positional[0]
  if (query === undefined) {
    process.stderr.write("search requires a query\n")
    return 1
  }
  const limit = intFlag(flags, "--limit", 20)
  const namespace = flags.get("--namespace")
  const base = `SELECT i.id, i.namespace, i.title, i.one_line_summary, i.updated_at, ${CONCLUSION_SUBQUERY} FROM memory_fts f JOIN experience_items i ON i.id = f.item_id WHERE memory_fts MATCH ? AND i.status = 'active'`
  const sql = namespace === undefined || namespace === true ? `${base} ORDER BY i.updated_at DESC LIMIT ?` : `${base} AND i.namespace = ? ORDER BY i.updated_at DESC LIMIT ?`
  const rows = (namespace === undefined || namespace === true
    ? store.db.prepare(sql).all(sanitizeFts(query), limit)
    : store.db.prepare(sql).all(sanitizeFts(query), namespace, limit)) as Row[]
  return emit(rows.map(rowToConsultation), rest, (items) => items.length === 0 ? `no consultations matching "${query}"` : items.map(formatConsultation).join("\n\n"))
}

async function runDelete(store: Store, rest: readonly string[], action: "retire" | "forget"): Promise<number> {
  const { positional } = splitArgs(rest)
  const id = positional[0]
  if (id === undefined) {
    process.stderr.write(`${action === "retire" ? "delete" : "forget"} requires an item id (see \`list\`)\n`)
    return 1
  }
  const row = store.db.prepare("SELECT namespace FROM experience_items WHERE id = ?").get(id) as Row | null
  if (row === null) {
    process.stderr.write(`no consultation with id ${id}\n`)
    return 1
  }
  const result = await store.manage({ action, namespace: String(row.namespace), itemId: id })
  if (result.action !== action) {
    process.stderr.write(`unexpected result: ${JSON.stringify(result)}\n`)
    return 1
  }
  process.stdout.write(action === "retire" ? `retired ${id}\n` : `forgot ${id}\n`)
  return 0
}

type ConsultationRow = { id: string; namespace: string; title: string; oneLineSummary: string; conclusion: string | null; updatedAt: string }

function rowToConsultation(row: Row): ConsultationRow {
  return {
    id: String(row.id),
    namespace: String(row.namespace),
    title: String(row.title),
    oneLineSummary: String(row.one_line_summary),
    conclusion: row.conclusion === null ? null : String(row.conclusion),
    updatedAt: String(row.updated_at),
  }
}

function formatConsultation(row: ConsultationRow): string {
  return `${row.updatedAt}  ${row.title} — ${row.oneLineSummary}\n  结论: ${row.conclusion ?? "(无)"}\n  [${row.namespace}]  id=${row.id}`
}

function formatFullConsultation(item: Row, claims: Row[], decision: Row | null, sources: Row[]): string {
  const lines = [`问题: ${String(item.title)}`, `摘要: ${String(item.one_line_summary)}`]
  if (decision === null) {
    lines.push("结论: (无)")
  } else {
    lines.push(`结论: ${String(decision.conclusion)}`)
    lines.push(`  置信度: ${String(decision.confidence)}  稳定性: ${String(decision.stability)}`)
  }
  if (claims.length > 0) {
    lines.push("论点:")
    for (const claim of claims) lines.push(`  - ${String(claim.text)}`)
  }
  if (sources.length > 0) {
    lines.push("来源:")
    for (const source of sources) {
      const meta = JSON.parse(String(source.source_json)) as { title?: string }
      lines.push(`  - ${meta.title ?? "?"} (${String(source.grade)})`)
    }
  }
  lines.push(`[${String(item.namespace)}]  id=${String(item.id)}  updated=${String(item.updated_at)}`)
  return lines.join("\n")
}

function emit<T>(data: T, rest: readonly string[], render: (data: T) => string): number {
  if (rest.includes("--json")) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
  } else {
    process.stdout.write(`${render(data)}\n`)
  }
  return 0
}

function splitArgs(rest: readonly string[]): { positional: string[]; flags: Map<string, string | true> } {
  const positional: string[] = []
  const flags = new Map<string, string | true>()
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index]
    if (arg === undefined) continue
    if (arg.startsWith("--")) {
      const next = rest[index + 1]
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(arg, next)
        index++
      } else {
        flags.set(arg, true)
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function intFlag(flags: Map<string, string | true>, name: string, fallback: number): number {
  const value = flags.get(name)
  if (value === undefined || value === true) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) || parsed <= 0 ? fallback : parsed
}

function flagValue(rest: readonly string[], flag: string): string | undefined {
  const index = rest.indexOf(flag)
  if (index === -1) return undefined
  return rest[index + 1]
}

function sanitizeFts(text: string): string {
  const tokens = text.split(/\s+/).map((token) => token.replace(/[^A-Za-z0-9_]/g, "")).filter((token) => token.length > 0)
  if (tokens.length === 0) return text.replace(/['"]/g, "")
  return tokens.map((token) => `"${token}"`).join(" ")
}

async function main(): Promise<void> {
  const code = await runCli(process.argv.slice(2), process.env)
  if (code !== 0) process.exit(code)
}

if (import.meta.main) {
  void main()
}
