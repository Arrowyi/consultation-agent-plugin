import type { SdkAssistantMessage, SdkMessageWithParts, SdkPart } from "./dispatch-contract.ts"
import { errorText, isRetryableModelError } from "./dispatch-helpers.ts"
import type { ObservationDiagnostics, ObservationOutcome } from "./dispatch-observer.ts"

export type ClassifyResult =
  | { readonly kind: "terminal"; readonly outcome: ObservationOutcome }
  | { readonly kind: "continue"; readonly state: "pending" | "unknown"; readonly diagnostics?: ObservationDiagnostics; readonly reason?: string }

export function extractUsableText(parts: ReadonlyArray<SdkPart> | undefined | null): string | undefined {
  if (!Array.isArray(parts)) return undefined
  const texts: string[] = []
  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") continue
    if (part.ignored === true || part.synthetic === true) continue
    texts.push(part.text)
  }
  const joined = texts.join("\n").trim()
  return joined.length > 0 ? joined : undefined
}

function sortMatchingMessages(messages: ReadonlyArray<SdkMessageWithParts>, childSessionID: string, requestMessageID: string) {
  const matching: Array<{ readonly message: SdkAssistantMessage; readonly parts: ReadonlyArray<SdkPart> }> = []
  for (const message of messages) {
    const info = message.info
    if (info.role !== "assistant" || !("parentID" in info)) continue
    if (info.sessionID !== childSessionID || info.parentID !== requestMessageID) continue
    matching.push({ message: info, parts: message.parts })
  }
  matching.sort((a, b) => {
    const ta = a.message.time?.created ?? 0
    const tb = b.message.time?.created ?? 0
    return ta !== tb ? ta - tb : a.message.id.localeCompare(b.message.id)
  })
  return matching
}

function classifyMatchingStep(newest: SdkAssistantMessage, parts: ReadonlyArray<SdkPart>): ClassifyResult {
  if (newest.time?.completed === undefined) return { kind: "continue", state: "pending", diagnostics: { status: "active" } }
  if (newest.error !== undefined) {
    const error = newest.error
    const name = typeof error === "object" && error !== null && "name" in error ? error.name : undefined
    if (name === "MessageAbortedError") return { kind: "terminal", outcome: { kind: "cancelled" } }
    const data = typeof error === "object" && error !== null && "data" in error ? error.data : undefined
    const flag = typeof data === "object" && data !== null && "isRetryable" in data ? data.isRetryable : undefined
    const retryable = flag === undefined ? isRetryableModelError(error) : name === "APIError" && flag === true
    return { kind: "terminal", outcome: { kind: "failed", error: errorText(error), retryable } }
  }
  if (newest.finish === "tool-calls") return { kind: "continue", state: "pending", diagnostics: { status: "tool-calls" } }
  if (newest.finish === "stop") {
    if (parts.some((part) => part.type === "tool" && (part.state.status === "running" || part.state.status === "pending"))) {
      return { kind: "continue", state: "pending", diagnostics: { status: "tool-calls" } }
    }
    const text = extractUsableText(parts)
    return text === undefined
      ? { kind: "terminal", outcome: { kind: "unknown", reason: "completed stop produced no usable text" } }
      : { kind: "terminal", outcome: { kind: "completed", text } }
  }
  if (newest.finish === "length") return { kind: "terminal", outcome: { kind: "unknown", reason: "finish length indicates partial output" } }
  return { kind: "terminal", outcome: { kind: "unknown", reason: `completed message has unsupported finish marker ${String(newest.finish)}` } }
}

export function classifyReadResult(readResult: { readonly kind: "messages"; readonly messages: ReadonlyArray<SdkMessageWithParts> } | { readonly kind: "error"; readonly reason: string }, childSessionID: string, requestMessageID: string): ClassifyResult {
  if (readResult.kind === "error") return { kind: "terminal", outcome: { kind: "unknown", reason: readResult.reason } }
  const newest = sortMatchingMessages(readResult.messages, childSessionID, requestMessageID).at(-1)
  return newest === undefined ? { kind: "continue", state: "pending" } : classifyMatchingStep(newest.message, newest.parts)
}
