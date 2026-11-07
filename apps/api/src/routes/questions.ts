import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DbPool } from '@relay/database';
import { importSource, enqueueJob, dismissQuestion } from '@relay/database';
import {
  UuidSchema,
  ClarificationQuestionFilterQuerySchema,
  AnswerQuestionInputSchema,
  type ClarificationQuestionSummary,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';
import { ingestDocument } from '../ingestion/index.js';

export function createQuestionsRouter(pool: DbPool): Router {
  const router = Router();

  // ─── GET /projects/:id/questions ────────────────────────────────────────────
  router.get(
    '/projects/:id/questions',
    requireAction(pool, 'PROJECT_VIEW_QUESTIONS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const queryParsed = ClarificationQuestionFilterQuerySchema.safeParse(req.query);
        if (!queryParsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid query parameters',
              details: queryParsed.error.errors,
            },
            requestId,
          });
          return;
        }

        const { cursor, limit, status, priority } = queryParsed.data;

        const whereClauses: string[] = [
          'q.project_id = $1',
          'app_private.can_read_question(q.id, $2)',
        ];
        const params: any[] = [projectId, actorId];

        if (status) {
          params.push(status);
          whereClauses.push(`q.status = $${params.length}`);
        }
        if (priority) {
          params.push(priority);
          whereClauses.push(`q.priority = $${params.length}`);
        }

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            const [cursorTimestamp, cursorId] = decoded;
            params.push(cursorTimestamp, cursorId);
            whereClauses.push(
              `(q.created_at, q.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
            );
          }
        }

        params.push(limit + 1);
        const limitIndex = params.length;

        const sql = `
          SELECT q.id, q.project_id, q.created_for, p1.display_name as created_for_display_name,
                 q.question, q.reason, q.priority, q.status, q.answer_source_id,
                 q.answered_by, p2.display_name as answered_by_display_name, q.answered_at,
                 q.created_at
          FROM public.clarification_questions q
          LEFT JOIN public.profiles p1 ON p1.id = q.created_for
          LEFT JOIN public.profiles p2 ON p2.id = q.answered_by
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY q.created_at DESC, q.id DESC
          LIMIT $${limitIndex};
        `;

        const dbRes = await pool.query(sql, params);
        const rows = dbRes.rows;
        const hasMore = rows.length > limit;
        const dataRows = hasMore ? rows.slice(0, limit) : rows;

        // Fetch related claims for questions
        const questionIds = dataRows.map((r) => r.id);
        const claimsByQuestion = new Map<
          string,
          Array<{ id: string; statement: string; kind: any }>
        >();

        if (questionIds.length > 0) {
          const claimsSql = `
            SELECT qc.question_id, c.id, c.statement, c.kind
            FROM public.question_claims qc
            JOIN public.claims c ON c.id = qc.claim_id
            WHERE qc.question_id = ANY($1::uuid[])
              AND app_private.can_read_claim(c.id, $2);
          `;
          const claimsRes = await pool.query(claimsSql, [questionIds, actorId]);
          for (const cr of claimsRes.rows) {
            const list = claimsByQuestion.get(cr.question_id) || [];
            list.push({
              id: cr.id,
              statement: cr.statement,
              kind: cr.kind,
            });
            claimsByQuestion.set(cr.question_id, list);
          }
        }

        const questions: ClarificationQuestionSummary[] = dataRows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          createdFor: r.created_for,
          createdForDisplayName: r.created_for_display_name,
          question: r.question,
          reason: r.reason,
          priority: r.priority,
          status: r.status,
          answerSourceId: r.answer_source_id,
          answeredBy: r.answered_by,
          answeredByDisplayName: r.answered_by_display_name,
          answeredAt: r.answered_at ? r.answered_at.toISOString() : null,
          relatedClaims: claimsByQuestion.get(r.id) || [],
          createdAt: r.created_at.toISOString(),
        }));

        const lastItem = dataRows[dataRows.length - 1];
        const nextCursor =
          hasMore && lastItem ? encodeCursor(lastItem.created_at.toISOString(), lastItem.id) : null;

        res.json({
          data: questions,
          page: {
            nextCursor,
            hasMore,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /questions/:id/answer ─────────────────────────────────────────────
  router.post(
    '/questions/:id/answer',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const questionId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validQId = UuidSchema.safeParse(questionId);
        if (!validQId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Question not found', details: [] },
            requestId,
          });
          return;
        }

        const bodyParsed = AnswerQuestionInputSchema.safeParse(req.body);
        if (!bodyParsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid answer parameters',
              details: bodyParsed.error.errors,
            },
            requestId,
          });
          return;
        }

        // Verify question exists and actor can read it
        const checkSql = `
          SELECT q.id, q.project_id, q.question, q.status,
                 app_private.can_read_question(q.id, $2) as is_readable
          FROM public.clarification_questions q
          WHERE q.id = $1;
        `;
        const qRes = await pool.query(checkSql, [questionId, actorId]);
        if (qRes.rows.length === 0 || !qRes.rows[0].is_readable) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Question not found', details: [] },
            requestId,
          });
          return;
        }

        const question = qRes.rows[0];
        if (question.status !== 'open') {
          res.status(409).json({
            error: {
              code: 'ILLEGAL_STATE',
              message: 'Question is not in open status',
              details: [],
            },
            requestId,
          });
          return;
        }

        // Fetch actor profile display name
        const profRes = await pool.query<{ display_name: string }>(
          `SELECT display_name FROM public.profiles WHERE id = $1;`,
          [actorId]
        );
        const authorDisplayName = profRes.rows[0]?.display_name || 'Reviewer';

        // Ingest answer as a reviewer_context source per Section 2A.8 item 5
        const answerText = bodyParsed.data.answer.trim();
        const visibility = bodyParsed.data.visibility || 'restricted';

        const ingested = ingestDocument(answerText, {
          kind: 'text',
          title: `Answer: ${question.question.slice(0, 60)}`,
          authorLabel: authorDisplayName,
          eventAt: new Date().toISOString(),
        });

        // Store source
        const sourceId = await importSource(pool, {
          actorId,
          projectId: question.project_id,
          title: `Answer: ${question.question.slice(0, 60)}`,
          kind: 'reviewer_context',
          visibility,
          content: ingested.canonicalContent,
          contentSha256: ingested.contentSha256,
          authorLabel: authorDisplayName,
          eventAt: new Date().toISOString(),
          chunks: ingested.chunks,
          grantUserIds: visibility === 'project' ? [] : [actorId],
        });

        // Update question to answered
        await pool.query(
          `UPDATE public.clarification_questions
           SET status = 'answered',
               answer_source_id = $1,
               answered_by = $2,
               answered_at = now()
           WHERE id = $3;`,
          [sourceId, actorId, questionId]
        );

        // Enqueue extraction for this source
        const idempotencyKey = `ans-${questionId}-${Date.now()}`;
        const jobId = await enqueueJob(
          pool,
          actorId,
          question.project_id,
          'extract',
          idempotencyKey,
          { sourceId }
        );

        res.json({
          data: {
            questionId,
            sourceId,
            jobId,
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /questions/:id/dismiss ────────────────────────────────────────────
  router.post(
    '/questions/:id/dismiss',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const questionId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validQId = UuidSchema.safeParse(questionId);
        if (!validQId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Question not found', details: [] },
            requestId,
          });
          return;
        }

        try {
          const result = await dismissQuestion(pool, actorId, questionId);
          res.json({
            data: result,
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('QUESTION_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Question not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to dismiss this question',
                details: [],
              },
              requestId,
            });
            return;
          }
          throw err;
        }
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
