import { z } from "zod"
import type { Assertion } from "./integration-helpers.ts"

export const SessionSchema = z.object({ id: z.string(), parentID: z.string().optional(), directory: z.string(), title: z.string() })
export const MessageSchema = z.object({
  info: z.object({ id: z.string(), sessionID: z.string(), role: z.string(), parentID: z.string().optional(), finish: z.string().optional(), time: z.object({ created: z.number(), completed: z.number().optional() }), error: z.unknown().optional() }),
  parts: z.array(z.object({ type: z.string(), id: z.string(), messageID: z.string(), sessionID: z.string(), text: z.string().optional(), ignored: z.boolean().optional(), synthetic: z.boolean().optional(), tool: z.string().optional(), state: z.object({ status: z.string(), output: z.string().optional() }).passthrough().optional() })),
})
export type HostMessage = z.infer<typeof MessageSchema>
export type HostApi = (path: string, body?: unknown) => Promise<unknown>

export async function proveDispatchPrimitives(api: HostApi, directory: string): Promise<Assertion[]> {
  const parent = SessionSchema.parse(await api("/session", { title: "primitive parent" }))
  const root = SessionSchema.parse(await api("/session", { parentID: parent.id, title: "[consultation-dispatch:v1] explorer" }))
  const attempt = SessionSchema.parse(await api("/session", { parentID: root.id, title: "[consultation-dispatch:v1] attempt explorer" }))
  const children = SessionSchema.array().parse(await api(`/session/${root.id}/children`))
  await api(`/session/${root.id}/message`, { messageID: "msg-primitives", noReply: true, parts: [{ type: "text", text: "{}", ignored: true, synthetic: true }] })
  const messages = MessageSchema.array().parse(await api(`/session/${root.id}/message`))
  const record = messages.find((m) => m.info.id === "msg-primitives")
  const part = record?.parts.find((p) => p.type === "text")
  return [
    { name: "host root/attempt parent hierarchy", pass: root.parentID === parent.id && attempt.parentID === root.id && children.some((c) => c.id === attempt.id), detail: JSON.stringify({ parent: parent.id, root: root.id, attempt: attempt.id }) },
    { name: "host workspace binding", pass: [parent, root, attempt].every((s) => s.directory === directory), detail: JSON.stringify({ expected: directory, observed: [parent.directory, root.directory, attempt.directory] }) },
    { name: "noReply persists user message without assistant", pass: record?.info.role === "user" && messages.every((m) => m.info.role !== "assistant"), detail: `messages=${messages.length}` },
    { name: "journal ignored/synthetic flags persist", pass: part?.ignored === true && part.synthetic === true, detail: JSON.stringify({ messageID: record?.info.id, type: part?.type, ignored: part?.ignored, synthetic: part?.synthetic }) },
  ]
}
