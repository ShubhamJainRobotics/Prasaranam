import { Router } from 'express';
import type { DbPool } from '@relay/database';
import {
  type ServerEnvironment,
  PostMessageInputSchema,
  AnswerOutputSchema,
  type AnswerInput,
  type AnswerOutput,
  type ClaimInput,
  type MessageCitation,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { createConversation, recordMessage, recordAiUsage } from '@relay/database';
import {
  createAiProvider,
  buildAnswerPrompt,
  validateAnswerOutput,
  QA_TASK_INSTRUCTION,
  PROMPT_VERSION_QA,
} from '../ai/index.js';

function buildFtsQuery(text: string): string {
  const words = text
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
    .filter(Boolean);

  if (words.length === 0) return '';
  return words.join(' | ');
}

export function createConversationsRouter(pool: DbPool, env: ServerEnvironment): Router {
  const router = Router();

  // ─── POST /projects/:id/conversations ──────────────────────────────────────
  router.post(
    '/projects/:id/conversations',
    requireAction(pool, 'CONVERSATION_CREATE', (req) => ({ projectId: req.params.id })),
    async (req, res, next) => {
      try {
        const projectId = req.params.id as string;
        const userId = req.user!.id;

        const result = await createConversation(pool, userId, projectId);

        res.status(201).json({
          data: {
            id: result.id,
            projectId: result.projectId,
            userId: result.userId,
            createdAt: result.createdAt,
          },
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /projects/:id/conversations ───────────────────────────────────────
  router.get(
    '/projects/:id/conversations',
    requireAction(pool, 'PROJECT_VIEW', (req) => ({ projectId: req.params.id })),
    async (req, res, next) => {
      try {
        const projectId = req.params.id as string;
        const userId = req.user!.id;

        const convRes = await pool.query(
          `SELECT
             c.id,
             c.project_id as "projectId",
             c.user_id as "userId",
             c.created_at as "createdAt",
             (SELECT count(*)::int FROM public.conversation_messages cm WHERE cm.conversation_id = c.id) as "messageCount",
             (SELECT cm.created_at FROM public.conversation_messages cm WHERE cm.conversation_id = c.id ORDER BY cm.created_at DESC LIMIT 1) as "lastMessageAt"
           FROM public.conversations c
           WHERE c.project_id = $1 AND c.user_id = $2
           ORDER BY c.created_at DESC`,
          [projectId, userId]
        );

        res.json({
          data: convRes.rows,
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /conversations/:id/messages ───────────────────────────────────────
  router.get(
    '/conversations/:id/messages',
    requireAction(pool, 'CONVERSATION_VIEW', (req) => ({ conversationId: req.params.id })),
    async (req, res, next) => {
      try {
        const conversationId = req.params.id as string;
        const userId = req.user!.id;

        const convRes = await pool.query(
          `SELECT c.id, c.project_id, p.access_epoch
           FROM public.conversations c
           JOIN public.projects p ON p.id = c.project_id
           WHERE c.id = $1`,
          [conversationId]
        );

        if (convRes.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Conversation not found.', details: [] },
            requestId: req.id,
          });
          return;
        }

        const currentEpoch = BigInt(convRes.rows[0].access_epoch);

        const msgRes = await pool.query(
          `SELECT
             id,
             conversation_id as "conversationId",
             role,
             body,
             access_epoch as "accessEpoch",
             created_at as "createdAt"
           FROM public.conversation_messages
           WHERE conversation_id = $1
           ORDER BY created_at ASC`,
          [conversationId]
        );

        const allMessages = msgRes.rows;
        const hasStaleHistory = allMessages.some((m) => BigInt(m.accessEpoch) < currentEpoch);
        const historyUnavailableNotice = hasStaleHistory
          ? 'Conversation history before the last access change is unavailable.'
          : null;

        // Filter to only messages from current epoch
        const validMessages = allMessages.filter((m) => BigInt(m.accessEpoch) === currentEpoch);

        // Enrich citations for assistant messages
        const enrichedMessages = [];
        for (const msg of validMessages) {
          if (msg.role === 'assistant' && msg.body && typeof msg.body === 'object') {
            const body = msg.body as any;
            const statements = body.statements || [];
            const allClaimIds: string[] = [];
            for (const stmt of statements) {
              if (Array.isArray(stmt.claimIds)) {
                allClaimIds.push(...stmt.claimIds);
              }
            }

            let evidenceRows: any[] = [];
            if (allClaimIds.length > 0) {
              const evRes = await pool.query(
                `SELECT
                   c.id as "claimId",
                   c.statement,
                   c.evidence_state as "evidenceState",
                   ce.quote,
                   ce.chunk_id as "chunkId",
                   ce.quote_start as "quoteStart",
                   ce.quote_end as "quoteEnd",
                   s.title as "sourceTitle"
                 FROM public.claims c
                 JOIN public.claim_evidence ce ON ce.claim_id = c.id
                 JOIN public.source_chunks sc ON sc.id = ce.chunk_id
                 JOIN public.sources s ON s.id = sc.source_id
                 WHERE c.id = ANY($1::uuid[])
                   AND app_private.can_read_claim(c.id, $2) = true
                   AND app_private.can_read_source(s.id, $2) = true`,
                [allClaimIds, userId]
              );
              evidenceRows = evRes.rows;
            }

            const enrichedStatements = statements.map((stmt: any) => {
              const citations: MessageCitation[] = [];
              if (Array.isArray(stmt.claimIds)) {
                for (const cid of stmt.claimIds) {
                  const evs = evidenceRows.filter((e) => e.claimId === cid);
                  for (const ev of evs) {
                    citations.push({
                      claimId: cid,
                      statement: ev.statement,
                      evidenceState: ev.evidenceState,
                      sourceTitle: ev.sourceTitle,
                      quote: ev.quote,
                      chunkId: ev.chunkId,
                      quoteStart: ev.quoteStart,
                      quoteEnd: ev.quoteEnd,
                    });
                  }
                }
              }
              return {
                text: stmt.text,
                claimIds: stmt.claimIds || [],
                citations,
              };
            });

            enrichedMessages.push({
              ...msg,
              body: {
                ...body,
                statements: enrichedStatements,
              },
            });
          } else {
            enrichedMessages.push(msg);
          }
        }

        res.json({
          data: {
            messages: enrichedMessages,
            hasStaleHistory,
            historyUnavailableNotice,
          },
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /conversations/:id/messages ──────────────────────────────────────
  router.post(
    '/conversations/:id/messages',
    requireAction(pool, 'CONVERSATION_ASK', (req) => ({ conversationId: req.params.id })),
    async (req, res, next) => {
      try {
        const conversationId = req.params.id as string;
        const userId = req.user!.id;

        const parseRes = PostMessageInputSchema.safeParse(req.body);
        if (!parseRes.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid message payload.',
              details: parseRes.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { question } = parseRes.data;

        // Fetch conversation & project epoch
        const cRes = await pool.query(
          `SELECT c.id, c.project_id as "projectId", p.access_epoch as "accessEpoch", p.organisation_id as "organisationId"
           FROM public.conversations c
           JOIN public.projects p ON p.id = c.project_id
           WHERE c.id = $1`,
          [conversationId]
        );

        if (cRes.rows.length === 0) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Conversation not found.', details: [] },
            requestId: req.id,
          });
          return;
        }

        const conv = cRes.rows[0];
        const projectId = conv.projectId;
        const capturedEpoch = BigInt(conv.accessEpoch);

        // 1. Quota & Rate Limit checks
        const dailyUsageRes = await pool.query(
          `SELECT coalesce(sum(input_tokens + output_tokens), 0)::bigint as total_tokens
           FROM public.ai_usage
           WHERE project_id = $1 AND created_at >= now() - interval '24 hours'`,
          [projectId]
        );
        if (Number(dailyUsageRes.rows[0].total_tokens) >= env.AI_PROJECT_DAILY_TOKEN_BUDGET) {
          res.status(429).json({
            error: {
              code: 'QUOTA_EXCEEDED',
              message: 'Project daily AI token budget exceeded.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const hourlyRequestsRes = await pool.query(
          `SELECT count(*)::int as req_count
           FROM public.ai_usage
           WHERE user_id = $1 AND purpose = 'answer' AND created_at >= now() - interval '1 hour'`,
          [userId]
        );
        if (hourlyRequestsRes.rows[0].req_count >= env.AI_RATE_LIMIT_PER_USER_PER_HOUR) {
          res.status(429).json({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Hourly AI request rate limit exceeded.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // 2. Full-Text Search over readable claims and chunks
        const ftsQueryStr = buildFtsQuery(question);
        let matchingClaims: any[] = [];
        if (ftsQueryStr) {
          const ftsRes = await pool.query(
            `SELECT DISTINCT
               c.id as "claimId",
               c.kind,
               c.statement,
               c.work_state as "workState",
               c.evidence_state as "evidenceState",
               c.owner_label as "ownerLabel",
               c.observed_at as "observedAt",
               ts_rank(c.search_vector, to_tsquery('english', $2)) as rank
             FROM public.claims c
             WHERE c.project_id = $1
               AND c.archived_at IS NULL
               AND app_private.can_read_claim(c.id, $3) = true
               AND (
                 c.search_vector @@ to_tsquery('english', $2)
                 OR EXISTS (
                   SELECT 1
                   FROM public.claim_evidence ce
                   JOIN public.source_chunks sc ON sc.id = ce.chunk_id
                   WHERE ce.claim_id = c.id
                     AND app_private.can_read_source(sc.source_id, $3) = true
                     AND sc.search_vector @@ to_tsquery('english', $2)
                 )
               )
             ORDER BY rank DESC
             LIMIT 40`,
            [projectId, ftsQueryStr, userId]
          );
          matchingClaims = ftsRes.rows;
        }

        // 3. If zero matches: SHORT-CIRCUIT TO insufficient_evidence (NO AI CALL)
        if (matchingClaims.length === 0) {
          const answerBody = {
            status: 'insufficient_evidence',
            statements: [],
            limitations: [
              'No relevant evidence was found in accessible sources to answer this question.',
            ],
            suggestedClarification: null,
          };

          const client = await pool.connect();
          try {
            await client.query('BEGIN');
            const pEpoch = await client.query(
              'SELECT access_epoch FROM public.projects WHERE id = $1 FOR UPDATE',
              [projectId]
            );
            if (BigInt(pEpoch.rows[0].access_epoch) !== capturedEpoch) {
              await client.query('ROLLBACK');
              res.status(409).json({
                error: {
                  code: 'STALE_CONTEXT',
                  message: 'Project access state changed during request processing. Please retry.',
                  details: [],
                },
                requestId: req.id,
              });
              return;
            }

            await recordMessage(client, userId, conv.id, 'user', { question }, capturedEpoch);
            const asstRes = await recordMessage(
              client,
              userId,
              conv.id,
              'assistant',
              answerBody,
              capturedEpoch
            );
            await client.query('COMMIT');

            res.status(200).json({
              data: {
                id: asstRes.messageId,
                role: 'assistant',
                body: answerBody,
                accessEpoch: String(capturedEpoch),
                createdAt: asstRes.createdAt,
              },
              requestId: req.id,
            });
            return;
          } catch (txErr) {
            await client.query('ROLLBACK');
            throw txErr;
          } finally {
            client.release();
          }
        }

        // 4. Matches found: fetch readable evidence
        const claimIds = matchingClaims.map((c) => c.claimId);
        const evRes = await pool.query(
          `SELECT
             ce.claim_id as "claimId",
             ce.quote,
             ce.chunk_id as "chunkId",
             ce.quote_start as "quoteStart",
             ce.quote_end as "quoteEnd",
             sc.record_ref as "recordRef",
             s.title as "sourceTitle"
           FROM public.claim_evidence ce
           JOIN public.source_chunks sc ON sc.id = ce.chunk_id
           JOIN public.sources s ON s.id = sc.source_id
           WHERE ce.claim_id = ANY($1::uuid[])
             AND app_private.can_read_source(s.id, $2) = true`,
          [claimIds, userId]
        );
        const evidenceRows = evRes.rows;

        // Fetch up to 6 recent user questions in current epoch
        const histRes = await pool.query(
          `SELECT body->>'question' as q
           FROM public.conversation_messages
           WHERE conversation_id = $1 AND role = 'user' AND access_epoch = $2
           ORDER BY created_at DESC
           LIMIT 6`,
          [conv.id, capturedEpoch]
        );
        const recentQuestions = histRes.rows
          .map((r) => r.q)
          .filter(Boolean)
          .reverse();
        recentQuestions.push(question);

        const candidateClaims: ClaimInput[] = matchingClaims.map((c) => ({
          claimId: c.claimId,
          kind: c.kind,
          statement: c.statement,
          workState: c.workState,
          evidenceState: c.evidenceState,
          ownerLabel: c.ownerLabel ?? null,
          observedAt: c.observedAt ? new Date(c.observedAt).toISOString() : null,
          evidence: evidenceRows
            .filter((e) => e.claimId === c.claimId)
            .map((e) => ({
              sourceTitle: e.sourceTitle,
              quote: e.quote,
              chunkId: e.chunkId,
              quoteStart: e.quoteStart,
              quoteEnd: e.quoteEnd,
              recordRef: e.recordRef ?? null,
            })),
        }));

        const answerInput: AnswerInput = {
          question,
          recentUserQuestions: recentQuestions,
          claims: candidateClaims,
        };

        // 5. Model call outside any transaction
        const aiProvider = createAiProvider(env);
        const prompt = buildAnswerPrompt(answerInput);
        const modelToUse = env.GEMINI_MODEL || 'fake-deterministic';
        const startTime = Date.now();
        let aiResult;

        try {
          aiResult = await aiProvider.generate<AnswerOutput>({
            systemInstruction: QA_TASK_INSTRUCTION,
            prompt,
            schema: AnswerOutputSchema,
            validate: (val) => AnswerOutputSchema.parse(val),
            model: modelToUse,
            timeoutMs: env.AI_TIMEOUT_MS,
            requestId: `qa-${conv.id}-${Date.now()}`,
          });
        } catch (genErr: any) {
          const durationMs = Date.now() - startTime;
          await recordAiUsage(
            pool,
            userId,
            projectId,
            null,
            'answer',
            modelToUse,
            PROMPT_VERSION_QA,
            null,
            null,
            durationMs,
            genErr?.message?.includes('TIMEOUT') ? 'timeout' : 'provider_error'
          );
          throw genErr;
        }

        const durationMs = Date.now() - startTime;
        await recordAiUsage(
          pool,
          userId,
          projectId,
          null,
          'answer',
          modelToUse,
          PROMPT_VERSION_QA,
          aiResult.usage.inputTokens,
          aiResult.usage.outputTokens,
          durationMs,
          'ok'
        );

        // 6. Semantic validation
        const validationResult = validateAnswerOutput(aiResult.value, candidateClaims);
        if (!validationResult.valid) {
          await recordAiUsage(
            pool,
            userId,
            projectId,
            null,
            'answer',
            modelToUse,
            PROMPT_VERSION_QA,
            aiResult.usage.inputTokens,
            aiResult.usage.outputTokens,
            durationMs,
            'validation_failed'
          );
          res.status(422).json({
            error: {
              code: 'SEMANTIC_VALIDATION_FAILED',
              message: 'Model answer cited unsupplied claims or violated semantic rules.',
              details: validationResult.errors,
            },
            requestId: req.id,
          });
          return;
        }

        // 7. Transactional lock, recheck epoch & claim readability, record messages
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const pEpoch = await client.query(
            'SELECT access_epoch FROM public.projects WHERE id = $1 FOR UPDATE',
            [projectId]
          );

          if (BigInt(pEpoch.rows[0].access_epoch) !== capturedEpoch) {
            await client.query('ROLLBACK');
            res.status(409).json({
              error: {
                code: 'STALE_CONTEXT',
                message: 'Project access state changed during answer generation. Please retry.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }

          // Recheck readability of cited claims
          const citedClaimIds = new Set<string>();
          for (const stmt of validationResult.statements) {
            for (const cid of stmt.claimIds) {
              citedClaimIds.add(cid);
            }
          }

          for (const cid of citedClaimIds) {
            const readableCheck = await client.query(
              'SELECT app_private.can_read_claim($1, $2) as readable',
              [cid, userId]
            );
            if (!readableCheck.rows[0]?.readable) {
              await client.query('ROLLBACK');
              res.status(409).json({
                error: {
                  code: 'STALE_CONTEXT',
                  message:
                    'Evidence cited in the answer is no longer accessible under updated permissions.',
                  details: [],
                },
                requestId: req.id,
              });
              return;
            }
          }

          await recordMessage(client, userId, conv.id, 'user', { question }, capturedEpoch);
          const asstRes = await recordMessage(
            client,
            userId,
            conv.id,
            'assistant',
            {
              status: validationResult.status,
              statements: validationResult.statements,
              limitations: validationResult.limitations,
              suggestedClarification: validationResult.suggestedClarification,
            },
            capturedEpoch
          );
          await client.query('COMMIT');

          // Enrich citations for response
          const enrichedStatements = validationResult.statements.map((stmt) => {
            const citations: MessageCitation[] = [];
            for (const cid of stmt.claimIds) {
              const evs = evidenceRows.filter((e) => e.claimId === cid);
              for (const ev of evs) {
                const claim = matchingClaims.find((c) => c.claimId === cid);
                citations.push({
                  claimId: cid,
                  statement: claim?.statement || '',
                  evidenceState: claim?.evidenceState || 'supported',
                  sourceTitle: ev.sourceTitle,
                  quote: ev.quote,
                  chunkId: ev.chunkId,
                  quoteStart: ev.quoteStart,
                  quoteEnd: ev.quoteEnd,
                });
              }
            }
            return {
              text: stmt.text,
              claimIds: stmt.claimIds,
              citations,
            };
          });

          res.status(200).json({
            data: {
              id: asstRes.messageId,
              role: 'assistant',
              body: {
                status: validationResult.status,
                statements: enrichedStatements,
                limitations: validationResult.limitations,
                suggestedClarification: validationResult.suggestedClarification,
              },
              accessEpoch: String(capturedEpoch),
              createdAt: asstRes.createdAt,
            },
            requestId: req.id,
          });
        } catch (txErr) {
          await client.query('ROLLBACK');
          throw txErr;
        } finally {
          client.release();
        }
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
