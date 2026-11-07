import { z } from 'zod';

export const ClaimCategorySchema = z.enum([
  'decision',
  'proposal',
  'task',
  'blocker',
  'risk',
  'dependency',
  'responsibility',
  'contact',
  'open_question',
]);
export type ClaimCategory = z.infer<typeof ClaimCategorySchema>;

export const WorkStateSchema = z.enum([
  'proposed',
  'open',
  'in_progress',
  'blocked',
  'completed',
  'cancelled',
  'superseded',
  'unknown',
]);
export type WorkState = z.infer<typeof WorkStateSchema>;

export const EvidenceStateSchema = z.enum([
  'supported',
  'corroborated',
  'needs_confirmation',
  'conflicting',
  'unknown',
]);
export type EvidenceState = z.infer<typeof EvidenceStateSchema>;

export const ReviewStateSchema = z.enum(['pending', 'approved', 'rejected']);
export type ReviewState = z.infer<typeof ReviewStateSchema>;

export const OrganisationRoleSchema = z.enum(['owner', 'admin', 'member']);
export type OrganisationRole = z.infer<typeof OrganisationRoleSchema>;

export const ProjectRoleSchema = z.enum(['owner', 'reviewer', 'contributor', 'recipient']);
export type ProjectRole = z.infer<typeof ProjectRoleSchema>;

export const ProjectDomainSchema = z.enum([
  'software_engineering',
  'research',
  'student_team',
  'nonprofit_operations',
  'business_operations',
  'general',
]);
export type ProjectDomain = z.infer<typeof ProjectDomainSchema>;

export const HandoverSectionKeySchema = z.enum([
  'snapshot',
  'decisions',
  'work_in_progress',
  'owners_contacts',
  'risks_dependencies',
  'open_questions',
  'next_actions',
]);
export type HandoverSectionKey = z.infer<typeof HandoverSectionKeySchema>;

export const HandoverDetailLevelSchema = z.enum(['concise', 'standard', 'detailed']);
export type HandoverDetailLevel = z.infer<typeof HandoverDetailLevelSchema>;

export const HandoverToneSchema = z.enum(['professional', 'plain_language']);
export type HandoverTone = z.infer<typeof HandoverToneSchema>;

export const HandoverItemKindSchema = z.enum(['fact', 'suggestion', 'unknown']);
export type HandoverItemKind = z.infer<typeof HandoverItemKindSchema>;

export const SourceTypeSchema = z.enum(['text', 'markdown', 'json_messages', 'json_issues']);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export const AccessModeSchema = z.enum(['project', 'restricted']);
export type AccessMode = z.infer<typeof AccessModeSchema>;

export const AiProviderSchema = z.enum(['gemini', 'fake']);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const RelationTypeSchema = z.enum(['depends_on', 'supersedes', 'contradicts', 'related_to']);
export type RelationType = z.infer<typeof RelationTypeSchema>;

export const JobKindSchema = z.enum([
  'extract',
  'analyze_relationships',
  'generate_questions',
  'generate_handover',
]);
export type JobKind = z.infer<typeof JobKindSchema>;

export const JobStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const ClarificationPrioritySchema = z.enum(['high', 'medium', 'low']);
export type ClarificationPriority = z.infer<typeof ClarificationPrioritySchema>;

export const ClarificationStatusSchema = z.enum(['open', 'answered', 'dismissed']);
export type ClarificationStatus = z.infer<typeof ClarificationStatusSchema>;

export const AiUsagePurposeSchema = z.enum([
  'extract',
  'analyze_relationships',
  'generate_questions',
  'generate_handover',
  'answer',
  'schema_repair',
]);
export type AiUsagePurpose = z.infer<typeof AiUsagePurposeSchema>;

export const AiUsageOutcomeSchema = z.enum([
  'ok',
  'validation_failed',
  'timeout',
  'provider_error',
  'cancelled',
]);
export type AiUsageOutcome = z.infer<typeof AiUsageOutcomeSchema>;

export const HandoverStatusSchema = z.enum(['draft', 'approved', 'shared', 'stale', 'superseded']);
export type HandoverStatus = z.infer<typeof HandoverStatusSchema>;

export const ReviewActionSchema = z.enum([
  'approve_item',
  'reject_item',
  'edit_item',
  'comment',
  'flag',
  'add_context',
  'create_version',
  'approve_version',
  'share',
]);
export type ReviewAction = z.infer<typeof ReviewActionSchema>;
