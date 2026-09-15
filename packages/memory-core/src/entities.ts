import { z } from "zod"
import {
  ClaimTypeSchema,
  EvidenceConfidenceSchema,
  EvidenceRelationSchema,
  OutcomeTypeSchema,
  RecommendationStabilitySchema,
  RevisionStatusSchema,
  SourceGradeSchema,
} from "./enums.ts"

export const ApplicabilitySchema = z.object({
  time: z.string().optional(),
  region: z.string().optional(),
  conditions: z.string().optional(),
})

export const SourceMetaSchema = z.object({
  url: z.string().url().optional(),
  stableId: z.string().optional(),
  title: z.string().min(1),
  authorOrInstitution: z.string().optional(),
  publishedAt: z.string().optional(),
  accessedAt: z.string(),
}).refine((source) => source.url !== undefined || source.stableId !== undefined)

export const SessionExperienceSchema = z.object({
  id: z.string().uuid(), namespace: z.string().min(1), hostSessionId: z.string().min(1), title: z.string().min(1),
  status: RevisionStatusSchema.default("active"), previewToken: z.string().min(1), createdAt: z.string(), updatedAt: z.string(),
})

export const ExperienceItemSchema = z.object({
  id: z.string().uuid(), sessionExperienceId: z.string().uuid(), topicKey: z.string().min(1), title: z.string().min(1),
  oneLineSummary: z.string().max(280), applicability: ApplicabilitySchema.default({}), status: RevisionStatusSchema.default("active"),
  sensitiveFields: z.array(z.object({ field: z.string(), label: z.string(), confirmed: z.boolean() })).default([]),
  createdAt: z.string(), updatedAt: z.string(),
})

export const ClaimSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), claimType: ClaimTypeSchema, text: z.string().min(1),
  applicability: ApplicabilitySchema.default({}), status: RevisionStatusSchema.default("active"),
  confidence: EvidenceConfidenceSchema.default("medium"), createdAt: z.string(),
})

export const EvidenceSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), source: SourceMetaSchema, excerpt: z.string().max(2000).optional(),
  fingerprint: z.string().min(1), grade: SourceGradeSchema, independenceChainId: z.string().min(1), createdAt: z.string(),
})

export const EvidenceLinkSchema = z.object({
  id: z.string().uuid(), claimId: z.string().uuid(), evidenceId: z.string().uuid(), relation: EvidenceRelationSchema,
  note: z.string().optional(), createdAt: z.string(),
})

export const DecisionSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), conclusion: z.string().min(1), assumptions: z.array(z.string()).default([]),
  preferencesUsed: z.array(z.string()).default([]), confidence: EvidenceConfidenceSchema, stability: RecommendationStabilitySchema,
  changeConditions: z.array(z.string()).default([]), pendingOutcome: z.boolean().default(false),
  status: RevisionStatusSchema.default("active"), createdAt: z.string(),
})

export const OutcomeSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), decisionId: z.string().uuid().optional(),
  outcomeType: OutcomeTypeSchema, note: z.string().optional(), confirmedAt: z.string(), createdAt: z.string(),
})

export const RevisionSchema = z.object({
  id: z.string().uuid(), itemId: z.string().uuid(), supersedesDecisionId: z.string().uuid(), newDecisionId: z.string().uuid(),
  reason: z.string().min(1), createdAt: z.string(),
})

export const UserPreferenceSchema = z.object({
  id: z.string().uuid(), namespace: z.string().min(1), key: z.string().min(1), value: z.string().min(1),
  sensitive: z.boolean().default(false), status: RevisionStatusSchema.default("active"), createdAt: z.string(), updatedAt: z.string(),
})

export const TaxonomyNodeSchema = z.object({
  id: z.string().uuid(), parentId: z.string().uuid().nullable(), name: z.string().min(1), version: z.number().int().positive(),
  status: RevisionStatusSchema.default("active"),
})

export const TagMembershipSchema = z.object({
  id: z.string().uuid(), targetKind: z.enum(["item", "claim"]), targetId: z.string().uuid(), taxonomyNodeId: z.string().uuid(),
})

export const DerivedSummarySchema = z.object({
  id: z.string().uuid(), targetKind: z.enum(["item", "claim", "session"]), targetId: z.string().uuid(), kind: z.enum(["one_line", "full"]),
  model: z.string().min(1), promptVersion: z.string().min(1), schemaVersion: z.number().int().positive(), text: z.string(), createdAt: z.string(),
})

export type Applicability = z.infer<typeof ApplicabilitySchema>
export type SourceMeta = z.infer<typeof SourceMetaSchema>
export type SessionExperience = z.infer<typeof SessionExperienceSchema>
export type ExperienceItem = z.infer<typeof ExperienceItemSchema>
export type Claim = z.infer<typeof ClaimSchema>
export type Evidence = z.infer<typeof EvidenceSchema>
export type EvidenceLink = z.infer<typeof EvidenceLinkSchema>
export type Decision = z.infer<typeof DecisionSchema>
export type Outcome = z.infer<typeof OutcomeSchema>
export type Revision = z.infer<typeof RevisionSchema>
export type UserPreference = z.infer<typeof UserPreferenceSchema>
export type TaxonomyNode = z.infer<typeof TaxonomyNodeSchema>
export type TagMembership = z.infer<typeof TagMembershipSchema>
export type DerivedSummary = z.infer<typeof DerivedSummarySchema>
