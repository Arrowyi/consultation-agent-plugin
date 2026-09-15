import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  type CommitResult,
  type MemoryStore,
  type PreparedItem,
  MemoryError,
  computeFingerprint,
  containsSecret,
} from "@consultation-agent/memory-core"
import { type OpenedMemoryStore, openMemoryStore } from "./index.ts"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
})

async function openStore(embedding?: OpenedMemoryStore["embedding"] | null): Promise<OpenedMemoryStore> {
  const directory = await mkdtemp(join(tmpdir(), "consultation-memory-"))
  directories.push(directory)
  return openMemoryStore({ dataDir: directory, stateDir: directory, cacheDir: directory, embedding: embedding ?? null })
}

function item(overrides: Partial<PreparedItem> & { topicKey?: string; title?: string; oneLineSummary?: string } = {}): PreparedItem {
  return {
    topicKey: "drinks",
    title: "Drinks",
    oneLineSummary: "A beverage choice",
    applicability: {},
    ...overrides,
  }
}

function draft(overrides: {
  items?: readonly PreparedItem[]
  title?: string
  conclusion?: string
  namespace?: string
  hostSessionId?: string
} = {}): {
  namespace: string
  hostSessionId: string
  title: string
  now: string
  items: readonly PreparedItem[]
} {
  const conclusion = overrides.conclusion ?? "choose tea"
  return {
    namespace: overrides.namespace ?? "test",
    hostSessionId: overrides.hostSessionId ?? "host",
    title: overrides.title ?? "Session",
    now: "2026-08-16T00:00:00.000Z",
    items: overrides.items ?? [
      item({
        claims: [{ claimType: "verifiable_fact", text: "Tea has caffeine." }],
        decision: { conclusion, confidence: "medium", stability: "conditional" },
      }),
    ],
  }
}

describe("SQLite memory store — prepare", () => {
  test("prepare persists nothing and warns about secrets", async () => {
    // given
    const memory = await openStore()
    const secret = `sk-${"a".repeat(20)}`
    // when
    const preview = await memory.prepare({
      ...draft(),
      items: [item({ oneLineSummary: `leaked ${secret}` })],
    })
    const stats = await memory.manage({ action: "stats", namespace: "test" })
    // then
    expect(preview.warnings.some((w) => w.includes("SECRET_DETECTED"))).toBe(true)
    if (stats.action !== "stats") throw new Error("expected stats result")
    expect(stats.items).toBe(0)
    await memory.close()
  })
})

