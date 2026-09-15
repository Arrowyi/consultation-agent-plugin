import { z } from "zod"

export const RevisionStatusSchema = z.enum(["active", "superseded", "refuted", "retired", "forgotten"])
export const ClaimTypeSchema = z.enum(["verifiable_fact", "causal_efficacy", "experiential_judgment", "future_prediction", "value_preference"])
export const SourceGradeSchema = z.enum(["high", "medium", "low", "lead_only"])
export const ConsultationTierSchema = z.enum(["fast", "standard", "deep"])
export const EvidenceConfidenceSchema = z.enum(["high", "medium", "low"])
export const RecommendationStabilitySchema = z.enum(["stable", "conditional", "provisional"])
export const EvidenceRelationSchema = z.enum(["supports", "refutes", "qualifies", "supersedes"])
export const OutcomeTypeSchema = z.enum(["satisfied", "dissatisfied", "effective", "ineffective", "neutral"])

export type RevisionStatus = z.infer<typeof RevisionStatusSchema>
export type ClaimType = z.infer<typeof ClaimTypeSchema>
export type SourceGrade = z.infer<typeof SourceGradeSchema>
export type ConsultationTier = z.infer<typeof ConsultationTierSchema>
export type EvidenceConfidence = z.infer<typeof EvidenceConfidenceSchema>
export type RecommendationStability = z.infer<typeof RecommendationStabilitySchema>
export type EvidenceRelation = z.infer<typeof EvidenceRelationSchema>
export type OutcomeType = z.infer<typeof OutcomeTypeSchema>
