import type { DispatchEnvelope, DispatchOutcome, DispatchRole } from "./dispatch-contract.ts"
import type { ObservationOutcome } from "./dispatch-observer.ts"

export const RETRYABLE_MODEL_ERROR_CODES = ["402", "429", "500", "502", "503", "504"] as const

export function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null || !("name" in error)) return "unrecognized provider error"
  const name = error.name
  if (name !== "APIError" && name !== "MessageAbortedError" && name !== "ProviderAuthError" && name !== "UnknownError" && name !== "MessageOutputLengthError") return "unrecognized provider error"
  const fields: string[] = [name]
  for (const source of [error, "data" in error ? error.data : undefined]) {
    if (typeof source === "object" && source !== null && "statusCode" in source && typeof source.statusCode === "number" && Number.isFinite(source.statusCode)) fields.push(String(source.statusCode))
  }
  return fields.join(": ")
}

export function isRetryableModelError(error: unknown): boolean {
  const sources = [error, typeof error === "object" && error !== null && "data" in error ? error.data : undefined]
  return sources.some((source) => {
    const text = typeof source === "string" ? source : typeof source === "object" && source !== null && "message" in source && typeof source.message === "string" ? source.message : ""
    return RETRYABLE_MODEL_ERROR_CODES.some((code) => text.includes(code)) ||
      (typeof source === "object" && source !== null && "statusCode" in source && typeof source.statusCode === "number" && RETRYABLE_MODEL_ERROR_CODES.some((code) => Number(code) === source.statusCode))
  })
}

/**
 * Split a `provider/model` id into its OpenCode prompt parts.
 * Throws when the id has no `provider/model` separator.
 */
export function splitModel(model: string): { providerID: string; modelID: string } {
  const separator = model.indexOf("/")
  if (separator <= 0 || separator === model.length - 1) {
    throw new Error(`invalid model id "${model}": expected "provider/model"`)
  }
  return { providerID: model.slice(0, separator), modelID: model.slice(separator + 1) }
}

export function formatModel(model: string | null | undefined, agentName: string): string {
  return model ?? `host model of ${agentName}`
}

export function buildChainFailureMessage(
  role: DispatchRole,
  tried: ReadonlyArray<string>,
  lastError: string,
): string {
  return `Error: ${role} dispatch failed on every model in the chain (${tried.join(" -> ")}): ${lastError}; degrade by answering inline and say so.`
}

export function makeEnvelope(
  status: DispatchEnvelope["status"],
  jobID: string,
  role: DispatchRole,
  attempt: { index: number; model: string | null },
  sessionID: string,
  waitedMs: number,
  reason: string,
  next: DispatchEnvelope["next"] = "consultation_dispatch_wait",
): DispatchOutcome {
  return {
    kind: "nonterminal",
    envelope: {
      v: 1,
      status,
      job_id: jobID,
      role,
      attempt: { index: attempt.index, model: attempt.model },
      session_id: sessionID,
      waited_ms: Math.max(0, Math.floor(waitedMs)),
      reason,
      next,
    },
  }
}

export function observationToOutcome(
  observation: ObservationOutcome,
  jobID: string,
  role: DispatchRole,
  attempt: { index: number; model: string | null; sessionID: string },
  waitedMs: number,
): DispatchOutcome {
  switch (observation.kind) {
    case "completed":
      return { kind: "success", text: observation.text }
    case "cancelled":
      return {
        kind: "cancelled",
        envelope: {
          v: 1,
          status: "cancelled",
          job_id: jobID,
          role,
          attempt: { index: attempt.index, model: attempt.model },
          session_id: attempt.sessionID,
          waited_ms: Math.max(0, Math.floor(waitedMs)),
          reason: "dispatch was cancelled",
          next: "consultation_dispatch_wait",
        },
      }
    case "failed":
      return { kind: "failure", reason: `${role} dispatch failed: ${observation.error}` }
    case "pending":
      return makeEnvelope(
        "pending",
        jobID,
        role,
        attempt,
        attempt.sessionID,
        waitedMs,
        observation.diagnostics?.aborted ? "observation aborted" : observation.diagnostics?.reason ??
          (observation.diagnostics?.status === "retry" ? "specialist is retrying" : observation.diagnostics?.status === "busy" ? "specialist is busy" : "waiting for specialist"),
      )
    case "unknown":
      return makeEnvelope("unknown", jobID, role, attempt, attempt.sessionID, waitedMs, observation.reason)
  }
}
