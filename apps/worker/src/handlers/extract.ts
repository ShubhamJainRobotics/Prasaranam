import type { DbPool } from '@relay/database';
import { persistClaims, recordAiUsage, enqueueJob } from '@relay/database';
import type {
  ServerEnvironment,
  ChunkInput,
  ExtractionInput,
  ExtractionOutput,
} from '@relay/contracts';
import { ExtractionOutputSchema, PROMPT_VERSION_EXTRACTION } from '@relay/contracts';
import {
  type StructuredAiProvider,
  SYSTEM_INSTRUCTION,
  buildExtractionPrompt,
  validateExtractionClaims,
} from '@relay/api/ai';
import { checkProjectDailyTokenBudget } from './quota.js';
import { pino } from 'pino';

const logger = pino({ name: 'worker-extract-handler' });

interface SourceChunkRow {
  chunk_id: string;
  source_id: string;
  record_ref: string | null;
  author_label: string | null;
  event_at: string | null;
  content: string;
  visibility: string;
}

export async function handleExtractJob(
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
): Promise<{ totalClaims: number; batchesProcessed: number }> {
  const projectId = job.project_id;
  const requestedBy = job.requested_by;
  const sourceId = job.payload?.sourceId as string | undefined;

  // 1. Fetch chunks for the target source (or unextracted project sources)
  let chunksSql = `
    SELECT sc.id as chunk_id, sc.source_id, sc.record_ref, sc.author_label,
           sc.event_at::text, sc.content, s.visibility
    FROM public.source_chunks sc
    JOIN public.sources s ON s.id = sc.source_id
    WHERE s.project_id = $1
      AND s.archived_at IS NULL
  `;
  const chunksArgs: any[] = [projectId];

  if (sourceId) {
    chunksSql += ` AND s.id = $2 ORDER BY sc.ordinal ASC;`;
    chunksArgs.push(sourceId);
  } else {
    chunksSql += ` ORDER BY s.created_at ASC, sc.ordinal ASC;`;
  }

  const chunksRes = await pool.query<SourceChunkRow>(chunksSql, chunksArgs);
  if (chunksRes.rows.length === 0) {
    return { totalClaims: 0, batchesProcessed: 0 };
  }

  // 2. Fetch grants for restricted sources in this project to determine access classes
  const grantsRes = await pool.query<{ source_id: string; user_id: string }>(
    `SELECT source_id, user_id FROM public.source_grants WHERE project_id = $1;`,
    [projectId]
  );
  const grantsBySource = new Map<string, string[]>();
  for (const g of grantsRes.rows) {
    const list = grantsBySource.get(g.source_id) || [];
    list.push(g.user_id);
    grantsBySource.set(g.source_id, list);
  }

  // 3. Partition chunks by access class (Section 2A.3 item 1)
  const accessClassBatches = new Map<string, SourceChunkRow[]>();
  for (const row of chunksRes.rows) {
    let accessClassKey: string;
    if (row.visibility === 'project') {
      accessClassKey = 'project';
    } else {
      const grants = (grantsBySource.get(row.source_id) || []).sort();
      accessClassKey = `restricted:${grants.join(',')}`;
    }

    const list = accessClassBatches.get(accessClassKey) || [];
    list.push(row);
    accessClassBatches.set(accessClassKey, list);
  }

  // 4. Fetch project metadata
  const projRes = await pool.query<{ name: string; description: string; access_epoch: string }>(
    `SELECT name, description, access_epoch FROM public.projects WHERE id = $1;`,
    [projectId]
  );
  const project = projRes.rows[0];
  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }

  let totalClaims = 0;
  let batchesProcessed = 0;

  // 5. Process batches per access class up to AI_MAX_INPUT_TOKENS
  for (const [_accessClassKey, classChunks] of accessClassBatches.entries()) {
    const batches: SourceChunkRow[][] = [];
    let currentBatch: SourceChunkRow[] = [];
    let currentBatchTokens = 0;

    for (const chunk of classChunks) {
      // Conservative estimate: char_length / 3 tokens
      const chunkTokens = Math.ceil(chunk.content.length / 3);
      if (currentBatch.length > 0 && currentBatchTokens + chunkTokens > env.AI_MAX_INPUT_TOKENS) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchTokens = 0;
      }
      currentBatch.push(chunk);
      currentBatchTokens += chunkTokens;
    }
    if (currentBatch.length > 0) {
      batches.push(currentBatch);
    }

    for (const batch of batches) {
      if (await checkCancellation()) {
        throw new Error('CANCELLED');
      }

      const estimatedTokens = Math.ceil(batch.reduce((acc, c) => acc + c.content.length, 0) / 3);

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

      // Read current access epoch
      const epochRes = await pool.query<{ access_epoch: string }>(
        `SELECT access_epoch FROM public.projects WHERE id = $1;`,
        [projectId]
      );
      const currentEpoch = parseInt(epochRes.rows[0]?.access_epoch ?? '1', 10);

      const chunkInputs: ChunkInput[] = batch.map((b) => ({
        chunkId: b.chunk_id,
        sourceId: b.source_id,
        recordRef: b.record_ref,
        authorLabel: b.author_label,
        eventAt: b.event_at,
        text: b.content,
      }));

      const extractionInput: ExtractionInput = {
        projectContext: {
          name: project.name,
          description: project.description,
        },
        chunks: chunkInputs,
      };

      const prompt = buildExtractionPrompt(extractionInput);
      const requestId = `ext-${job.id}-${batchesProcessed + 1}`;
      const modelName =
        env.AI_PROVIDER === 'fake' ? 'fake-deterministic' : env.GEMINI_MODEL || 'gemini-2.5-flash';

      let aiResult;
      let outcome = 'ok';
      try {
        aiResult = await aiProvider.generate<ExtractionOutput>({
          systemInstruction: SYSTEM_INSTRUCTION,
          prompt,
          schema: ExtractionOutputSchema,
          validate: (v) => ExtractionOutputSchema.parse(v),
          model: modelName,
          timeoutMs: env.AI_TIMEOUT_MS,
          requestId,
        });
      } catch (err) {
        outcome = 'provider_error';
        await recordAiUsage(
          pool,
          requestedBy,
          projectId,
          job.id,
          'extract',
          modelName,
          PROMPT_VERSION_EXTRACTION,
          estimatedTokens,
          null,
          0,
          outcome
        );
        throw err;
      }

      // Record AI usage
      await recordAiUsage(
        pool,
        requestedBy,
        projectId,
        job.id,
        'extract',
        aiResult.model,
        PROMPT_VERSION_EXTRACTION,
        aiResult.usage.inputTokens,
        aiResult.usage.outputTokens,
        aiResult.durationMs,
        'ok'
      );

      // Semantic validation
      const { validClaims, rejectedClaims } = validateExtractionClaims(
        aiResult.value.claims,
        chunkInputs
      );

      if (rejectedClaims.length > 0) {
        logger.warn(
          {
            jobId: job.id,
            rejectedCount: rejectedClaims.length,
            reasons: rejectedClaims.map((r) => r.reason),
          },
          'Extraction claims rejected by semantic validator'
        );
      }

      // Persist valid claims transactionally
      if (validClaims.length > 0) {
        const persistResult = await persistClaims(
          pool,
          requestedBy,
          projectId,
          job.id,
          validClaims,
          currentEpoch
        );
        totalClaims += persistResult.inserted;
      }

      batchesProcessed++;
    }
  }

  // Auto-enqueue relationship analysis for the project if claims were found
  if (totalClaims > 0) {
    try {
      const relIdempotencyKey = `rel-${job.id}`;
      await enqueueJob(pool, requestedBy, projectId, 'analyze_relationships', relIdempotencyKey, {
        triggerSourceId: sourceId ?? null,
      });
      logger.info({ projectId, sourceId }, 'Enqueued relationship analysis after extraction');
    } catch (e) {
      // Idempotent collision or job already running is fine
      logger.debug({ error: (e as Error).message }, 'Auto-enqueue relationship job skipped');
    }
  }

  return { totalClaims, batchesProcessed };
}
