import { z } from "zod"
import type { RuntimeHost } from "./integration-runtime-host.ts"
import type { HostMessage } from "./integration-dispatch-primitives.ts"

export const EnvelopeSchema = z.object({ v: z.literal(1), status: z.enum(["pending", "unknown", "cancelling", "cancelled"]), job_id: z.string(), session_id: z.string(), role: z.string(), waited_ms: z.number() }).passthrough()

export async function invokeTool(host: RuntimeHost, parent: string, tool: string, args: Readonly<Record<string, unknown>>) {
  const messageID = `msg-fixture-${crypto.randomUUID()}`
  await host.api(`/session/${parent}/prompt_async`, { agent: "consultant", model: { providerID: "fixture", modelID: "consultant" }, messageID, parts: [{ type: "text", text: `FIXTURE_COMMAND:${JSON.stringify({ tool, args })}` }] })
  return async () => {
    const deadline = Date.now() + 390000
    while (Date.now() < deadline) {
      const messages = await host.messages(parent)
      for (const message of messages.filter((m) => m.info.parentID === messageID)) {
        const part = message.parts.find((p) => p.tool === tool && p.state?.status === "completed")
        if (part?.state?.output !== undefined) return part.state.output
        const failed = message.parts.find((p) => p.tool === tool && p.state?.status === "error")
        if (failed) throw new Error(`scripted tool failed: ${JSON.stringify(failed.state)}`)
        if (message.info.error !== undefined) throw new Error(`consultant failed: ${JSON.stringify(message.info.error)}`)
      }
      await Bun.sleep(200)
    }
    throw new Error(`scripted ${tool} did not finish within 390s`)
  }
}

export function redactMessages(messages: readonly HostMessage[]) {
  return messages.map((m) => ({ message_id: m.info.id, session_id: m.info.sessionID, parent_id: m.info.parentID, role: m.info.role, finish: m.info.finish, created: m.info.time.created, completed: m.info.time.completed, error_present: m.info.error !== undefined, parts: m.parts.map((p) => ({ type: p.type, id: p.id, message_id: p.messageID, session_id: p.sessionID, ignored: p.ignored, synthetic: p.synthetic, tool: p.tool, status: p.state?.status })) }))
}

export async function findJob(host: RuntimeHost, parent: string) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const roots = await host.children(parent)
    const root = roots.find((r) => r.title.startsWith("[consultation-dispatch:v1] "))
    if (root) {
      const attempts = await host.children(root.id)
      return { root, attempts }
    }
    await Bun.sleep(100)
  }
  throw new Error("no durable dispatch attempt appeared")
}
