export const ConsultationErrorCode = {
  BUDGET_EXCEEDED: "BUDGET_EXCEEDED",
  NUMERIC_CONFIDENCE: "NUMERIC_CONFIDENCE",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  PROVIDER_INCOMPLETE: "PROVIDER_INCOMPLETE",
} as const

export type ConsultationErrorCode =
  (typeof ConsultationErrorCode)[keyof typeof ConsultationErrorCode]

export class ConsultationError extends Error {
  override readonly name = "ConsultationError"

  constructor(readonly code: ConsultationErrorCode, message?: string) {
    super(message ?? code)
  }
}
