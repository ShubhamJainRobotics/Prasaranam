import { z } from 'zod';
import { UuidSchema } from './params.js';
import {
  HandoverSectionKeySchema,
  HandoverDetailLevelSchema,
  HandoverToneSchema,
  HandoverItemKindSchema,
  HandoverStatusSchema,
  ReviewActionSchema,
  EvidenceStateSchema,
  ReviewStateSchema,
} from './enums.js';

// ─── Handover Configuration Schema ───────────────────────────────────────────

export const HandoverConfigurationSchema = z.object({
  title: z.string().min(1).max(200),
  recipientId: UuidSchema,
  departingUserId: UuidSchema.optional().nullable(),
  dateRange: z
    .object({
      from: z.string().optional().nullable(),
      to: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  includedSections: z.array(HandoverSectionKeySchema).min(1).max(7),
  detailLevel: HandoverDetailLevelSchema,
  priorityFocus: z.string().max(1000).optional().nullable(),
  includeCompletedWork: z.boolean(),
  includeProposedNextActions: z.boolean(),
  tone: HandoverToneSchema,
});
export type HandoverConfiguration = z.infer<typeof HandoverConfigurationSchema>;

export const CreateHandoverInputSchema = HandoverConfigurationSchema;
export type CreateHandoverInput = z.infer<typeof CreateHandoverInputSchema>;

// ─── Item Modification Schemas ───────────────────────────────────────────────

export const UpdateHandoverItemSchema = z.object({
  reviewState: ReviewStateSchema.optional(),
  text: z.string().min(1).max(4000).optional(),
  comment: z.string().max(4000).optional(),
});
export type UpdateHandoverItem = z.infer<typeof UpdateHandoverItemSchema>;

export const AddItemFromClaimsSchema = z.object({
  section: HandoverSectionKeySchema,
  ordinal: z.number().int().nonnegative().optional(),
  text: z.string().min(1).max(4000),
  itemKind: HandoverItemKindSchema,
  claimIds: z.array(UuidSchema),
});
export type AddItemFromClaims = z.infer<typeof AddItemFromClaimsSchema>;

export const AttachClaimsSchema = z.object({
  claimIds: z.array(UuidSchema).min(1),
});
export type AttachClaims = z.infer<typeof AttachClaimsSchema>;

export const FlagHandoverItemSchema = z.object({
  reason: z.string().min(1).max(200),
  comment: z.string().max(4000).optional(),
});
export type FlagHandoverItem = z.infer<typeof FlagHandoverItemSchema>;

export const AddReviewerContextSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(100000),
  format: z.enum(['text', 'markdown']),
  visibility: z.enum(['project', 'restricted']),
  grantUserIds: z.array(UuidSchema).optional(),
});
export type AddReviewerContext = z.infer<typeof AddReviewerContextSchema>;

export const ApproveHandoverSchema = z.object({
  confirmReviewedForRecipient: z.boolean(),
  comment: z.string().max(4000).optional(),
});
export type ApproveHandover = z.infer<typeof ApproveHandoverSchema>;

// ─── Query & Summary Schemas ─────────────────────────────────────────────────

export const HandoverItemClaimCitationSchema = z.object({
  claimId: UuidSchema,
  statement: z.string(),
  evidenceState: EvidenceStateSchema,
  quote: z.string().optional(),
  sourceTitle: z.string().optional(),
  chunkId: UuidSchema.optional(),
  quoteStart: z.number().int().nonnegative().optional(),
  quoteEnd: z.number().int().positive().optional(),
});
export type HandoverItemClaimCitation = z.infer<typeof HandoverItemClaimCitationSchema>;

export const HandoverItemSchema = z.object({
  id: UuidSchema,
  handoverId: UuidSchema,
  projectId: UuidSchema,
  section: HandoverSectionKeySchema,
  ordinal: z.number().int(),
  text: z.string(),
  itemKind: HandoverItemKindSchema,
  evidenceState: EvidenceStateSchema,
  reviewState: ReviewStateSchema,
  originalText: z.string().nullable(),
  editedBy: UuidSchema.nullable(),
  editedAt: z.string().nullable(),
  rowVersion: z.number().int(),
  claimIds: z.array(UuidSchema),
  citations: z.array(HandoverItemClaimCitationSchema).optional(),
});
export type HandoverItem = z.infer<typeof HandoverItemSchema>;

