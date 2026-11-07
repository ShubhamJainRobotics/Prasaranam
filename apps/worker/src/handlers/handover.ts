import type { DbPool } from '@relay/database';
import { createHandoverDraftFromGeneration, recordAiUsage, type LeasedJob } from '@relay/database';
import type { ServerEnvironment, HandoverConfiguration } from '@relay/contracts';
import {
  type StructuredAiProvider,
  SYSTEM_INSTRUCTION,
  PROMPT_VERSION_HANDOVER,
  buildHandoverPrompt,
  validateHandoverOutput,
} from '@relay/api/ai';
import { HandoverOutputSchema, type HandoverInput, type HandoverOutput } from '@relay/contracts';
import { checkProjectDailyTokenBudget } from './quota.js';
import { pino } from 'pino';

const logger = pino({ name: 'worker-handover-handler' });

export async function handleGenerateHandoverJob(
  pool: DbPool,
  env: ServerEnvironment,
  aiProvider: StructuredAiProvider,
  job: LeasedJob,
  checkCancellation: () => Promise<boolean>
): Promise<Record<string, unknown>> {
  const config = job.payload as HandoverConfiguration;
  const projectId = job.project_id;
  const reviewerId = job.requested_by;
  const recipientId = config.recipientId;

  // 1. Quota check
  const estimatedInputTokens = 2000;
  const budgetCheck = await checkProjectDailyTokenBudget(
    pool,
    projectId,
    env.AI_PROJECT_DAILY_TOKEN_BUDGET,
    estimatedInputTokens
  );
  if (!budgetCheck.allowed) {
    throw new Error('QUOTA_EXCEEDED');
  }

  // 2. Cancellation check
  if (await checkCancellation()) {
    throw new Error('CANCELLED');
  }

  // 3. Fetch project details and current epoch
  const projRes = await pool.query(
    'SELECT name, description, access_epoch FROM public.projects WHERE id = $1',
    [projectId]
  );
  if (projRes.rows.length === 0) {
    throw new Error('PROJECT_NOT_FOUND');
  }
  const project = projRes.rows[0];
  const currentEpoch = project.access_epoch;

  // 4. Fetch recipient info
  const recipRes = await pool.query(
    `SELECT pr.display_name, pm.role
     FROM public.project_members pm
     JOIN public.profiles pr ON pr.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.active = true`,
    [projectId, recipientId]
  );
  if (recipRes.rows.length === 0) {
    throw new Error('RECIPIENT_NOT_ACTIVE_MEMBER');
  }
  const recipient = recipRes.rows[0];

  // 5. Fetch departing member if provided
  let departingMember: { id: string; displayName: string } | undefined;
  if (config.departingUserId) {
    const depRes = await pool.query(
      `SELECT pr.display_name
       FROM public.project_members pm
       JOIN public.profiles pr ON pr.id = pm.user_id
       WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.active = true`,
      [projectId, config.departingUserId]
    );
    if (depRes.rows.length > 0) {
      departingMember = {
        id: config.departingUserId,
        displayName: depRes.rows[0].display_name,
      };
    }
  }

  // 6. Query claims readable by BOTH reviewer AND recipient (SPEC Section 2A.4)
  const claimsRes = await pool.query(
    `SELECT
       c.id,
       c.kind as "claimType",
       c.statement,
       c.work_state as "workState",
       c.evidence_state as "evidenceState",
       c.owner_label as "ownerLabel",
       c.observed_at as "observedAt",
       coalesce(array_agg(distinct s.title) filter (where s.title is not null), '{}') as "sourceTitles",
       coalesce(array_agg(distinct ce.quote) filter (where ce.quote is not null), '{}') as "chunkQuotes"
     FROM public.claims c
     JOIN public.claim_evidence ce on ce.claim_id = c.id
     JOIN public.source_chunks sc on sc.id = ce.chunk_id
     JOIN public.sources s on s.id = sc.source_id
     WHERE c.project_id = $1
       AND app_private.can_read_claim(c.id, $2) = true
       AND app_private.can_read_claim(c.id, $3) = true
       AND c.review_state <> 'rejected'
     GROUP BY c.id
     ORDER BY c.created_at ASC`,
    [projectId, reviewerId, recipientId]
  );

  let candidateClaims = claimsRes.rows;

  // Filter out completed work if includeCompletedWork is false
  if (!config.includeCompletedWork) {
    candidateClaims = candidateClaims.filter(
      (c) => !['completed', 'cancelled', 'superseded'].includes(c.workState)
    );
  }

  // Filter date range if specified (null observedAt claims are included as "undated" per Section 2A.13)
  if (config.dateRange?.from || config.dateRange?.to) {
    candidateClaims = candidateClaims.filter((c) => {
      if (!c.observedAt) return true;
      if (config.dateRange?.from && c.observedAt < config.dateRange.from) return false;
      if (config.dateRange?.to && c.observedAt > config.dateRange.to) return false;
      return true;
    });
  }

  // 7. Format input context
  const handoverInput: HandoverInput = {
    project: {
      id: projectId,
      name: project.name,
      description: project.description || undefined,
    },
    recipient: {
      id: recipientId,
      displayName: recipient.display_name,
      role: recipient.role,
    },
    departingMember: departingMember,
    configuration: config,
    claims: candidateClaims,
  };

  const prompt = buildHandoverPrompt(handoverInput);

  // 8. Generate outside any transaction
  const startTime = Date.now();
  const modelToUse = env.GEMINI_MODEL || 'fake-deterministic';
  let aiResult;
  try {
    aiResult = await aiProvider.generate<HandoverOutput>({
      systemInstruction: SYSTEM_INSTRUCTION,
      prompt,
      schema: HandoverOutputSchema,
      validate: (val) => HandoverOutputSchema.parse(val),
      model: modelToUse,
      timeoutMs: env.AI_TIMEOUT_MS,
      requestId: `handover-${job.id}`,
    });
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    await recordAiUsage(
      pool,
      reviewerId,
      projectId,
      job.id,
      'generate_handover',
      modelToUse,
      PROMPT_VERSION_HANDOVER,
      Math.ceil(prompt.length / 3),
      0,
      durationMs,
      (err as Error).message?.includes('TIMEOUT') ? 'timeout' : 'provider_error'
    ).catch(() => {});
    throw err;
  }
  const durationMs = Date.now() - startTime;

  // 9. Semantic validation
  const claimsMap = new Map(candidateClaims.map((c) => [c.id, { evidenceState: c.evidenceState }]));

  const semanticRes = validateHandoverOutput(aiResult.value, claimsMap, config);
  if (!semanticRes.valid) {
    await recordAiUsage(
      pool,
      reviewerId,
      projectId,
      job.id,
      'generate_handover',
      aiResult.model,
      PROMPT_VERSION_HANDOVER,
      aiResult.usage.inputTokens,
      aiResult.usage.outputTokens,
      durationMs,
      'validation_failed'
    ).catch(() => {});

    throw new Error(`VALIDATION_FAILED: ${semanticRes.errors.join('; ')}`);
  }

  // 10. Check cancellation before persisting
  if (await checkCancellation()) {
    throw new Error('CANCELLED');
  }

  // 11. Persist through database transaction
  const draftResult = await createHandoverDraftFromGeneration(pool, {
    actorId: reviewerId,
    projectId,
    recipientId,
    departingUserId: config.departingUserId,
    title: semanticRes.title,
    configuration: config as unknown as Record<string, unknown>,
    modelName: aiResult.model,
    promptVersion: PROMPT_VERSION_HANDOVER,
    expectedAccessEpoch: currentEpoch,
    items: semanticRes.items,
  });

  // 12. Record AI usage
  await recordAiUsage(
    pool,
    reviewerId,
    projectId,
    job.id,
    'generate_handover',
    aiResult.model,
    PROMPT_VERSION_HANDOVER,
    aiResult.usage.inputTokens,
    aiResult.usage.outputTokens,
    durationMs,
    'ok'
  );

  logger.info(
    {
      jobId: job.id,
      handoverId: draftResult.handoverId,
      version: draftResult.version,
      itemCount: semanticRes.items.length,
    },
    'Handover generation completed and persisted'
  );

  return {
    handoverId: draftResult.handoverId,
    version: draftResult.version,
    itemCount: semanticRes.items.length,
  };
}
