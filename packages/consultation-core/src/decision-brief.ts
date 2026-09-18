import { z, ZodError } from "zod"

import { AuthorBriefSchema, assertValidAuthorDelivery, authorTexts } from "./author-brief.ts"
import { baseBriefShape, basisRefinement } from "./brief-base.ts"
import {
  ConfidenceSchema,
  EpistemicStatusSchema,
  SourceGradeSchema,
  SourceIntentSchema,
} from "./enums.ts"
import { ConsultationError, ConsultationErrorCode } from "./errors.ts"

export const SelectCandidateSchema = z.object({
  option: z.string().min(1),
  evidenceGrade: SourceGradeSchema,
  intent: SourceIntentSchema.default("unknown"),
  suitedFor: z.string().optional(),
  trialAdvice: z.string().optional(),
})
export type SelectCandidate = z.infer<typeof SelectCandidateSchema>

export const SelectBriefSchema = z.object({
  mode: z.literal("select"),
  ...baseBriefShape,
  suitedFor: z.string().optional(),
  benefits: z.array(z.string()).max(3).default([]),
  risks: z.array(z.string()).max(3).default([]),
  candidates: z.array(SelectCandidateSchema).min(1),
  switchConditions: z.array(z.string()).default([]),
})

export const VerdictClaimSchema = z
  .object({
    claim: z.string().min(1),
    status: EpistemicStatusSchema,
    basis: z.string().optional(),
    evidence: z.array(z.string()).default([]),
  })
  .refine(basisRefinement((claim) => claim.status), {
    message: "inferred/unverifiable claims must carry a basis",
    path: ["basis"],
  })
export type VerdictClaim = z.infer<typeof VerdictClaimSchema>

export const VerifyBriefSchema = z.object({
  mode: z.literal("verify"),
  ...baseBriefShape,
  verdict: z.enum(["true", "false", "unverifiable"]),
  claimVerdicts: z.array(VerdictClaimSchema).min(1),
  supportingEvidence: z.array(z.string()).default([]),
  opposingEvidence: z.array(z.string()).default([]),
  contaminationNote: z.string().optional(),
})

export const PlanStepSchema = z
  .object({
    step: z.string().min(1),
    support: EpistemicStatusSchema,
    basis: z.string().optional(),
    risk: z.string().optional(),
    confidence: ConfidenceSchema.optional(),
    alternatives: z.array(z.string()).default([]),
  })
  .refine(basisRefinement((step) => step.support), {
    message: "inferred/unverifiable steps must carry a basis",
    path: ["basis"],
  })
export type PlanStep = z.infer<typeof PlanStepSchema>

export const PlanBriefSchema = z.object({
  mode: z.literal("plan"),
  ...baseBriefShape,
  goal: z.string().min(1),
  suitedFor: z.string().optional(),
  steps: z.array(PlanStepSchema).min(1),
  assumptions: z.array(z.string()).default([]),
  healthNote: z.string().optional(),
  residualUncertainty: z.string().optional(),
  alternatives: z.array(z.object({ option: z.string(), switchCondition: z.string() })).default([]),
})

export const ResearchHypothesisSchema = z.object({
  hypothesis: z.string().min(1),
  confidence: ConfidenceSchema,
  support: z.string().optional(),
  counter: z.string().optional(),
})
export type ResearchHypothesis = z.infer<typeof ResearchHypothesisSchema>

export const ResearchBriefSchema = z.object({
  mode: z.literal("research"),
  ...baseBriefShape,
  keyPoints: z.array(z.string()).min(1),
  soWhat: z.string().optional(),
  hypotheses: z.array(ResearchHypothesisSchema).default([]),
  disagreements: z.array(z.string()).default([]),
  residualUncertainty: z.array(z.string()).default([]),
})

export const GuideBackgroundPointSchema = z
  .object({
    point: z.string().min(1),
    status: EpistemicStatusSchema.optional(),
    basis: z.string().optional(),
  })
  .refine(
    (value) =>
      !(value.status === "inferred" || value.status === "unverifiable") ||
      (value.basis !== undefined && value.basis.length > 0),
    {
      message: "inferred/unverifiable background points must carry a basis",
      path: ["basis"],
    },
  )
export type GuideBackgroundPoint = z.infer<typeof GuideBackgroundPointSchema>

// z.discriminatedUnion only accepts plain ZodObject members, so this schema has
// no top-level .refine; the recommendation-or-procedure requirement is enforced
// in validateDecisionBrief.
export const GuideBriefSchema = z.object({
  mode: z.literal("guide"),
  ...baseBriefShape,
  goal: z.string().min(1),
  suitedFor: z.string().optional(),
  prerequisites: z.array(z.string()).default([]),
  recommendation: z.array(SelectCandidateSchema).default([]),
  procedure: z.array(PlanStepSchema).default([]),
  background: z.array(GuideBackgroundPointSchema).default([]),
  completionCheck: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  residualUncertainty: z.string().optional(),
})
export type GuideBrief = z.infer<typeof GuideBriefSchema>

