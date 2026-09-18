import { z } from "zod"

import {
  AuthorClaimSchema,
  AuthorDeliverySchema,
  AuthorProfileSchema,
  AuthorSectionSchema,
  AuthorVerificationSchema,
} from "./author-contracts.ts"
import { baseBriefShape } from "./brief-base.ts"
import { ConsultationError, ConsultationErrorCode } from "./errors.ts"

// z.discriminatedUnion only accepts plain ZodObject members, so this schema has
// no top-level .refine; the delivery cross-field rules are enforced by
// assertValidAuthorDelivery. An AuthorBrief is a final-delivery artifact only —
// an approved outline is not a partially valid AuthorBrief.
export const AuthorBriefSchema = z.object({
  mode: z.literal("author"),
  ...baseBriefShape,
  profile: AuthorProfileSchema,
  audience: z.string().min(1),
  goal: z.string().min(1),
  delivery: AuthorDeliverySchema,
  verification: AuthorVerificationSchema,
  styleSummary: z.string().min(1),
  outline: z.array(AuthorSectionSchema).min(1),
  loadBearingClaims: z.array(AuthorClaimSchema).default([]),
  artifactPaths: z.array(z.string().min(1)).default([]),
  assumptions: z.array(z.string().min(1)).default([]),
  residualUncertainty: z.array(z.string().min(1)).default([]),
})
export type AuthorBrief = z.infer<typeof AuthorBriefSchema>

export function authorTexts(brief: AuthorBrief): string[] {
  const texts: string[] = [
    brief.audience,
    brief.goal,
    brief.styleSummary,
    ...brief.artifactPaths,
    ...brief.assumptions,
    ...brief.residualUncertainty,
  ]
  for (const section of brief.outline) {
    texts.push(
      section.id,
      section.title,
      section.purpose,
      ...section.learningObjectives,
      ...section.prerequisites,
      ...section.verificationTargets,
    )
    if (section.file !== undefined) texts.push(section.file)
  }
  for (const claim of brief.loadBearingClaims) {
    texts.push(claim.claim, ...claim.sectionIds, claim.verificationMethod)
    if (claim.basis !== undefined) texts.push(claim.basis)
  }
  return texts
}

export function assertValidAuthorDelivery(brief: AuthorBrief): void {
  const artifactPathCount = brief.artifactPaths.length
  switch (brief.delivery) {
    case "inline":
      if (artifactPathCount !== 0) throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
      return
    case "single_file":
      if (artifactPathCount !== 1) throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
      return
    case "multi_file":
      if (brief.outline.length < 2 || artifactPathCount < 2) {
        throw new ConsultationError(ConsultationErrorCode.VALIDATION_FAILED)
      }
      return
    default: {
      const unhandledDelivery: never = brief.delivery
      throw new Error(`unhandled author delivery: ${String(unhandledDelivery)}`)
    }
  }
}