describe("SQLite memory store — commit", () => {
  test("commit is idempotent: same previewToken replay returns created=false and identical ids", async () => {
    // given
    const memory = await openStore()
    const first = draft()
    const preview = await memory.prepare(first)
    // when
    const committed = await memory.commit({ ...first, previewToken: preview.previewToken })
    const replay = await memory.commit({ ...first, previewToken: preview.previewToken })
    // then
    expect(committed.created).toBe(true)
    expect(replay.created).toBe(false)
    expect(replay.itemIds).toEqual(committed.itemIds)
    expect(replay.sessionExperienceId).toBe(committed.sessionExperienceId)
    await memory.close()
  })

  test("commit upserts the session package and items with no duplicate ranking candidates on repeated saves", async () => {
    // given
    const memory = await openStore()
    const first = draft()
    const preview1 = await memory.prepare(first)
    await memory.commit({ ...first, previewToken: preview1.previewToken })
    // when — re-save the same session with a different preview token (package update)
    const updated = draft({ title: "Session v2" })
    const preview2 = await memory.prepare(updated)
    const second = await memory.commit({ ...updated, previewToken: preview2.previewToken })
    const stats = await memory.manage({ action: "stats", namespace: "test" })
    const recalled = await memory.recall({ namespace: "test", text: "beverage", tier: "standard" })
    // then — one session, one item, no duplicate candidates
    expect(second.created).toBe(false)
    if (stats.action !== "stats") throw new Error("expected stats result")
    expect(stats.sessions).toBe(1)
    expect(stats.items).toBe(1)
    expect(recalled.candidates.filter((c) => c.title === "Drinks")).toHaveLength(1)
    await memory.close()
  })

  test("committing a changed conclusion creates a Revision and supersedes the old decision", async () => {
    // given
    const memory = await openStore()
    const first = draft()
    const preview1 = await memory.prepare(first)
    const committed = await memory.commit({ ...first, previewToken: preview1.previewToken })
    // when — revise the conclusion with a reason
    const revised = draft({ conclusion: "choose coffee" })
    const preview2 = await memory.prepare(revised)
    const result = await memory.commit({
      ...revised,
      items: [
        item({
          decision: {
            conclusion: "choose coffee",
            confidence: "medium",
            stability: "conditional",
            reason: "user now prefers coffee",
          },
        }),
      ],
      previewToken: preview2.previewToken,
    })
    // then
    expect(result.revisionIds).toHaveLength(1)
    const itemId = Object.values(committed.itemIds)[0] ?? ""
    const oldDecision = memory.db
      .prepare("SELECT status FROM decisions WHERE item_id = ? AND status = 'superseded' LIMIT 1")
      .get(itemId) as { status: string } | null
    expect(oldDecision?.status).toBe("superseded")
    const newDecision = memory.db
      .prepare("SELECT status FROM decisions WHERE item_id = ? AND status = 'active' LIMIT 1")
      .get(itemId) as { status: string } | null
    expect(newDecision?.status).toBe("active")
    await memory.close()
  })

  test("a changed conclusion without a reason is rejected with VALIDATION_FAILED", async () => {
    // given
    const memory = await openStore()
    const first = draft()
    const preview1 = await memory.prepare(first)
    await memory.commit({ ...first, previewToken: preview1.previewToken })
    // when
    const revised = draft({ conclusion: "choose coffee" })
    const preview2 = await memory.prepare(revised)
    const attempt = memory.commit({ ...revised, previewToken: preview2.previewToken })
    // then
    await expect(attempt).rejects.toMatchObject({ code: "VALIDATION_FAILED" } satisfies Partial<MemoryError>)
    await memory.close()
  })

  test("unconfirmed sensitiveFields are rejected with SENSITIVE_UNCONFIRMED naming each field", async () => {
    // given
    const memory = await openStore()
    const input = draft({
      items: [
        item({
          sensitiveFields: [
            { field: "decision.preferencesUsed[0].value", label: "preference value", confirmed: false },
          ],
        }),
      ],
    })
    const preview = await memory.prepare(input)
    // when
    const attempt = memory.commit({ ...input, previewToken: preview.previewToken })
    // then
    await expect(attempt).rejects.toMatchObject({ code: "SENSITIVE_UNCONFIRMED" } satisfies Partial<MemoryError>)
    await expect(attempt).rejects.toThrow("decision.preferencesUsed[0].value")
    await memory.close()
  })

  test("SECRET_PATTERNS text in commit is rejected with SECRET_DETECTED", async () => {
    // given
    const memory = await openStore()
    const secret = `ghp_${"a".repeat(36)}`
    const input = draft({ items: [item({ oneLineSummary: `token ${secret}` })] })
    const preview = await memory.prepare(input)
    // when
    const attempt = memory.commit({ ...input, previewToken: preview.previewToken })
    // then
    await expect(attempt).rejects.toMatchObject({ code: "SECRET_DETECTED" } satisfies Partial<MemoryError>)
    await memory.close()
  })
})

