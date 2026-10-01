import { z } from "zod"

const RequestSchema = z.object({ model: z.string(), messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() }).passthrough()) })
const CommandSchema = z.object({ tool: z.string(), args: z.record(z.unknown()) })
export type ScriptedReply =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly args: Readonly<Record<string, unknown>> }
  | { readonly kind: "held"; readonly gate: string; readonly text: string }
  | { readonly kind: "error"; readonly status: number }

export function startRuntimeProvider() {
  const queues = new Map<string, ScriptedReply[]>()
  const gates = new Map<string, () => void>()
  const counts = new Map<string, number>()
  const seen = new Set<string>()
  const waiters = new Map<string, (() => void)[]>()
  const streams = new Set<() => void>()
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0, idleTimeout: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path.startsWith("/control/release/")) {
        gates.get(decodeURIComponent(path.slice("/control/release/".length)))?.()
        return Response.json({ released: true })
      }
      if (path !== "/v1/chat/completions") return new Response("not found", { status: 404 })
      const input = RequestSchema.parse(await request.json())
      counts.set(input.model, (counts.get(input.model) ?? 0) + 1)
      seen.add(input.model)
      for (const notify of waiters.get(input.model) ?? []) notify()
      waiters.delete(input.model)
      let reply = queues.get(input.model)?.shift()
      if (input.model === "consultant") {
        const last = input.messages.at(-1)
        if (last?.role === "user") {
          const content = typeof last.content === "string" ? last.content : JSON.stringify(last.content)
          const match = content.match(/FIXTURE_COMMAND:(\{.*\})/s)
          if (match?.[1] !== undefined) {
            const command = CommandSchema.parse(JSON.parse(match[1]))
            reply = { kind: "tool", name: command.tool, args: command.args }
          }
        }
      }
      reply ??= { kind: "text", text: "fixture acknowledged" }
      if (reply.kind === "error") {
        queues.get(input.model)?.unshift(reply)
        return Response.json({ error: { message: "controlled provider failure", type: "rate_limit_error", code: "rate_limit" } }, { status: reply.status, headers: { "retry-after": "0" } })
      }
      const selected = reply
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder()
          let closed = false
          const emit = (delta: unknown, finish: string | null = null) => {
            if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ id: "chatcmpl-fixture", object: "chat.completion.chunk", created: 1, model: input.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`))
          }
          const close = () => {
            if (closed) return
            closed = true
            clearInterval(heartbeat)
            streams.delete(close)
            controller.close()
          }
          const heartbeat = setInterval(() => { if (!closed) controller.enqueue(encoder.encode(": fixture keepalive\n\n")) }, 1000)
          streams.add(close)
          request.signal.addEventListener("abort", close, { once: true })
          emit({ role: "assistant" })
          switch (selected.kind) {
            case "tool":
              emit({ tool_calls: [{ index: 0, id: `call_${crypto.randomUUID().replaceAll("-", "")}`, type: "function", function: { name: selected.name, arguments: JSON.stringify(selected.args) } }] })
              emit({}, "tool_calls")
              close()
              break
            case "text":
              emit({ content: selected.text })
              emit({}, "stop")
              close()
              break
            case "held":
              emit({ content: "fixture progress; not final. " })
              gates.set(selected.gate, () => {
                emit({ content: selected.text })
                emit({}, "stop")
                gates.delete(selected.gate)
                close()
              })
              break
            default:
              selected satisfies never
          }
        },
      })
      return new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    counts,
    arm(model: string, replies: readonly ScriptedReply[]) { queues.set(model, [...replies]) },
    async requested(model: string) {
      if (seen.has(model)) return
      await new Promise<void>((resolve) => waiters.set(model, [...(waiters.get(model) ?? []), resolve]))
    },
    async release(gate: string) { await fetch(`http://127.0.0.1:${server.port}/control/release/${encodeURIComponent(gate)}`) },
    stop() { for (const close of streams) close(); server.stop(true) },
  }
}
