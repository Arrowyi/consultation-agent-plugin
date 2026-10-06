// Test-only child process for multi-instance.test.ts. Waits for a start gate so
// every worker hits the store at the same moment, then opens the shared store,
// commits its own session plus one session shared by every worker, and prints
// the stats as JSON. Not part of any bundle entrypoint.

import { existsSync } from "node:fs"
import { join } from "node:path"
import { openMemoryStore } from "./index.ts"

const dir = process.env.WORKER_DIR ?? ""
const id = process.env.WORKER_ID ?? "0"

while (!existsSync(join(dir, "go"))) await Bun.sleep(1)

const memory = await openMemoryStore({ dataDir: dir, stateDir: dir, cacheDir: dir })
try {
  for (const hostSessionId of [`worker-${id}`, "shared-session"]) {
    const input = {
      namespace: "concurrency",
      hostSessionId,
      title: `session ${hostSessionId} from ${id}`,
      now: "2026-08-16T00:00:00.000Z",
      items: [
        {
          topicKey: "topic",
          title: `Topic ${hostSessionId}`,
          oneLineSummary: `Summary written by worker ${id}`,
          claims: [{ claimType: "verifiable_fact" as const, text: `Claim by ${id}` }],
          decision: { conclusion: "same conclusion", confidence: "medium" as const, stability: "conditional" as const },
        },
      ],
    }
    const preview = await memory.prepare(input)
    await memory.commit({ ...input, previewToken: preview.previewToken })
    await memory.recall({ namespace: "concurrency", text: "Topic", tier: "standard" })
  }
  process.stdout.write(JSON.stringify({ ok: true }))
} finally {
  await memory.close()
}