export const HandoverSummarySchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  rootId: UuidSchema,
  version: z.number().int(),
  title: z.string(),
  recipientId: UuidSchema,
  recipientName: z.string().optional(),
  departingUserId: UuidSchema.nullable(),
  departingUserName: z.string().nullable().optional(),
  createdBy: UuidSchema,
  status: HandoverStatusSchema,
  generatedAccessEpoch: z.union([z.string(), z.number()]),
  approvedAccessEpoch: z.union([z.string(), z.number()]).nullable(),
  approvedBy: UuidSchema.nullable(),
  approvedAt: z.string().nullable(),
  sharedAt: z.string().nullable(),
  sharedBy: UuidSchema.nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  itemCount: z.number().int().optional(),
  // Hackathon addition: acknowledgement timestamp (null if recipient has not yet acknowledged)
  acknowledgedAt: z.string().nullable().optional(),
});
export type HandoverSummary = z.infer<typeof HandoverSummarySchema>;

export const HandoverDetailSchema = HandoverSummarySchema.extend({
  configuration: HandoverConfigurationSchema,
  items: z.array(HandoverItemSchema),
  isStale: z.boolean().optional(),
  reasonCode: z.string().optional(),
});
export type HandoverDetail = z.infer<typeof HandoverDetailSchema>;

export const ReviewRecordSchema = z.object({
  id: UuidSchema,
  handoverId: UuidSchema,
  itemId: UuidSchema.nullable(),
  reviewerId: UuidSchema,
  reviewerName: z.string().optional(),
  action: ReviewActionSchema,
  comment: z.string().nullable(),
  confirmedReviewedForRecipient: z.boolean(),
  createdAt: z.string(),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

// ─── AI Input/Output Schemas (SPEC Section 15.3) ─────────────────────────────

export const HandoverOutputItemSchema = z.object({
  localId: z.string().min(1).max(80),
  text: z.string().min(1).max(4000),
  itemKind: HandoverItemKindSchema,
  evidenceState: EvidenceStateSchema,
  claimIds: z.array(UuidSchema).max(20),
});
export type HandoverOutputItem = z.infer<typeof HandoverOutputItemSchema>;

export const HandoverOutputSectionSchema = z.object({
  key: HandoverSectionKeySchema,
  items: z.array(HandoverOutputItemSchema).max(30),
});
export type HandoverOutputSection = z.infer<typeof HandoverOutputSectionSchema>;

export const HandoverOutputSchema = z.object({
  title: z.string().min(1).max(200),
  sections: z.array(HandoverOutputSectionSchema).max(7),
});
export type HandoverOutput = z.infer<typeof HandoverOutputSchema>;

export const HandoverInputSchema = z.object({
  project: z.object({
    id: UuidSchema,
    name: z.string(),
    description: z.string().optional(),
  }),
  recipient: z.object({
    id: UuidSchema,
    displayName: z.string(),
    role: z.string(),
  }),
  departingMember: z
    .object({
      id: UuidSchema,
      displayName: z.string(),
    })
    .optional(),
  configuration: HandoverConfigurationSchema,
  claims: z.array(
    z.object({
      id: UuidSchema,
      statement: z.string(),
      claimType: z.string(),
      evidenceState: EvidenceStateSchema,
      workState: z.string(),
      observedAt: z.string().nullable(),
      ownerLabel: z.string().nullable(),
      sourceTitles: z.array(z.string()),
      chunkQuotes: z.array(z.string()),
    })
  ),
});
export type HandoverInput = z.infer<typeof HandoverInputSchema>;

// ─── Export Query Schema ─────────────────────────────────────────────────────

export const ExportHandoverQuerySchema = z.object({
  format: z.enum(['md', 'pdf']),
});
export type ExportHandoverQuery = z.infer<typeof ExportHandoverQuerySchema>;

// ─── Acknowledgement (Hackathon Addition) ─────────────────────────────────────

export const AcknowledgeHandoverResponseSchema = z.object({
  id: UuidSchema,
  handoverId: UuidSchema,
  userId: UuidSchema,
  acknowledgedAt: z.string(),
});
export type AcknowledgeHandoverResponse = z.infer<typeof AcknowledgeHandoverResponseSchema>;
