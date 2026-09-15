import type {
  ClaimType,
  ConsultationTier,
  EvidenceConfidence,
  EvidenceRelation,
  OutcomeType,
  RecommendationStability,
  RevisionStatus,
  SourceGrade,
} from "./enums.ts";
import type {
  Applicability,
  Decision,
  Evidence,
  ExperienceItem,
  Outcome,
  Revision,
  SourceMeta,
  UserPreference,
} from "./entities.ts";

export type PreparedPreference = {
  readonly key: string;
  readonly value: string;
  readonly sensitive: boolean;
  readonly confirmed?: boolean;
};

export type PreparedClaim = {
  readonly claimType: ClaimType;
  readonly text: string;
  readonly applicability?: Applicability;
  readonly confidence?: EvidenceConfidence;
};

export type PreparedEvidence = {
  readonly claimText: string;
  readonly relation: EvidenceRelation;
  readonly source: SourceMeta;
  readonly excerpt?: string;
  readonly grade: SourceGrade;
  readonly independenceChainId: string;
  readonly note?: string;
};

export type PreparedDecision = {
  readonly conclusion: string;
  readonly assumptions?: readonly string[];
  readonly preferencesUsed?: readonly string[];
  readonly confidence: EvidenceConfidence;
  readonly stability: RecommendationStability;
  readonly changeConditions?: readonly string[];
  readonly reason?: string;
  readonly pendingOutcome?: boolean;
};

export type PreparedItem = {
  readonly topicKey: string;
  readonly title: string;
  readonly oneLineSummary: string;
  readonly applicability?: Applicability;
  readonly claims?: readonly PreparedClaim[];
  readonly evidence?: readonly PreparedEvidence[];
  readonly decision?: PreparedDecision;
  readonly sensitiveFields?: readonly { readonly field: string; readonly label: string; readonly confirmed: boolean }[];
  readonly taxonomyNodeIds?: readonly string[];
};

export type PrepareInput = {
  readonly namespace: string;
  readonly hostSessionId: string;
  readonly title: string;
  readonly items: readonly PreparedItem[];
  readonly preferences?: readonly PreparedPreference[];
  readonly now?: string;
};

export type SessionPreviewItem = {
  readonly topicKey: string;
  readonly title: string;
  readonly oneLineSummary: string;
  readonly claims: number;
  readonly evidence: number;
  readonly hasDecision: boolean;
  readonly sensitiveFields: readonly { readonly field: string; readonly label: string; readonly confirmed: boolean }[];
  readonly taxonomyNodeIds: readonly string[];
};

export type SessionPreview = {
  readonly title: string;
  readonly itemCount: number;
  readonly items: readonly SessionPreviewItem[];
  readonly preferences: readonly { readonly key: string; readonly value: string; readonly sensitive: boolean; readonly confirmed: boolean }[];
};

export type PrepareResult = {
  readonly previewToken: string;
  readonly preview: SessionPreview;
  readonly warnings: readonly string[];
};

export type CommitInput = PrepareInput & { readonly previewToken: string };

export type CommitResult = {
  readonly sessionExperienceId: string;
  readonly created: boolean;
  readonly itemIds: Readonly<Record<string, string>>;
  readonly revisionIds: readonly string[];
  readonly warnings: readonly string[];
};

export type RecallQuery = {
  readonly namespace: string;
  readonly text?: string;
  readonly taxonomyNodeId?: string;
  readonly tier: ConsultationTier;
  readonly includeStatuses?: readonly RevisionStatus[];
  readonly limit?: number;
  readonly expandTop?: number;
  readonly tokenBudget?: number;
  readonly region?: string;
  readonly timeScope?: string;
};

export type RecallCandidateLevel2 = {
  readonly claims: readonly {
    readonly id: string;
    readonly text: string;
    readonly claimType: ClaimType;
    readonly status: RevisionStatus;
  }[];
  readonly currentDecision?: {
    readonly id: string;
    readonly conclusion: string;
    readonly confidence: EvidenceConfidence;
    readonly stability: RecommendationStability;
    readonly pendingOutcome: boolean;
  };
};

