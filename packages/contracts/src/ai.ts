import { z } from 'zod';
import { UuidSchema } from './params.js';
import {
  ClaimCategorySchema,
  WorkStateSchema,
  EvidenceStateSchema,
  ReviewStateSchema,
  RelationTypeSchema,
  JobKindSchema,
  JobStatusSchema,
  ClarificationPrioritySchema,
  ClarificationStatusSchema,
  AiUsagePurposeSchema,
  AiUsageOutcomeSchema,
} from './enums.js';

// ─── Versioned Prompts ────────────────────────────────────────────────────────

export const PROMPT_VERSION_EXTRACTION = 'extraction-v1';
export const PROMPT_VERSION_RELATIONSHIP = 'relationship-v1';
export const PROMPT_VERSION_CLARIFICATION = 'clarification-v1';

// ─── Section 15.0 Input Contracts ─────────────────────────────────────────────

export const ChunkInputSchema = z.object({
  chunkId: UuidSchema,
  sourceId: UuidSchema,
  recordRef: z.string().nullable(),
  authorLabel: z.string().nullable(),
  eventAt: z.string().nullable(),
  text: z.string(),
});
export type ChunkInput = z.infer<typeof ChunkInputSchema>;

export const ClaimEvidenceInputSchema = z.object({
  quote: z.string(),
  sourceTitle: z.string(),
  recordRef: z.string().nullable(),
});
export type ClaimEvidenceInput = z.infer<typeof ClaimEvidenceInputSchema>;

export const ClaimInputSchema = z.object({
  claimId: UuidSchema,
  kind: ClaimCategorySchema,
  statement: z.string(),
  workState: WorkStateSchema,
  evidenceState: EvidenceStateSchema,
  ownerLabel: z.string().nullable(),
  observedAt: z.string().nullable(),
  evidence: z.array(ClaimEvidenceInputSchema),
});
export type ClaimInput = z.infer<typeof ClaimInputSchema>;

export const ExtractionInputSchema = z.object({
  projectContext: z.object({
    name: z.string(),
    description: z.string(),
  }),
  chunks: z.array(ChunkInputSchema),
});
export type ExtractionInput = z.infer<typeof ExtractionInputSchema>;

export const RelationshipInputSchema = z.object({
  claims: z.array(ClaimInputSchema),
});
export type RelationshipInput = z.infer<typeof RelationshipInputSchema>;

export const ClarificationInputSchema = z.object({
  claims: z.array(ClaimInputSchema),
  openQuestions: z.array(z.string()),
});
export type ClarificationInput = z.infer<typeof ClarificationInputSchema>;

// ─── Section 15.1 Extraction Output ──────────────────────────────────────────

export const ExtractionOutputEvidenceSchema = z.object({
  chunkId: UuidSchema,
  quote: z.string().min(1).max(2000),
});
export type ExtractionOutputEvidence = z.infer<typeof ExtractionOutputEvidenceSchema>;

export const ExtractionOutputClaimSchema = z.object({
  localId: z.string().min(1).max(80),
  kind: ClaimCategorySchema,
  statement: z.string().min(1).max(4000),
  workState: WorkStateSchema,
  ownerLabel: z.string().max(200).nullable(),
  observedAt: z.string().nullable(),
  evidenceState: EvidenceStateSchema,
  evidence: z.array(ExtractionOutputEvidenceSchema).min(1).max(10),
});
export type ExtractionOutputClaim = z.infer<typeof ExtractionOutputClaimSchema>;