describe("SQLite memory store — recall", () => {
  test("recall honors planRetrieval caps (limit/expandTop/tokenBudget) and returns memoriesUsedDisclosure", async () => {
    // given
    const memory = await openStore()
    const input = draft({
      items: [
        item({ topicKey: "tea", title: "Tea choice", oneLineSummary: "Tea is calming" }),
        item({ topicKey: "coffee", title: "Coffee choice", oneLineSummary: "Coffee is stimulating" }),
      ],
    })
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    // when — limit 1, small token budget forces truncation
    const recalled = await memory.recall({
      namespace: "test",
      text: "choice",
      tier: "standard",
      limit: 1,
      expandTop: 0,
      tokenBudget: 5,
    })
    // then
    expect(recalled.candidates.length).toBeLessThanOrEqual(1)
    expect(recalled.memoriesUsedDisclosure.length).toBeGreaterThan(0)
    await memory.close()
  })

  test("deep-tier recall includes superseded/refuted items, standard does not", async () => {
    // given
    const memory = await openStore()
    const input = draft({
      items: [
        item({ topicKey: "active-topic", title: "Active Topic", oneLineSummary: "An active experience" }),
        item({ topicKey: "old-topic", title: "Old Topic", oneLineSummary: "A superseded experience" }),
      ],
    })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const oldId = committed.itemIds["old-topic"]
    if (oldId !== undefined) {
      memory.db.prepare("UPDATE experience_items SET status = 'superseded' WHERE id = ?").run(oldId)
    }
    // when
    const standard = await memory.recall({ namespace: "test", text: "experience", tier: "standard" })
    const deep = await memory.recall({ namespace: "test", text: "experience", tier: "deep" })
    // then
    expect(standard.candidates.map((c) => c.title)).not.toContain("Old Topic")
    expect(deep.candidates.map((c) => c.title)).toContain("Old Topic")
    await memory.close()
  })

  test("an item misclassified in taxonomy is still found via FTS text match", async () => {
    // given
    const memory = await openStore()
    const input = draft({
      items: [
        item({
          topicKey: "orchid",
          title: "Misclassified",
          oneLineSummary: "Orchid cultivation guide",
          taxonomyNodeIds: [crypto.randomUUID()],
        }),
      ],
    })
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    // when — search by text, no taxonomy filter
    const recalled = await memory.recall({ namespace: "test", text: "orchid", tier: "standard" })
    // then
    expect(recalled.candidates).toHaveLength(1)
    expect(recalled.candidates[0]?.title).toBe("Misclassified")
    expect(recalled.memoriesUsedDisclosure).toContain("Misclassified")
    await memory.close()
  })
})

describe("SQLite memory store — evidence dedup", () => {
  test("duplicate evidence fingerprint under one item is deduplicated (UNIQUE(item_id, fingerprint))", async () => {
    // given
    const memory = await openStore()
    const source = { title: "Source", url: "https://example.test/a", accessedAt: "2026-08-16T00:00:00Z" }
    const fingerprint = computeFingerprint(source, "Excerpt")
    const input = draft({
      items: [
        item({
          claims: [{ claimType: "verifiable_fact", text: "Claim one" }, { claimType: "verifiable_fact", text: "Claim two" }],
          evidence: [
            { claimText: "Claim one", relation: "supports", source, excerpt: "Excerpt", grade: "high", independenceChainId: "chain-1" },
            { claimText: "Claim two", relation: "supports", source, excerpt: "Excerpt", grade: "high", independenceChainId: "chain-1" },
          ],
        }),
      ],
    })
    const preview = await memory.prepare(input)
    // when
    await memory.commit({ ...input, previewToken: preview.previewToken })
    const stats = await memory.manage({ action: "stats", namespace: "test" })
    // then — two claims but only one evidence row (same fingerprint under same item)
    if (stats.action !== "stats") throw new Error("expected stats result")
    expect(stats.claims).toBe(2)
    expect(stats.evidence).toBe(1)
    expect(containsSecret(fingerprint)).toBe(false)
    await memory.close()
  })
})

