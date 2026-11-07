import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DbPool } from '@relay/database';
import { enqueueJob, retryJob, requestCancelJob } from '@relay/database';
import { UuidSchema, JobSummarySchema, type JobSummary } from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';

export function createJobsRouter(pool: DbPool): Router {
  const router = Router();

  // ─── POST /projects/:id/extractions ─────────────────────────────────────────
  router.post(
    '/projects/:id/extractions',
    requireAction(pool, 'PROJECT_TRIGGER_EXTRACTION', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const idempotencyKey = req.headers['idempotency-key'];
        if (!idempotencyKey || typeof idempotencyKey !== 'string') {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Idempotency-Key header is required',
              details: [{ path: 'headers.idempotency-key', message: 'UUID header required' }],
            },
            requestId,
          });
          return;
        }

        const validKey = UuidSchema.safeParse(idempotencyKey);
        if (!validKey.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid Idempotency-Key UUID format',
              details: validKey.error.errors,
            },
            requestId,
          });
          return;
        }

        const sourceId = req.body?.sourceId as string | undefined;
        if (sourceId) {
          const validSourceId = UuidSchema.safeParse(sourceId);
          if (!validSourceId.success) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid sourceId UUID format',
                details: validSourceId.error.errors,
              },
              requestId,
            });
            return;
          }
        }

        const payload = sourceId ? { sourceId } : {};

        try {
          const jobId = await enqueueJob(
            pool,
            actorId,
            projectId,
            'extract',
            validKey.data,
            payload
          );

          res.status(202).json({
            data: {
              jobId,
              status: 'queued',
            },
            requestId,
          });
        } catch (enqueueErr: any) {
          if (
            enqueueErr.message?.includes('IDEMPOTENCY_CONFLICT') ||
            enqueueErr.message?.includes('IDEMPOTENCY_PAYLOAD_MISMATCH')
          ) {
            res.status(422).json({
              error: {
                code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
                message: 'A job with this Idempotency-Key already exists with a different payload',
                details: [],
              },
              requestId,
            });
            return;
          }
          throw enqueueErr;
        }
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /projects/:id/questions/generate ──────────────────────────────────
  router.post(
    '/projects/:id/questions/generate',
    requireAction(pool, 'PROJECT_TRIGGER_QUESTIONS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const idempotencyKey = req.headers['idempotency-key'];
        if (!idempotencyKey || typeof idempotencyKey !== 'string') {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Idempotency-Key header is required',
              details: [{ path: 'headers.idempotency-key', message: 'UUID header required' }],
            },
            requestId,
          });
          return;
        }

        const validKey = UuidSchema.safeParse(idempotencyKey);
        if (!validKey.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid Idempotency-Key UUID format',
              details: validKey.error.errors,
            },
            requestId,
          });
          return;
        }

        const departingUserId = req.body?.departingUserId as string | undefined;
        if (departingUserId) {
          const validUserId = UuidSchema.safeParse(departingUserId);
          if (!validUserId.success) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Invalid departingUserId UUID format',
                details: validUserId.error.errors,
              },
              requestId,
            });
            return;
          }
        }

        const payload = departingUserId ? { departingUserId } : {};

        try {
          const jobId = await enqueueJob(
            pool,
            actorId,
            projectId,
            'generate_questions',
            validKey.data,
            payload
          );

          res.status(202).json({
            data: {
              jobId,
              status: 'queued',
            },
            requestId,
          });
        } catch (enqueueErr: any) {
          if (
            enqueueErr.message?.includes('IDEMPOTENCY_CONFLICT') ||
            enqueueErr.message?.includes('IDEMPOTENCY_PAYLOAD_MISMATCH')
          ) {
            res.status(422).json({
              error: {
                code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
                message: 'A job with this Idempotency-Key already exists with a different payload',
                details: [],
              },
              requestId,
            });
            return;
          }
          throw enqueueErr;
        }
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /projects/:id/jobs ─────────────────────────────────────────────────
  router.get(
    '/projects/:id/jobs',
    requireAction(pool, 'PROJECT_VIEW_JOBS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const requestId = String(req.id || 'unknown');

        const sql = `
          SELECT id, project_id, requested_by, kind, status, progress, attempts,
                 last_error_code, created_at, updated_at
          FROM public.jobs
          WHERE project_id = $1
          ORDER BY created_at DESC
          LIMIT 50;
        `;

        const dbRes = await pool.query(sql, [projectId]);
        const jobs: JobSummary[] = dbRes.rows.map((row) =>
          JobSummarySchema.parse({
            id: row.id,
            projectId: row.project_id,
            requestedBy: row.requested_by,
            kind: row.kind,
            status: row.status,
            progress: row.progress,
            attempts: row.attempts,
            lastErrorCode: row.last_error_code,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          })
        );

        res.json({
          data: jobs,
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /jobs/:id ──────────────────────────────────────────────────────────
  router.get(
    '/jobs/:id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validJobId = UuidSchema.safeParse(jobId);
        if (!validJobId.success) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Job not found',
              details: [],
            },
            requestId,
          });
          return;
        }

        const sql = `
          SELECT id, project_id, requested_by, kind, status, progress, attempts,
                 last_error_code, result, created_at, updated_at
          FROM public.jobs
          WHERE id = $1;
        `;

        const dbRes = await pool.query(sql, [jobId]);
        if (dbRes.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Job not found',
              details: [],
            },
            requestId,
          });
          return;
        }

        const row = dbRes.rows[0];
        const isRequester = row.requested_by === actorId;
        const projectMembership = req.user!.projectMemberships.get(row.project_id);
        const isOwner = projectMembership?.role === 'owner';

        if (!isRequester && !isOwner) {
          // Inaccessible object returns identical 404 (Section 2A.10 / Section 2A.2 line 90)
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Job not found',
              details: [],
            },
            requestId,
          });
          return;
        }

        res.json({
          data: {
            id: row.id,
            projectId: row.project_id,
            requestedBy: row.requested_by,
            kind: row.kind,
            status: row.status,
            progress: row.progress,
            attempts: row.attempts,
            lastErrorCode: row.last_error_code,
            result: row.result,
            createdAt: row.created_at.toISOString(),
            updatedAt: row.updated_at.toISOString(),
          },
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /jobs/:id/retry ───────────────────────────────────────────────────
  router.post(
    '/jobs/:id/retry',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validJobId = UuidSchema.safeParse(jobId);
        if (!validJobId.success) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Job not found',
              details: [],
            },
            requestId,
          });
          return;
        }

        try {
          const result = await retryJob(pool, actorId, jobId);
          res.json({
            data: result,
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('JOB_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Job not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to retry this job',
                details: [],
              },
              requestId,
            });
            return;
          }
          if (err.message?.includes('JOB_NOT_FAILED')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'Only failed jobs can be retried',
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

  // ─── POST /jobs/:id/cancel ──────────────────────────────────────────────────
  router.post(
    '/jobs/:id/cancel',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const jobId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validJobId = UuidSchema.safeParse(jobId);
        if (!validJobId.success) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Job not found',
              details: [],
            },
            requestId,
          });
          return;
        }

        try {
          await requestCancelJob(pool, actorId, jobId);
          res.json({
            data: { jobId, cancelRequested: true },
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('JOB_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Job not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to cancel this job',
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
