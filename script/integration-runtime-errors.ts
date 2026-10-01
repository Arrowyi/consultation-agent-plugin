import { startRuntimeProvider } from "./integration-runtime-provider.ts"
import { createRuntimeHost } from "./integration-runtime-host.ts"

const provider = startRuntimeProvider()
const host = await createRuntimeHost(provider.url)
try {
  await host.start()
  for (const status of [402, 429]) {
    provider.arm("writer", [{ kind: "error", status }])
    const parent = await host.createParent()
    await host.api(`/session/${parent}/prompt_async`, { agent: "consultation-writer", model: { providerID: "fixture", modelID: "writer" }, parts: [{ type: "text", text: "controlled error fixture" }] })
    const deadline = Date.now() + 120000
    let captured = false
    while (Date.now() < deadline) {
      const messages = await host.messages(parent)
      const error = messages.find((m) => m.info.error !== undefined)?.info.error
      if (error !== undefined) { console.log(JSON.stringify({ status, error })); captured = true; break }
      await Bun.sleep(500)
    }
    if (!captured) console.log(JSON.stringify({ status, terminal_error: "absent", provider_requests: provider.counts.get("writer") }))
    await host.api(`/session/${parent}/abort`, {})
  }
} finally { try { await host.cleanup() } finally { provider.stop() } }
