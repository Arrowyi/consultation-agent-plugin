import { expect, test } from "bun:test"
import { startRuntimeProvider } from "./integration-runtime-provider.ts"

test("holds a streamed final marker until fixture control releases it", async () => {
  // Given a specialist stream armed with an explicit release gate.
  const provider = startRuntimeProvider()
  provider.arm("explorer", [{ kind: "held", gate: "late", text: "report" }])
  try {
    // When the provider receives a real OpenAI-compatible HTTP request.
    const response = await fetch(`${provider.url}/v1/chat/completions`, { method: "POST", body: JSON.stringify({ model: "explorer", messages: [{ role: "user", content: "fixture" }] }) })
    const reader = response.body?.getReader()
    if (!reader) throw new Error("missing stream")
    const first = new TextDecoder().decode((await reader.read()).value)
    // Then the final marker is absent until the control endpoint releases it.
    expect(first).not.toContain('"finish_reason":"stop"')
    await provider.release("late")
    const rest = new TextDecoder().decode((await reader.read()).value)
    expect(rest).toContain('"finish_reason":"stop"')
  } finally { provider.stop() }
})
