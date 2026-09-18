import { z } from "zod"
import { EpistemicStatusSchema } from "./enums.ts"

export const AuthorProfileSchema = z.enum(["tutorial", "architecture", "explanation"])
export type AuthorProfile = z.infer<typeof AuthorProfileSchema>

export const AuthorDeliverySchema = z.enum(["inline", "single_file", "multi_file"])
export type AuthorDelivery = z.infer<typeof AuthorDeliverySchema>

export const AuthorVerificationSchema = z.enum(["light", "targeted", "strict"])
export type AuthorVerification = z.infer<typeof AuthorVerificationSchema>

export const AuthorSectionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  purpose: z.string().min(1),
  file: z.string().min(1).optional(),
  learningObjectives: z.array(z.string().min(1)).default([]),
  prerequisites: z.array(z.string().min(1)).default([]),
  verificationTargets: z.array(z.string().min(1)).default([]),
})
export type AuthorSection = z.infer<typeof AuthorSectionSchema>

export const AuthorClaimSchema = z
  .object({
    claim: z.string().min(1),
    sectionIds: z.array(z.string().min(1)).min(1),
    status: EpistemicStatusSchema,
    basis: z.string().min(1).optional(),
    verificationMethod: z.string().min(1),
  })
  .refine(
    (value) =>
      !(value.status === "inferred" || value.status === "unverifiable") ||
      value.basis !== undefined,
    { message: "inferred/unverifiable author claims must carry a basis", path: ["basis"] },
  )
export type AuthorClaim = z.infer<typeof AuthorClaimSchema>
