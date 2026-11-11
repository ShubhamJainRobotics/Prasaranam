import { scenario1Onboarding } from './scenario-1-onboarding.js';
import { scenario2Importing } from './scenario-2-importing.js';
import { scenario3AccessControl } from './scenario-3-access-control.js';
import { scenario4KnowledgeExtraction } from './scenario-4-knowledge-extraction.js';
import { scenario5Clarification } from './scenario-5-clarification.js';
import { scenario6HandoverLifecycle } from './scenario-6-handover-lifecycle.js';
import { scenario7QuestionsExport } from './scenario-7-questions-export.js';
import { scenario8RevocationStaleness } from './scenario-8-revocation-staleness.js';
import { scenario9Hardening } from './scenario-9-hardening.js';
import type { ScenarioDefinition } from './types.js';

export * from './types.js';
export * from './context.js';
export * from './scenario-1-onboarding.js';
export * from './scenario-2-importing.js';
export * from './scenario-3-access-control.js';
export * from './scenario-4-knowledge-extraction.js';
export * from './scenario-5-clarification.js';
export * from './scenario-6-handover-lifecycle.js';
export * from './scenario-7-questions-export.js';
export * from './scenario-8-revocation-staleness.js';
export * from './scenario-9-hardening.js';

export const allScenarios: ScenarioDefinition[] = [
  scenario1Onboarding,
  scenario2Importing,
  scenario3AccessControl,
  scenario4KnowledgeExtraction,
  scenario5Clarification,
  scenario6HandoverLifecycle,
  scenario7QuestionsExport,
  scenario8RevocationStaleness,
  scenario9Hardening,
];
