import { createHash } from "node:crypto"
import type { SourceMeta } from "./entities.ts"

export function computePreviewToken(payload: unknown): string {
  return sha256(stableJson(payload))
}

export function computeFingerprint(source: SourceMeta, excerpt?: string): string {
  return computePreviewToken({ identity: source.url ?? source.stableId, title: source.title, excerpt: excerpt ?? "" })
}

export function topicKeyFromTitle(title: string): string {
  const normalized = title.normalize("NFKD").toLowerCase().replace(/\p{Mark}+/gu, "")
  const slug = normalized.replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/g, "")
  const bounded = Array.from(slug).slice(0, 64).join("").replace(/-+$/g, "")
  return bounded.length === 0 ? "untitled" : bounded
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function stableJson(value: unknown): string {
  if (value === null) return "null"
  if (typeof value !== "object") return value === undefined ? "null" : (JSON.stringify(value) ?? "null")
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`
  return `{${Object.entries(value).filter(([, nested]) => nested !== undefined).sort(compareEntries).map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`).join(",")}}`
}

function compareEntries([left]: readonly [string, unknown], [right]: readonly [string, unknown]): number {
  return left < right ? -1 : left > right ? 1 : 0
}