describe("SQLite memory store — forget and retire", () => {
  test("forget removes canonical rows + derived + FTS rows and subsequent recall returns nothing", async () => {
    // given
    const memory = await openStore()
    const input = draft({
      items: [
        item({
          topicKey: "orchid",
          title: "Orchid Guide",
          oneLineSummary: "Orchid cultivation guide",
          taxonomyNodeIds: [crypto.randomUUID()],
        }),
      ],
    })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["orchid"]
    if (itemId !== undefined) {
      // when
      await memory.manage({ action: "forget", namespace: "test", itemId })
    }
    const forgotten = await memory.recall({ namespace: "test", text: "orchid", tier: "standard" })
    const ftsCount = memory.db.prepare("SELECT count(*) AS c FROM memory_fts WHERE item_id = ?").get(itemId ?? "") as { c: number }
    // then
    expect(forgotten.candidates).toHaveLength(0)
    expect(ftsCount.c).toBe(0)
    await memory.close()
  })

  test("retire only flips status and the item is excluded from standard recall", async () => {
    // given
    const memory = await openStore()
    const input = draft({ items: [item({ topicKey: "tea", title: "Tea", oneLineSummary: "Tea is calming" })] })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["tea"]
    if (itemId === undefined) throw new Error("missing item id")
    const before = memory.db.prepare("SELECT status FROM experience_items WHERE id = ?").get(itemId) as { status: string }
    // when
    await memory.manage({ action: "retire", namespace: "test", itemId })
    const after = memory.db.prepare("SELECT status FROM experience_items WHERE id = ?").get(itemId) as { status: string }
    const standard = await memory.recall({ namespace: "test", text: "tea", tier: "standard" })
    // then
    expect(before.status).toBe("active")
    expect(after.status).toBe("retired")
    expect(standard.candidates).toHaveLength(0)
    await memory.close()
  })
})

describe("SQLite memory store — manage v2", () => {
  test("list_sessions returns committed sessions with title and item count", async () => {
    // given
    const memory = await openStore()
    const input = draft({ title: "Buying a keyboard" })
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    // when
    const result = await memory.manage({ action: "list_sessions", namespace: "test" })
    // then
    if (result.action !== "list_sessions") throw new Error("expected list_sessions")
    expect(result.sessions).toHaveLength(1)
    expect(result.sessions[0]?.title).toBe("Buying a keyboard")
    expect(result.sessions[0]?.itemCount).toBe(1)
    await memory.close()
  })

  test("edit_item updates the item title and summary", async () => {
    // given
    const memory = await openStore()
    const input = draft({ items: [item({ topicKey: "tea", title: "Tea", oneLineSummary: "Tea is calming" })] })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["tea"]
    if (itemId === undefined) throw new Error("missing item id")
    // when
    const result = await memory.manage({ action: "edit_item", namespace: "test", itemId, title: "Green Tea", oneLineSummary: "Green tea is calming" })
    // then
    if (result.action !== "edit_item") throw new Error("expected edit_item")
    expect(result.item.title).toBe("Green Tea")
    expect(result.item.oneLineSummary).toBe("Green tea is calming")
    await memory.close()
  })

  test("record_outcome stores the outcome and clears the pending outcome flag", async () => {
    // given: a decision committed with a pending outcome
    const memory = await openStore()
    const input = draft({
      items: [
        item({
          topicKey: "keyboard",
          title: "Keyboard",
          oneLineSummary: "A keyboard choice",
          decision: { conclusion: "buy the split keyboard", confidence: "medium", stability: "conditional", pendingOutcome: true },
        }),
      ],
    })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["keyboard"]
    if (itemId === undefined) throw new Error("missing item id")
    const pendingBefore = memory.db.prepare("SELECT pending_outcome AS p FROM decisions WHERE item_id = ? AND status = 'active'").get(itemId) as { p: number }

    // when
    const result = await memory.manage({ action: "record_outcome", namespace: "test", itemId, outcomeType: "satisfied", note: "Wrists feel better" })

    // then
    if (result.action !== "record_outcome") throw new Error("expected record_outcome")
    expect(result.outcome.outcomeType).toBe("satisfied")
    expect(result.outcome.itemId).toBe(itemId)
    const outcomeCount = memory.db.prepare("SELECT count(*) AS c FROM outcomes WHERE item_id = ?").get(itemId) as { c: number }
    const pendingAfter = memory.db.prepare("SELECT pending_outcome AS p FROM decisions WHERE item_id = ? AND status = 'active'").get(itemId) as { p: number }
    expect(pendingBefore.p).toBe(1)
    expect(outcomeCount.c).toBe(1)
    expect(pendingAfter.p).toBe(0)
    await memory.close()
  })

  test("edit_item with a changed conclusion creates a revision and keeps the new conclusion active", async () => {
    // given
    const memory = await openStore()
    const input = draft({ items: [item({ topicKey: "keyboard", title: "Keyboard", oneLineSummary: "A keyboard choice", decision: { conclusion: "buy the split keyboard", confidence: "medium", stability: "conditional" } })] })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["keyboard"]
    if (itemId === undefined) throw new Error("missing item id")

    // when
    const result = await memory.manage({ action: "edit_item", namespace: "test", itemId, conclusion: "buy the ergonomic keyboard", reason: "better reviews" })

    // then
    if (result.action !== "edit_item") throw new Error("expected edit_item")
    expect(result.revisedConclusion).toBe(true)
    const decisions = memory.db.prepare("SELECT conclusion, status FROM decisions WHERE item_id = ?").all(itemId) as { conclusion: string; status: string }[]
    const revisionCount = memory.db.prepare("SELECT count(*) AS c FROM revisions WHERE item_id = ?").get(itemId) as { c: number }
    expect(decisions.find((d) => d.status === "active")?.conclusion).toBe("buy the ergonomic keyboard")
    expect(decisions.find((d) => d.status === "superseded")?.conclusion).toBe("buy the split keyboard")
    expect(revisionCount.c).toBe(1)
    await memory.close()
  })

  test("edit_item with an unchanged conclusion does not revise", async () => {
    // given
    const memory = await openStore()
    const input = draft({ items: [item({ topicKey: "keyboard", title: "Keyboard", oneLineSummary: "A keyboard choice", decision: { conclusion: "buy the split keyboard", confidence: "medium", stability: "conditional" } })] })
    const preview = await memory.prepare(input)
    const committed = await memory.commit({ ...input, previewToken: preview.previewToken })
    const itemId = committed.itemIds["keyboard"]
    if (itemId === undefined) throw new Error("missing item id")

    // when
    const result = await memory.manage({ action: "edit_item", namespace: "test", itemId, conclusion: "buy the split keyboard" })

    // then
    if (result.action !== "edit_item") throw new Error("expected edit_item")
    expect(result.revisedConclusion).toBe(false)
    await memory.close()
  })
})

