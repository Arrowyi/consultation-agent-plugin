export const MemoryErrorCodes = [
  "WRITER_LOCKED", "NOT_FOUND", "ILLEGAL_TRANSITION", "IDEMPOTENCY_MISMATCH",
  "SENSITIVE_UNCONFIRMED", "SECRET_DETECTED", "VALIDATION_FAILED", "STORE_CLOSED",
] as const

export type MemoryErrorCode = (typeof MemoryErrorCodes)[number]

export class MemoryError extends Error {
  override readonly name = "MemoryError"

  constructor(readonly code: MemoryErrorCode, message: string) {
    super(`${code}: ${message}`)
  }
}
