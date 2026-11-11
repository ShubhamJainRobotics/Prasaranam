import { z } from 'zod';

export const SourceKindSchema = z.enum([
  'text',
  'markdown',
  'messages',
  'issues',
  'reviewer_context',
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const SourceVisibilitySchema = z.enum(['project', 'restricted']);
export type SourceVisibility = z.infer<typeof SourceVisibilitySchema>;

export const SourceProcessingStatusSchema = z.enum(['pending', 'processing', 'ready', 'failed']);
export type SourceProcessingStatus = z.infer<typeof SourceProcessingStatusSchema>;

// Strict HTTP/HTTPS URL schema (max 2048 characters)
export const SafeUrlSchema = z
  .string()
  .max(2048, 'URL must not exceed 2048 characters')
  .refine(
    (val) => {
      try {
        const u = new URL(val);
        return u.protocol === 'http:' || u.protocol === 'https:';
      } catch {
        return false;
      }
    },
    { message: 'URL must use http or https protocol' }
  );

// Strict ISO-8601 timestamp with Z or explicit offset
const ISO8601_OFFSET_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export const StrictIsoTimestampSchema = z
  .string()
  .regex(ISO8601_OFFSET_REGEX, 'Timestamp must be ISO-8601 with Z or explicit timezone offset')
  .refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid calendar date' });

// Record schemas
export const MessageRecordSchema = z
  .object({
    id: z
      .string()
      .min(1, 'Record ID cannot be empty')
      .max(200, 'Record ID must be at most 200 characters'),
    text: z
      .string()
      .min(1, 'Record text cannot be empty')
      .max(100000, 'Record text must not exceed 100,000 characters'),
    author: z.string().max(200).nullable().default(null),
    timestamp: StrictIsoTimestampSchema.nullable().default(null),
    url: SafeUrlSchema.nullable().default(null),
  })
  .strict();
export type MessageRecord = z.infer<typeof MessageRecordSchema>;

export const MessagesEnvelopeSchema = z
  .object({
    format: z.literal('relay.messages.v1'),
    records: z
      .array(MessageRecordSchema)
      .min(1, 'Records array must not be empty')
      .max(10000, 'File cannot contain more than 10,000 records')
      .refine(
        (records) => {
          const ids = new Set<string>();
          for (const r of records) {
            if (ids.has(r.id)) return false;
            ids.add(r.id);
          }
          return true;
        },
        { message: 'Record IDs must be unique within file' }
      ),
  })
  .strict();
export type MessagesEnvelope = z.infer<typeof MessagesEnvelopeSchema>;

export const IssueRecordSchema = z
  .object({
    id: z
      .string()
      .min(1, 'Record ID cannot be empty')
      .max(200, 'Record ID must be at most 200 characters'),
    title: z
      .string()
      .min(1, 'Title cannot be empty')
      .max(1000, 'Title must not exceed 1000 characters'),
    description: z
      .string()
      .max(100000, 'Description must not exceed 100,000 characters')
      .default(''),
    status: z.string().min(1, 'Status cannot be empty').max(100),
    assignee: z.string().max(200).nullable().default(null),
    updatedAt: StrictIsoTimestampSchema.nullable().default(null),
    url: SafeUrlSchema.nullable().default(null),
  })
  .strict();
export type IssueRecord = z.infer<typeof IssueRecordSchema>;

export const IssuesEnvelopeSchema = z
  .object({
    format: z.literal('relay.issues.v1'),
    records: z
      .array(IssueRecordSchema)
      .min(1, 'Records array must not be empty')
      .max(10000, 'File cannot contain more than 10,000 records')
      .refine(
        (records) => {
          const ids = new Set<string>();
          for (const r of records) {
            if (ids.has(r.id)) return false;
            ids.add(r.id);
          }
          return true;
        },
        { message: 'Record IDs must be unique within file' }
      ),
  })
  .strict();
export type IssuesEnvelope = z.infer<typeof IssuesEnvelopeSchema>;

// Input schemas for paste and uploads
export const PasteSourceInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    kind: z.enum(['text', 'markdown']),
    content: z.string().min(1).max(5242880, 'Pasted content cannot exceed 5 MiB'),
    visibility: SourceVisibilitySchema.default('project'),
    grantUserIds: z.array(z.string().uuid()).default([]),
    originalUrl: SafeUrlSchema.optional(),
    authorLabel: z.string().max(200).optional(),
    eventAt: StrictIsoTimestampSchema.optional(),
    replacesSourceId: z.string().uuid().optional(),
    allowDuplicate: z.boolean().optional(),
  })
  .strict();
export type PasteSourceInput = z.infer<typeof PasteSourceInputSchema>;

export const DuplicateSourceErrorDetailsSchema = z.object({
  existingSourceId: z.string().uuid(),
  existingSourceTitle: z.string(),
});
export type DuplicateSourceErrorDetails = z.infer<typeof DuplicateSourceErrorDetailsSchema>;

export const SetSourceAccessSchema = z
  .object({
    visibility: SourceVisibilitySchema,
    grantUserIds: z.array(z.string().uuid()).default([]),
  })
  .strict();
export type SetSourceAccessInput = z.infer<typeof SetSourceAccessSchema>;

// Chunk and Source summary/detail schemas
export const SourceChunkSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  projectId: z.string().uuid(),
  ordinal: z.number().int().nonnegative(),
  recordRef: z.string().nullable(),
  authorLabel: z.string().nullable(),
  eventAt: z.string().nullable(),
  originalUrl: z.string().nullable(),
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().positive(),
  content: z.string(),
});
export type SourceChunk = z.infer<typeof SourceChunkSchema>;

export const SourceSummarySchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string(),
  kind: SourceKindSchema,
  visibility: SourceVisibilitySchema,
  originalUrl: z.string().nullable(),
  authorLabel: z.string().nullable(),
  eventAt: z.string().nullable(),
  contentSha256: z.string(),
  revision: z.number().int(),
  lineageId: z.string().uuid(),
  processingStatus: SourceProcessingStatusSchema,
  processingErrorCode: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdBy: z.string().uuid(),
  createdAt: z.string(),
  chunkCount: z.number().int().nonnegative().optional(),
});
export type SourceSummary = z.infer<typeof SourceSummarySchema>;

export const SourceDetailSchema = SourceSummarySchema.extend({
  content: z.string(),
  chunks: z.array(SourceChunkSchema).optional(),
  grants: z.array(z.string().uuid()).optional(),
});
export type SourceDetail = z.infer<typeof SourceDetailSchema>;