export const DecisionBriefSchema = z.discriminatedUnion("mode", [
  SelectBriefSchema,
  VerifyBriefSchema,
  PlanBriefSchema,
  ResearchBriefSchema,
  GuideBriefSchema,
  AuthorBriefSchema,
])
export type DecisionBrief = z.infer<typeof DecisionBriefSchema>

const numericConfidencePattern = /(\d{1,3})\s*%/

export function assertNoNumericConfidence(text: string): void {
  if (numericConfidencePattern.test(text)) {
    throw new ConsultationError(ConsultationErrorCode.NUMERIC_CONFIDENCE)
  }
}

function briefTexts(brief: DecisionBrief): string[] {
  const texts: string[] = [
    brief.conclusion,
    ...brief.verifiedFacts,
    ...brief.synthesis,
    brief.nextAction,
    ...brief.memoryDisclosure,
  ]
  for (const source of brief.sources) {
    texts.push(source.title)
    if (source.url !== undefined) texts.push(source.url)
  }
  if (brief.mode === "select") {
    if (brief.suitedFor !== undefined) texts.push(brief.suitedFor)
    texts.push(...brief.benefits, ...brief.risks, ...brief.switchConditions)
    for (const candidate of brief.candidates) {
      texts.push(candidate.option)
      if (candidate.suitedFor !== undefined) texts.push(candidate.suitedFor)
      if (candidate.trialAdvice !== undefined) texts.push(candidate.trialAdvice)
    }
  } else if (brief.mode === "verify") {
    for (const claim of brief.claimVerdicts) {
      texts.push(claim.claim, ...claim.evidence)
      if (claim.basis !== undefined) texts.push(claim.basis)
    }
    texts.push(...brief.supportingEvidence, ...brief.opposingEvidence)
    if (brief.contaminationNote !== undefined) texts.push(brief.contaminationNote)
  } else if (brief.mode === "plan") {
    texts.push(brief.goal, ...brief.assumptions)
    if (brief.suitedFor !== undefined) texts.push(brief.suitedFor)
    if (brief.healthNote !== undefined) texts.push(brief.healthNote)
    if (brief.residualUncertainty !== undefined) texts.push(brief.residualUncertainty)
    for (const step of brief.steps) {
      texts.push(step.step, ...step.alternatives)
      if (step.basis !== undefined) texts.push(step.basis)
      if (step.risk !== undefined) texts.push(step.risk)
    }
    for (const alternative of brief.alternatives) {
      texts.push(alternative.option, alternative.switchCondition)
    }
  } else if (brief.mode === "guide") {
    texts.push(brief.goal, ...brief.assumptions, ...brief.prerequisites)
    if (brief.suitedFor !== undefined) texts.push(brief.suitedFor)
    if (brief.completionCheck !== undefined) texts.push(brief.completionCheck)
    if (brief.residualUncertainty !== undefined) texts.push(brief.residualUncertainty)
    for (const point of brief.background) {
      texts.push(point.point)
      if (point.basis !== undefined) texts.push(point.basis)
    }
    for (const candidate of brief.recommendation) {
      texts.push(candidate.option)
      if (candidate.suitedFor !== undefined) texts.push(candidate.suitedFor)
      if (candidate.trialAdvice !== undefined) texts.push(candidate.trialAdvice)
    }
    for (const step of brief.procedure) {
      texts.push(step.step, ...step.alternatives)
      if (step.basis !== undefined) texts.push(step.basis)
      if (step.risk !== undefined) texts.push(step.risk)
    }
  } else if (brief.mode === "author") {
    texts.push(...authorTexts(brief))
  } else {
    texts.push(...brief.keyPoints, ...brief.disagreements, ...brief.residualUncertainty)
    if (brief.soWhat !== undefined) texts.push(brief.soWhat)
    for (const hypothesis of brief.hypotheses) {
      texts.push(hypothesis.hypothesis)
      if (hypothesis.support !== undefined) texts.push(hypothesis.support)
      if (hypothesis.counter !== undefined) texts.push(hypothesis.counter)
    }
  }
  return texts
}

export function validateDecisionBrief(input: unknown): DecisionBrief {
  try {
    const brief = DecisionBriefSchema.parse(input)
    if (brief.mode === "author") assertValidAuthorDelivery(brief)
    if (brief.mode === "guide" && brief.recommendation.length === 0 && brief.procedure.length === 0) {
      throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
    }
    for (const text of briefTexts(brief)) assertNoNumericConfidence(text)
    return brief
  } catch (error) {
    if (error instanceof ConsultationError) throw error
    if (error instanceof ZodError) {
      throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
    }
    throw error
  }
}
