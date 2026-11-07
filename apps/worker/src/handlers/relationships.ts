import type { DbPool } from '@relay/database';
import { persistRelationships, recordAiUsage } from '@relay/database';
import type {
  ServerEnvironment,
  ClaimInput,
  RelationshipInput,
  RelationshipOutput,
  ClaimCategory,
  WorkState,
  EvidenceState,
} from '@relay/contracts';
import { RelationshipOutputSchema, PROMPT_VERSION_RELATIONSHIP } from '@relay/contracts';
import {
  type StructuredAiProvider,
  SYSTEM_INSTRUCTION,
  buildRelationshipPrompt,
  validateRelationships,
} from '@relay/api/ai';
import { checkProjectDailyTokenBudget } from './quota.js';
import { pino } from 'pino';

const logger = pino({ name: 'worker-relationships-handler' });

interface ClaimRow {
  id: string;
  kind: string;
  statement: string;
  work_state: string;
  evidence_state: string;
  owner_label: string | null;
  observed_at: string | null;
}

interface EvidenceRow {
  claim_id: string;
  quote: string;
  source_title: string;
  record_ref: string | null;
}

export async function handleAnalyzeRelationshipsJob(
  pool: DbPool,
  env: ServerEnvironment,
  aiProvider: StructuredAiProvider,
  job: {
    id: string;
    project_id: string;
    requested_by: string;
    payload: Record<string, any>;
    lock_token: string;
  },
  checkCancellation: () => Promise<boolean>
): Promise<{ relationships: number; conflicts: number }> {
  const projectId = job.project_id;
  const requestedBy = job.requested_by;

  if (await checkCancellation()) {
    throw new Error('CANCELLED');
  }

  // 1. Fetch claims for project
  const claimsRes = await pool.query<ClaimRow>(
    `SELECT id, kind, statement, work_state, evidence_state, owner_label, observed_at::text
     FROM public.claims
     WHERE project_id = $1
       AND archived_at IS NULL
     ORDER BY created_at ASC
     LIMIT 200;`,
    [projectId]
  );

  if (claimsRes.rows.length < 2) {
    return { relationships: 0, conflicts: 0 };
  }

  const claimIds = claimsRes.rows.map((c) => c.id);

  // 2. Fetch evidence for these claims
  const evRes = await pool.query<EvidenceRow>(
    `SELECT ce.claim_id, ce.quote, s.title as source_title, sc.record_ref
     FROM public.claim_evidence ce
     JOIN public.source_chunks sc ON sc.id = ce.chunk_id
     JOIN public.sources s ON s.id = sc.source_id
     WHERE ce.project_id = $1
       AND ce.claim_id = ANY($2::uuid[]);`,
    [projectId, claimIds]
  );

  const evidenceByClaim = new Map<
    string,
    Array<{ quote: string; sourceTitle: string; recordRef: string | null }>
  >();
  for (const ev of evRes.rows) {
    const list = evidenceByClaim.get(ev.claim_id) || [];
    list.push({
      quote: ev.quote,
      sourceTitle: ev.source_title,
      recordRef: ev.record_ref,
    });
    evidenceByClaim.set(ev.claim_id, list);
  }

  const claimInputs: ClaimInput[] = claimsRes.rows.map((c) => ({
    claimId: c.id,
    kind: c.kind as ClaimCategory,
    statement: c.statement,
    workState: c.work_state as WorkState,
    evidenceState: c.evidence_state as EvidenceState,
    ownerLabel: c.owner_label,
    observedAt: c.observed_at,
    evidence: evidenceByClaim.get(c.id) || [],
  }));

  const relationshipInput: RelationshipInput = {
    claims: claimInputs,
  };

  const estimatedTokens = Math.ceil(
    claimInputs.reduce((acc, c) => acc + c.statement.length, 0) / 3
  );

  // Quota check
  const quota = await checkProjectDailyTokenBudget(
    pool,
    projectId,
    env.AI_PROJECT_DAILY_TOKEN_BUDGET,
    estimatedTokens
  );
  if (!quota.allowed) {
    throw new Error('QUOTA_EXCEEDED');
  }

  // Current epoch check
  const epochRes = await pool.query<{ access_epoch: string }>(
    `SELECT access_epoch FROM public.projects WHERE id = $1;`,
    [projectId]
  );
  const currentEpoch = parseInt(epochRes.rows[0]?.access_epoch ?? '1', 10);

  const prompt = buildRelationshipPrompt(relationshipInput);
  const requestId = `rel-${job.id}`;
  const modelName =
    env.AI_PROVIDER === 'fake' ? 'fake-deterministic' : env.GEMINI_MODEL || 'gemini-2.5-flash';

  let aiResult;
  try {
    aiResult = await aiProvider.generate<RelationshipOutput>({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: RelationshipOutputSchema,
      validate: (v) => RelationshipOutputSchema.parse(v),
      model: modelName,
      timeoutMs: env.AI_TIMEOUT_MS,
      requestId,
    });
  } catch (err) {
    await recordAiUsage(
      pool,
      requestedBy,
      projectId,
      job.id,
      'analyze_relationships',
      modelName,
      PROMPT_VERSION_RELATIONSHIP,
      estimatedTokens,
      null,
      0,
      'provider_error'
    );
    throw err;
  }

  // Record AI usage
  await recordAiUsage(
    pool,
    requestedBy,
    projectId,
    job.id,
    'analyze_relationships',
    aiResult.model,
    PROMPT_VERSION_RELATIONSHIP,
    aiResult.usage.inputTokens,
    aiResult.usage.outputTokens,
    aiResult.durationMs,
    'ok'
  );

  // Semantic validation
  const suppliedIds = new Set(claimIds);
  const { validRelationships, validConflicts } = validateRelationships(
    aiResult.value.relationships,
    aiResult.value.conflicts,
    suppliedIds
  );

  // Persist relationships
  const persistResult = await persistRelationships(
    pool,
    requestedBy,
    projectId,
    job.id,
    validRelationships,
    validConflicts,
    currentEpoch
  );

  logger.info({ jobId: job.id, ...persistResult }, 'Relationship analysis completed and persisted');

  return persistResult;
}