export const ExtractionOutputSchema = z.object({
  claims: z.array(ExtractionOutputClaimSchema).max(100),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutputSchema>;

// ─── Section 15.2 Relationship & Conflict Output ─────────────────────────────

export const RelationshipItemSchema = z.object({
  fromClaimId: UuidSchema,
  toClaimId: UuidSchema,
  relation: RelationTypeSchema,
  explanation: z.string().min(1).max(2000),
});
export type RelationshipItem = z.infer<typeof RelationshipItemSchema>;

export const ConflictItemSchema = z.object({
  claimIds: z.array(UuidSchema).min(2).max(10),
  description: z.string().min(1).max(2000),
  clarificationQuestion: z.string().min(1).max(500),
});
export type ConflictItem = z.infer<typeof ConflictItemSchema>;

export const RelationshipOutputSchema = z.object({
  relationships: z.array(RelationshipItemSchema).max(200),
  conflicts: z.array(ConflictItemSchema).max(50),
});
export type RelationshipOutput = z.infer<typeof RelationshipOutputSchema>;

// ─── Section 15.4 Clarification Output ───────────────────────────────────────

export const ClarificationQuestionItemSchema = z.object({
  question: z.string().min(1).max(500),
  reason: z.string().min(1).max(1000),
  priority: ClarificationPrioritySchema,
  relatedClaimIds: z.array(UuidSchema).min(1).max(10),
});
export type ClarificationQuestionItem = z.infer<typeof ClarificationQuestionItemSchema>;

export const ClarificationOutputSchema = z.object({
  questions: z.array(ClarificationQuestionItemSchema).max(15),
});
export type ClarificationOutput = z.infer<typeof ClarificationOutputSchema>;

// ─── Job Payloads & Details ──────────────────────────────────────────────────

export const EnqueueExtractionInputSchema = z.object({
  sourceId: UuidSchema.optional(),
});
export type EnqueueExtractionInput = z.infer<typeof EnqueueExtractionInputSchema>;

export const EnqueueQuestionGenerationInputSchema = z.object({
  departingUserId: UuidSchema.optional(),
});
export type EnqueueQuestionGenerationInput = z.infer<typeof EnqueueQuestionGenerationInputSchema>;

export const JobSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  requestedBy: UuidSchema,
  kind: JobKindSchema,
  status: JobStatusSchema,
  progress: z.number().int().min(0).max(100),
  attempts: z.number().int().min(0),
  lastErrorCode: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JobSummary = z.infer<typeof JobSummarySchema>;

export const JobDetailSchema = JobSummarySchema.extend({
  payload: z.record(z.unknown()),
  result: z.record(z.unknown()).nullable(),
  cancelRequested: z.boolean(),
  heartbeatAt: z.string().nullable(),
});
export type JobDetail = z.infer<typeof JobDetailSchema>;

// ─── Claims Queries & Mutations ──────────────────────────────────────────────

export const ClaimEvidenceDetailSchema = z.object({
  id: UuidSchema,
  chunkId: UuidSchema,
  sourceId: UuidSchema,
  sourceTitle: z.string(),
  quote: z.string(),
  quoteStart: z.number().int().nonnegative(),
  quoteEnd: z.number().int().positive(),
});
export type ClaimEvidenceDetail = z.infer<typeof ClaimEvidenceDetailSchema>;

export const ClaimRelationshipDetailSchema = z.object({
  id: UuidSchema,
  otherClaimId: UuidSchema,
  otherClaimStatement: z.string(),
  relation: RelationTypeSchema,
  direction: z.enum(['outgoing', 'incoming']),
  explanation: z.string(),
});
export type ClaimRelationshipDetail = z.infer<typeof ClaimRelationshipDetailSchema>;

export const ClaimSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  kind: ClaimCategorySchema,
  statement: z.string(),
  workState: WorkStateSchema,
  evidenceState: EvidenceStateSchema,
  reviewState: ReviewStateSchema,
  ownerUserId: UuidSchema.nullable(),
  ownerLabel: z.string().nullable(),
  ownerDisplayName: z.string().nullable(),
  observedAt: z.string().nullable(),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type ClaimSummary = z.infer<typeof ClaimSummarySchema>;

export const ClaimDetailSchema = ClaimSummarySchema.extend({
  modelName: z.string().nullable(),
  promptVersion: z.string(),
  evidence: z.array(ClaimEvidenceDetailSchema),
  relationships: z.array(ClaimRelationshipDetailSchema),
});
export type ClaimDetail = z.infer<typeof ClaimDetailSchema>;

export const ClaimFilterQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  kind: ClaimCategorySchema.optional(),
  workState: WorkStateSchema.optional(),
  evidenceState: EvidenceStateSchema.optional(),
  reviewState: ReviewStateSchema.optional(),
  search: z.string().optional(),
});
export type ClaimFilterQuery = z.infer<typeof ClaimFilterQuerySchema>;

export const ReviewClaimInputSchema = z.object({
  reviewState: ReviewStateSchema,
});
export type ReviewClaimInput = z.infer<typeof ReviewClaimInputSchema>;

export const SetClaimOwnerInputSchema = z.object({
  userId: UuidSchema.nullable(),
});
export type SetClaimOwnerInput = z.infer<typeof SetClaimOwnerInputSchema>;

export const FlagClaimInputSchema = z.object({
  reason: z.string().min(1).max(1000),
  newEvidenceState: z.enum(['needs_confirmation', 'conflicting']),
});
export type FlagClaimInput = z.infer<typeof FlagClaimInputSchema>;

// ─── Clarification Questions ─────────────────────────────────────────────────

export const ClarificationQuestionSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  createdFor: UuidSchema,
  createdForDisplayName: z.string().nullable(),
  question: z.string(),
  reason: z.string(),
  priority: ClarificationPrioritySchema,
  status: ClarificationStatusSchema,
  answerSourceId: UuidSchema.nullable(),
  answeredBy: UuidSchema.nullable(),
  answeredByDisplayName: z.string().nullable(),
  answeredAt: z.string().nullable(),
  relatedClaims: z.array(
    z.object({
      id: UuidSchema,
      statement: z.string(),
      kind: ClaimCategorySchema,
    })
  ),
  createdAt: z.string(),
});
export type ClarificationQuestionSummary = z.infer<typeof ClarificationQuestionSummarySchema>;

export const ClarificationQuestionFilterQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  status: ClarificationStatusSchema.optional(),
  priority: ClarificationPrioritySchema.optional(),
});
export type ClarificationQuestionFilterQuery = z.infer<
  typeof ClarificationQuestionFilterQuerySchema
>;

export const AnswerQuestionInputSchema = z.object({
  answer: z.string().min(1).max(100000),
  visibility: z.enum(['project', 'restricted']).default('restricted'),
});
export type AnswerQuestionInput = z.infer<typeof AnswerQuestionInputSchema>;

// ─── AI Usage ────────────────────────────────────────────────────────────────

export const AiUsageSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  userId: UuidSchema,
  jobId: UuidSchema.nullable(),
  purpose: AiUsagePurposeSchema,
  modelName: z.string(),
  promptVersion: z.string(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  latencyMs: z.number().int().nonnegative(),
  outcome: AiUsageOutcomeSchema,
  createdAt: z.string(),
});
export type AiUsageSummary = z.infer<typeof AiUsageSummarySchema>;