export type RecallCandidate = {
  readonly itemId: string;
  readonly title: string;
  readonly oneLineSummary: string;
  readonly status: RevisionStatus;
  readonly updatedAt: string;
  readonly score: number;
  readonly applicability: Applicability;
  readonly taxonomyNodeIds: readonly string[];
  readonly level2?: RecallCandidateLevel2;
};

export type RecallResult = {
  readonly candidates: readonly RecallCandidate[];
  readonly truncated: boolean;
  readonly usedTokens: number;
  readonly memoriesUsedDisclosure: readonly string[];
};

export type ExpandInput = {
  readonly namespace: string;
  readonly itemIds: readonly string[];
  readonly level: 3 | 4;
  readonly tokenBudget?: number;
};

export type ExpandResultItem = {
  readonly itemId: string;
  readonly evidence?: readonly (Evidence & { readonly relation?: EvidenceRelation; readonly claimId?: string })[];
  readonly revisions?: readonly Revision[];
  readonly decisions?: readonly Decision[];
  readonly excerpts?: readonly { readonly evidenceId: string; readonly excerpt: string }[];
};

export type ExpandResult = {
  readonly items: readonly ExpandResultItem[];
  readonly usedTokens: number;
};

export type ManageInput =
  | { readonly action: "retire"; readonly namespace: string; readonly itemId: string }
  | { readonly action: "forget"; readonly namespace: string; readonly itemId: string }
  | { readonly action: "forget_session"; readonly namespace: string; readonly hostSessionId: string }
  | { readonly action: "list_preferences"; readonly namespace: string; readonly includeRetired?: boolean }
  | { readonly action: "upsert_preference"; readonly namespace: string; readonly key: string; readonly value: string; readonly sensitive: boolean; readonly confirmed: boolean }
  | { readonly action: "delete_preference"; readonly namespace: string; readonly key: string }
  | { readonly action: "list_sessions"; readonly namespace: string; readonly limit?: number }
  | { readonly action: "edit_item"; readonly namespace: string; readonly itemId: string; readonly title?: string; readonly oneLineSummary?: string; readonly conclusion?: string; readonly reason?: string }
  | { readonly action: "record_outcome"; readonly namespace: string; readonly itemId: string; readonly decisionId?: string; readonly outcomeType: OutcomeType; readonly note?: string }
  | { readonly action: "stats"; readonly namespace: string };

export type SessionSummary = {
  readonly sessionExperienceId: string;
  readonly hostSessionId: string;
  readonly title: string;
  readonly itemCount: number;
  readonly updatedAt: string;
};

export type ManageResult =
  | { readonly action: "retire" | "forget" | "forget_session" | "delete_preference"; readonly ok: true }
  | { readonly action: "list_preferences"; readonly preferences: readonly UserPreference[] }
  | { readonly action: "upsert_preference"; readonly preference: UserPreference }
  | { readonly action: "list_sessions"; readonly sessions: readonly SessionSummary[] }
  | { readonly action: "edit_item"; readonly item: ExperienceItem; readonly revisedConclusion: boolean }
  | { readonly action: "record_outcome"; readonly outcome: Outcome }
  | { readonly action: "stats"; readonly sessions: number; readonly items: number; readonly claims: number; readonly evidence: number; readonly preferences: number; readonly derivedSummaries: number; readonly embeddings: number };

export interface MemoryStore {
  prepare(input: PrepareInput): Promise<PrepareResult>;
  commit(input: CommitInput): Promise<CommitResult>;
  recall(query: RecallQuery): Promise<RecallResult>;
  expand(input: ExpandInput): Promise<ExpandResult>;
  manage(input: ManageInput): Promise<ManageResult>;
  close(): Promise<void>;
}
