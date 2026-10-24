// Error mapping from thrown values to MCP tool error results.
// MemoryError -> { isError, content: [{ type: "text", text: { code, message } }] }
// Unexpected   -> { isError, content: [{ type: "text", text: { code: "INTERNAL", message: sanitized } }] }

import { MemoryError } from "@janus-agent/memory-core"

const MAX_MESSAGE_LENGTH = 500

export type ToolErrorResult = {
  isError: true
  content: [{ type: "text"; text: string }]
}

export function mapError(error: unknown): ToolErrorResult {
  if (error instanceof MemoryError) {
    return {
      isError: true,
      content: [{ type: "text", text: JSON.stringify({ code: error.code, message: error.message }) }],
    }
  }
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ code: "INTERNAL", message: sanitizeMessage(error) }) }],
  }
}

function sanitizeMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  if (raw.length <= MAX_MESSAGE_LENGTH) return raw
  const suffix = "..."
  return `${raw.slice(0, MAX_MESSAGE_LENGTH - suffix.length)}${suffix}`
}
