import type { DbPool } from '@relay/database';
import { persistQuestions, recordAiUsage } from '@relay/database';
import type {
  ServerEnvironment,
  ClaimInput,
  ClarificationInput,
  ClarificationOutput,
  ClaimCategory,
  WorkState,
  EvidenceState,
} from '@relay/contracts';
import { ClarificationOutputSchema, PROMPT_VERSION_CLARIFICATION } from '@relay/contracts';
import {
  type StructuredAiProvider,
  SYSTEM_INSTRUCTION,
  buildClarificationPrompt,
} from '@relay/api/ai';
import { checkProjectDailyTokenBudget } from './quota.js';
import { pino } from 'pino';

const logger = pino({ name: 'worker-questions-handler' });

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

export async function handleGenerateQuestionsJob(
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
): Promise<{ questions: number }> {
  const projectId = job.project_id;
  const requestedBy = job.requested_by;
  const departingUserId = job.payload?.departingUserId as string | undefined;

  if (await checkCancellation()) {
    throw new Error('CANCELLED');
  }

  // Determine created_for per Section 2A.8 item 4
  const createdFor = departingUserId || requestedBy;

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

  const claimIds = claimsRes.rows.map((c) => c.id);

  // 2. Fetch evidence for claims
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

  // 3. Fetch existing open questions for de-duplication in prompt
  const openQuestionsRes = await pool.query<{ question: string }>(
    `SELECT question FROM public.clarification_questions WHERE project_id = $1 AND status = 'open';`,
    [projectId]
  );
  const openQuestionTexts = openQuestionsRes.rows.map((q) => q.question);

  const clarificationInput: ClarificationInput = {
    claims: claimInputs,
    openQuestions: openQuestionTexts,
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

  const prompt = buildClarificationPrompt(clarificationInput);
  const requestId = `quest-${job.id}`;
  const modelName =
    env.AI_PROVIDER === 'fake' ? 'fake-deterministic' : env.GEMINI_MODEL || 'gemini-2.5-flash';

  let aiResult;
  try {
    aiResult = await aiProvider.generate<ClarificationOutput>({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: ClarificationOutputSchema,
      validate: (v) => ClarificationOutputSchema.parse(v),
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
      'generate_questions',
      modelName,
      PROMPT_VERSION_CLARIFICATION,
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
    'generate_questions',
    aiResult.model,
    PROMPT_VERSION_CLARIFICATION,
    aiResult.usage.inputTokens,
    aiResult.usage.outputTokens,
    aiResult.durationMs,
    'ok'
  );

  // Filter questions: relatedClaimIds must belong to supplied claims
  const suppliedIds = new Set(claimIds);
  const validQuestions = aiResult.value.questions.map((q) => ({
    ...q,
    relatedClaimIds: q.relatedClaimIds.filter((cid) => suppliedIds.has(cid)),
  }));

  // Persist questions
  const persistResult = await persistQuestions(
    pool,
    requestedBy,
    projectId,
    job.id,
    validQuestions,
    createdFor,
    currentEpoch
  );

  logger.info(
    { jobId: job.id, inserted: persistResult.inserted },
    'Clarification questions generated and persisted'
  );

  return { questions: persistResult.inserted };
}
