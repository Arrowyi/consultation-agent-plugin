import { z } from "zod";
import {
  ClaimSchema, DecisionSchema, EvidenceLinkSchema, EvidenceSchema, ExperienceItemSchema, OutcomeSchema, RevisionSchema,
  SessionExperienceSchema, TagMembershipSchema, TaxonomyNodeSchema, UserPreferenceSchema,
} from "./entities.ts";

export const MemoryExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  namespaces: z.array(z.string()),
  sessions: z.array(SessionExperienceSchema),
  items: z.array(ExperienceItemSchema),
  claims: z.array(ClaimSchema),
  evidence: z.array(EvidenceSchema),
  links: z.array(EvidenceLinkSchema),
  decisions: z.array(DecisionSchema),
  revisions: z.array(RevisionSchema),
  outcomes: z.array(OutcomeSchema),
  preferences: z.array(UserPreferenceSchema),
  taxonomy: z.array(TaxonomyNodeSchema),
  tags: z.array(TagMembershipSchema),
});

export type MemoryExport = z.infer<typeof MemoryExportSchema>;
