import { z } from "zod"

import { ClaimKindSchema, SourceGradeSchema, SourceIntentSchema } from "./enums.ts"
import { IntentSignalsSchema, SourceInputSchema } from "./source-grading.ts"

export const DecomposedClaimSchema = z.object({
  id: z.string(),
  text: z.string(),
  kind: ClaimKindSchema,
  requiresCounterEvidence: z.boolean(),
})

export type DecomposedClaim = z.infer<typeof DecomposedClaimSchema>

export const GradedSourceSchema = SourceInputSchema.extend({
  grade: SourceGradeSchema,
  url: z.string().optional(),
  accessedAt: z.string(),
  intent: SourceIntentSchema.optional(),
  intentSignals: IntentSignalsSchema.optional(),
})

export type GradedSource = z.infer<typeof GradedSourceSchema>

export const SourceIntentAuditSchema = z.object({
  sourceId: z.string(),
  intent: SourceIntentSchema,
  signals: IntentSignalsSchema,
  rationale: z.string(),
})

export type SourceIntentAudit = z.infer<typeof SourceIntentAuditSchema>
