import { z } from "zod"

export const ClaimKindSchema = z.enum([
  "fact",
  "causal",
  "experiential",
  "prediction",
  "preference",
])
export const RiskLevelSchema = z.enum(["low", "medium", "high"])
export const TierSchema = z.enum(["fast", "standard", "deep"])
export const SourceGradeSchema = z.enum(["high", "medium", "low", "lead_only"])
export const ConfidenceSchema = z.enum(["high", "medium", "low"])
export const StabilitySchema = z.enum(["stable", "conditional", "provisional"])

/**
 * Decision type the consultation is answering. Orthogonal to Tier (depth).
 * - select: choose among candidates (shopping, comparisons, picking a tool).
 * - verify: verdict on a proposition (rumors, claims, arguments).
 * - plan: produce an actionable plan (lifestyle, fitness, learning).
 * - research: understand a topic deeply (open-ended investigation) — produces a
 *   readable research report, not a decision brief.
 */
export const ConsultationModeSchema = z.enum(["select", "verify", "plan", "research"])

/**
 * Per-atom epistemic status. `inferred` and `unverifiable` must carry a basis
 * (the reasoning chain) — never a bare conclusion.
 */
export const EpistemicStatusSchema = z.enum(["verified", "refuted", "inferred", "unverifiable"])

/**
 * Deliberate-deception annotation for a source, graded separately from
 * reliability. `suspect_shill` = paid/coordinated positive; `suspect_smear` =
 * competitor/hostile negative. Never a ground-truth "this review is fake".
 */
export const SourceIntentSchema = z.enum(["clean", "suspect_shill", "suspect_smear", "unknown"])

export type ClaimKind = z.infer<typeof ClaimKindSchema>
export type RiskLevel = z.infer<typeof RiskLevelSchema>
export type Tier = z.infer<typeof TierSchema>
export type SourceGrade = z.infer<typeof SourceGradeSchema>
export type Confidence = z.infer<typeof ConfidenceSchema>
export type Stability = z.infer<typeof StabilitySchema>
export type ConsultationMode = z.infer<typeof ConsultationModeSchema>
export type EpistemicStatus = z.infer<typeof EpistemicStatusSchema>
export type SourceIntent = z.infer<typeof SourceIntentSchema>
