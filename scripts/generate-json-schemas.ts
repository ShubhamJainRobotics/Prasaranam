import fs from 'node:fs';
import path from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import * as contracts from '@relay/contracts';

const schemasDir = path.resolve(process.cwd(), 'packages/contracts/schemas');
fs.mkdirSync(schemasDir, { recursive: true });

const targetSchemas: Record<string, any> = {
  ClaimCategory: contracts.ClaimCategorySchema,
  WorkState: contracts.WorkStateSchema,
  EvidenceState: contracts.EvidenceStateSchema,
  ReviewState: contracts.ReviewStateSchema,
  OrganisationRole: contracts.OrganisationRoleSchema,
  ProjectRole: contracts.ProjectRoleSchema,
  ProjectDomain: contracts.ProjectDomainSchema,
  HandoverSectionKey: contracts.HandoverSectionKeySchema,
  HandoverDetailLevel: contracts.HandoverDetailLevelSchema,
  HandoverTone: contracts.HandoverToneSchema,
  HandoverItemKind: contracts.HandoverItemKindSchema,
  SourceType: contracts.SourceTypeSchema,
  AccessMode: contracts.AccessModeSchema,
  AiProvider: contracts.AiProviderSchema,
  ErrorCode: contracts.ErrorCodeSchema,
  ErrorEnvelope: contracts.ErrorEnvelopeSchema,
  ErrorBody: contracts.ErrorBodySchema,
  PageInfo: contracts.PageInfoSchema,
  Uuid: contracts.UuidSchema,
  PaginationQuery: contracts.PaginationQuerySchema,
  ServerEnvironment: contracts.serverEnvironmentSchema,
  WebEnvironment: contracts.webEnvironmentSchema,
  RegisterInput: contracts.registerSchema,
  LoginInput: contracts.loginSchema,
  ForgotPasswordInput: contracts.forgotPasswordSchema,
  ResetPasswordInput: contracts.resetPasswordSchema,
  UpdateProfileInput: contracts.updateProfileSchema,
  CreateOrgInput: contracts.createOrgSchema,
  AddOrgMemberInput: contracts.addOrgMemberSchema,
  UpdateOrgMemberInput: contracts.updateOrgMemberSchema,
  CreateProjectInput: contracts.createProjectSchema,
  UpdateProjectInput: contracts.updateProjectSchema,
  AddProjectMemberInput: contracts.addProjectMemberSchema,
  UpdateProjectMemberInput: contracts.updateProjectMemberSchema,
  SourceKind: contracts.SourceKindSchema,
  SourceVisibility: contracts.SourceVisibilitySchema,
  SourceProcessingStatus: contracts.SourceProcessingStatusSchema,
  MessageRecord: contracts.MessageRecordSchema,
  MessagesEnvelope: contracts.MessagesEnvelopeSchema,
  IssueRecord: contracts.IssueRecordSchema,
  IssuesEnvelope: contracts.IssuesEnvelopeSchema,
  PasteSourceInput: contracts.PasteSourceInputSchema,
  SetSourceAccess: contracts.SetSourceAccessSchema,
  SourceChunk: contracts.SourceChunkSchema,
  SourceSummary: contracts.SourceSummarySchema,
  SourceDetail: contracts.SourceDetailSchema,
  ChunkInput: contracts.ChunkInputSchema,
  ClaimInput: contracts.ClaimInputSchema,
  ExtractionInput: contracts.ExtractionInputSchema,
  ExtractionOutput: contracts.ExtractionOutputSchema,
  RelationshipInput: contracts.RelationshipInputSchema,
  RelationshipOutput: contracts.RelationshipOutputSchema,
  ClarificationInput: contracts.ClarificationInputSchema,
  ClarificationOutput: contracts.ClarificationOutputSchema,
  JobSummary: contracts.JobSummarySchema,
  JobDetail: contracts.JobDetailSchema,
  ClaimSummary: contracts.ClaimSummarySchema,
  ClaimDetail: contracts.ClaimDetailSchema,
  ClarificationQuestionSummary: contracts.ClarificationQuestionSummarySchema,
  AiUsageSummary: contracts.AiUsageSummarySchema,
  HandoverStatus: contracts.HandoverStatusSchema,
  ReviewAction: contracts.ReviewActionSchema,
  HandoverConfiguration: contracts.HandoverConfigurationSchema,
  CreateHandoverInput: contracts.CreateHandoverInputSchema,
  UpdateHandoverItem: contracts.UpdateHandoverItemSchema,
  AddItemFromClaims: contracts.AddItemFromClaimsSchema,
  AttachClaims: contracts.AttachClaimsSchema,
  FlagHandoverItem: contracts.FlagHandoverItemSchema,
  AddReviewerContext: contracts.AddReviewerContextSchema,
  ApproveHandover: contracts.ApproveHandoverSchema,
  HandoverItem: contracts.HandoverItemSchema,
  HandoverSummary: contracts.HandoverSummarySchema,
  HandoverDetail: contracts.HandoverDetailSchema,
  ReviewRecord: contracts.ReviewRecordSchema,
  HandoverInput: contracts.HandoverInputSchema,
  HandoverOutput: contracts.HandoverOutputSchema,
};

for (const [name, schema] of Object.entries(targetSchemas)) {
  const jsonSchema = zodToJsonSchema(schema, name);
  const filePath = path.join(schemasDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
}

console.log(
  `Generated ${Object.keys(targetSchemas).length} JSON schemas in packages/contracts/schemas.`
);
