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
};

for (const [name, schema] of Object.entries(targetSchemas)) {
  const jsonSchema = zodToJsonSchema(schema, name);
  const filePath = path.join(schemasDir, `${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(jsonSchema, null, 2) + '\n', 'utf8');
}

console.log(
  `Generated ${Object.keys(targetSchemas).length} JSON schemas in packages/contracts/schemas.`
);
