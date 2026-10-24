// Zod schemas for MCP tool input validation. Prepared* schemas mirror the
// readonly types in memory-core's store-port.ts. Tool-level schemas validate
// the 5 MCP tool arguments before dispatching to the MemoryStore.

import { z } from "zod"
import {
  ApplicabilitySchema,
  ClaimTypeSchema,
  ConsultationTierSchema,
  EvidenceConfidenceSchema,
  EvidenceRelationSchema,
  OutcomeTypeSchema,
  RecommendationStabilitySchema,
  RevisionStatusSchema,
  SourceGradeSchema,
  SourceMetaSchema,
} from "@janus-agent/memory-core"

export const preparedClaimSchema = z.object({
  claimType: ClaimTypeSchema,
  text: z.string().min(1),
  applicability: ApplicabilitySchema.optional(),
  confidence: EvidenceConfidenceSchema.optional(),
})

export const preparedEvidenceSchema = z.object({
  claimText: z.string().min(1),
  relation: EvidenceRelationSchema,
  source: SourceMetaSchema,
  excerpt: z.string().max(2000).optional(),
  grade: SourceGradeSchema,
  independenceChainId: z.string().min(1),
  note: z.string().optional(),
})

export const preparedDecisionSchema = z.object({
  conclusion: z.string().min(1),
  assumptions: z.array(z.string()).optional(),
  preferencesUsed: z.array(z.string()).optional(),
  confidence: EvidenceConfidenceSchema,
  stability: RecommendationStabilitySchema,
  changeConditions: z.array(z.string()).optional(),
  reason: z.string().optional(),
  pendingOutcome: z.boolean().optional(),
})

export const sensitiveFieldSchema = z.object({
  field: z.string(),
  label: z.string(),
  confirmed: z.boolean(),
})

export const preparedItemSchema = z.object({
  topicKey: z.string().min(1),
  title: z.string().min(1),
  oneLineSummary: z.string().max(280),
  applicability: ApplicabilitySchema.optional(),
  claims: z.array(preparedClaimSchema).optional(),
  evidence: z.array(preparedEvidenceSchema).optional(),
  decision: preparedDecisionSchema.optional(),
  sensitiveFields: z.array(sensitiveFieldSchema).optional(),
  taxonomyNodeIds: z.array(z.string()).optional(),
})

export const preparedPreferenceSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  sensitive: z.boolean(),
  confirmed: z.boolean().optional(),
})

export const recallInputSchema = z.object({
  text: z.string().optional(),
  taxonomyNodeId: z.string().optional(),
  tier: ConsultationTierSchema,
  limit: z.number().int().positive().optional(),
  expandTop: z.number().int().min(0).optional(),
  tokenBudget: z.number().int().positive().optional(),
  region: z.string().optional(),
  timeScope: z.string().optional(),
  includeStatuses: z.array(RevisionStatusSchema).optional(),
})

export const expandInputSchema = z.object({
  itemIds: z.array(z.string()).max(5),
  level: z.union([z.literal(3), z.literal(4)]),
  tokenBudget: z.number().int().positive().optional(),
})

export const prepareInputSchema = z.object({
  hostSessionId: z.string().min(1),
  title: z.string().min(1),
  items: z.array(preparedItemSchema),
  preferences: z.array(preparedPreferenceSchema).optional(),
})

export const commitInputSchema = z.object({
  hostSessionId: z.string().min(1),
  title: z.string().min(1),
  items: z.array(preparedItemSchema),
  preferences: z.array(preparedPreferenceSchema).optional(),
  previewToken: z.string().min(1),
})

export const manageInputSchema = z.object({
  action: z.enum(["retire", "forget", "forget_session", "list_preferences", "upsert_preference", "delete_preference", "list_sessions", "edit_item", "record_outcome", "stats"]),
  itemId: z.string().optional(),
  hostSessionId: z.string().optional(),
  includeRetired: z.boolean().optional(),
  key: z.string().optional(),
  value: z.string().optional(),
  sensitive: z.boolean().optional(),
  confirmed: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
  title: z.string().optional(),
  oneLineSummary: z.string().max(280).optional(),
  decisionId: z.string().optional(),
  outcomeType: OutcomeTypeSchema.optional(),
  note: z.string().optional(),
  conclusion: z.string().optional(),
  reason: z.string().optional(),
})

export type ManageArgs = z.infer<typeof manageInputSchema>