describe("SQLite memory store — embeddings", () => {
  test("null embedding provider: recall still works end to end via taxonomy+FTS", async () => {
    // given
    const memory = await openStore(null)
    const input = draft({ items: [item({ topicKey: "tea", title: "Tea", oneLineSummary: "Tea is calming" })] })
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    // when
    const recalled = await memory.recall({ namespace: "test", text: "tea", tier: "standard" })
    // then
    expect(recalled.candidates).toHaveLength(1)
    await memory.close()
  })

  test("fake embedding provider: commit stores embeddings and recall blends cosine without crashing", async () => {
    // given
    const fake = {
      id: "fake",
      dimensions: 4,
      embed: async (texts: readonly string[]): Promise<number[][]> =>
        texts.map((text) => {
          const hash = text.charCodeAt(0) ?? 0
          return [hash % 2, (hash >> 1) % 2, (hash >> 2) % 2, (hash >> 3) % 2]
        }),
    }
    const memory = await openStore(fake)
    const input = draft({ items: [item({ topicKey: "tea", title: "Tea", oneLineSummary: "Tea is calming" })] })
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    // when
    const recalled = await memory.recall({ namespace: "test", text: "Tea", tier: "standard" })
    const stats = await memory.manage({ action: "stats", namespace: "test" })
    // then
    expect(recalled.candidates.length).toBeGreaterThan(0)
    if (stats.action !== "stats") throw new Error("expected stats result")
    expect(stats.embeddings).toBeGreaterThanOrEqual(1)
    await memory.close()
  })
})
