import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DbPool } from '@relay/database';
import { reviewClaim, setClaimOwner, flagClaim } from '@relay/database';
import {
  UuidSchema,
  ClaimFilterQuerySchema,
  ReviewClaimInputSchema,
  SetClaimOwnerInputSchema,
  FlagClaimInputSchema,
  type ClaimSummary,
  type ClaimDetail,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';

export function createClaimsRouter(pool: DbPool): Router {
  const router = Router();

  // ─── GET /projects/:id/claims ───────────────────────────────────────────────
  router.get(
    '/projects/:id/claims',
    requireAction(pool, 'PROJECT_VIEW_CLAIMS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const queryParsed = ClaimFilterQuerySchema.safeParse(req.query);
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

        const { cursor, limit, kind, workState, evidenceState, reviewState, search } =
          queryParsed.data;

        const whereClauses: string[] = [
          'c.project_id = $1',
          'c.archived_at IS NULL',
          'app_private.can_read_claim(c.id, $2)',
        ];
        const params: any[] = [projectId, actorId];

        if (kind) {
          params.push(kind);
          whereClauses.push(`c.kind = $${params.length}`);
        }
        if (workState) {
          params.push(workState);
          whereClauses.push(`c.work_state = $${params.length}`);
        }
        if (evidenceState) {
          params.push(evidenceState);
          whereClauses.push(`c.evidence_state = $${params.length}`);
        }
        if (reviewState) {
          params.push(reviewState);
          whereClauses.push(`c.review_state = $${params.length}`);
        }
        if (search && search.trim()) {
          params.push(search.trim());
          whereClauses.push(`c.search_vector @@ plainto_tsquery('english', $${params.length})`);
        }

        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            const [cursorTimestamp, cursorId] = decoded;
            params.push(cursorTimestamp, cursorId);
            whereClauses.push(
              `(c.created_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`
            );
          }
        }

        params.push(limit + 1);
        const limitIndex = params.length;

        const sql = `
          SELECT c.id, c.project_id, c.kind, c.statement, c.work_state, c.evidence_state,
                 c.review_state, c.owner_user_id, c.owner_label, p.display_name as owner_display_name,
                 c.observed_at, c.created_at,
                 (SELECT count(*)::integer FROM public.claim_evidence ce WHERE ce.claim_id = c.id) as evidence_count
          FROM public.claims c
          LEFT JOIN public.profiles p ON p.id = c.owner_user_id
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT $${limitIndex};
        `;

        const dbRes = await pool.query(sql, params);
        const rows = dbRes.rows;
        const hasMore = rows.length > limit;
        const dataRows = hasMore ? rows.slice(0, limit) : rows;

        const claims: ClaimSummary[] = dataRows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          kind: r.kind,
          statement: r.statement,
          workState: r.work_state,
          evidenceState: r.evidence_state,
          reviewState: r.review_state,
          ownerUserId: r.owner_user_id,
          ownerLabel: r.owner_label,
          ownerDisplayName: r.owner_display_name,
          observedAt: r.observed_at ? r.observed_at.toISOString() : null,
          evidenceCount: r.evidence_count,
          createdAt: r.created_at.toISOString(),
        }));

        const lastItem = dataRows[dataRows.length - 1];
        const nextCursor =
          hasMore && lastItem ? encodeCursor(lastItem.created_at.toISOString(), lastItem.id) : null;

        res.json({
          data: claims,
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

  // ─── GET /claims/:id ────────────────────────────────────────────────────────
  router.get(
    '/claims/:id',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const claimId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validClaimId = UuidSchema.safeParse(claimId);
        if (!validClaimId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
            requestId,
          });
          return;
        }

        // Verify readable by caller via app_private.can_read_claim
        const checkSql = `
          SELECT c.id, c.project_id, c.kind, c.statement, c.work_state, c.evidence_state,
                 c.review_state, c.owner_user_id, c.owner_label, p.display_name as owner_display_name,
                 c.observed_at, c.created_at, c.model_name, c.prompt_version,
                 app_private.can_read_claim(c.id, $2) as is_readable
          FROM public.claims c
          LEFT JOIN public.profiles p ON p.id = c.owner_user_id
          WHERE c.id = $1 AND c.archived_at IS NULL;
        `;

        const claimRes = await pool.query(checkSql, [claimId, actorId]);
        if (claimRes.rows.length === 0 || !claimRes.rows[0].is_readable) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
            requestId,
          });
          return;
        }

        const claimRow = claimRes.rows[0];

        // Fetch evidence entries with source titles
        const evSql = `
          SELECT ce.id, ce.chunk_id, s.id as source_id, s.title as source_title,
                 ce.quote, ce.quote_start, ce.quote_end
          FROM public.claim_evidence ce
          JOIN public.source_chunks sc ON sc.id = ce.chunk_id
          JOIN public.sources s ON s.id = sc.source_id
          WHERE ce.claim_id = $1
          ORDER BY s.title ASC, ce.quote_start ASC;
        `;
        const evRes = await pool.query(evSql, [claimId]);

        // Fetch relationships (both outgoing and incoming) where the other claim is readable
        const relSql = `
          SELECT cr.id, cr.to_claim_id as other_claim_id, c2.statement as other_claim_statement,
                 cr.relation, 'outgoing' as direction, cr.explanation
          FROM public.claim_relationships cr
          JOIN public.claims c2 ON c2.id = cr.to_claim_id
          WHERE cr.from_claim_id = $1
            AND app_private.can_read_claim(c2.id, $2)
          UNION ALL
          SELECT cr.id, cr.from_claim_id as other_claim_id, c1.statement as other_claim_statement,
                 cr.relation, 'incoming' as direction, cr.explanation
          FROM public.claim_relationships cr
          JOIN public.claims c1 ON c1.id = cr.from_claim_id
          WHERE cr.to_claim_id = $1
            AND app_private.can_read_claim(c1.id, $2);
        `;
        const relRes = await pool.query(relSql, [claimId, actorId]);

        const claimDetail: ClaimDetail = {
          id: claimRow.id,
          projectId: claimRow.project_id,
          kind: claimRow.kind,
          statement: claimRow.statement,
          workState: claimRow.work_state,
          evidenceState: claimRow.evidence_state,
          reviewState: claimRow.review_state,
          ownerUserId: claimRow.owner_user_id,
          ownerLabel: claimRow.owner_label,
          ownerDisplayName: claimRow.owner_display_name,
          observedAt: claimRow.observed_at ? claimRow.observed_at.toISOString() : null,
          evidenceCount: evRes.rows.length,
          modelName: claimRow.model_name,
          promptVersion: claimRow.prompt_version,
          createdAt: claimRow.created_at.toISOString(),
          evidence: evRes.rows.map((ev) => ({
            id: ev.id,
            chunkId: ev.chunk_id,
            sourceId: ev.source_id,
            sourceTitle: ev.source_title,
            quote: ev.quote,
            quoteStart: ev.quote_start,
            quoteEnd: ev.quote_end,
          })),
          relationships: relRes.rows.map((r) => ({
            id: r.id,
            otherClaimId: r.other_claim_id,
            otherClaimStatement: r.other_claim_statement,
            relation: r.relation,
            direction: r.direction,
            explanation: r.explanation,
          })),
        };

        res.json({
          data: claimDetail,
          requestId,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── PATCH /claims/:id/review ───────────────────────────────────────────────
  router.patch(
    '/claims/:id/review',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const claimId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validClaimId = UuidSchema.safeParse(claimId);
        if (!validClaimId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
            requestId,
          });
          return;
        }

        const bodyParsed = ReviewClaimInputSchema.safeParse(req.body);
        if (!bodyParsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid review state',
              details: bodyParsed.error.errors,
            },
            requestId,
          });
          return;
        }

        try {
          const result = await reviewClaim(pool, actorId, claimId, bodyParsed.data.reviewState);
          res.json({
            data: result,
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('CLAIM_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to review this claim',
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

  // ─── PATCH /claims/:id/owner ────────────────────────────────────────────────
  router.patch(
    '/claims/:id/owner',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const claimId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validClaimId = UuidSchema.safeParse(claimId);
        if (!validClaimId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
            requestId,
          });
          return;
        }

        const bodyParsed = SetClaimOwnerInputSchema.safeParse(req.body);
        if (!bodyParsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid owner user ID',
              details: bodyParsed.error.errors,
            },
            requestId,
          });
          return;
        }

        try {
          const result = await setClaimOwner(pool, actorId, claimId, bodyParsed.data.userId);
          res.json({
            data: result,
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('CLAIM_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to link claim owner',
                details: [],
              },
              requestId,
            });
            return;
          }
          if (err.message?.includes('OWNER_NOT_PROJECT_MEMBER')) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Selected owner must be an active project member',
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

  // ─── POST /claims/:id/flags ─────────────────────────────────────────────────
  router.post(
    '/claims/:id/flags',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const claimId = req.params.id as string;
        const actorId = req.user!.id;
        const requestId = String(req.id || 'unknown');

        const validClaimId = UuidSchema.safeParse(claimId);
        if (!validClaimId.success) {
          res.status(404).json({
            error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
            requestId,
          });
          return;
        }

        const bodyParsed = FlagClaimInputSchema.safeParse(req.body);
        if (!bodyParsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid flag parameters',
              details: bodyParsed.error.errors,
            },
            requestId,
          });
          return;
        }

        try {
          const result = await flagClaim(
            pool,
            actorId,
            claimId,
            bodyParsed.data.reason,
            bodyParsed.data.newEvidenceState
          );
          res.json({
            data: result,
            requestId,
          });
        } catch (err: any) {
          if (err.message?.includes('CLAIM_NOT_FOUND')) {
            res.status(404).json({
              error: { code: 'NOT_FOUND', message: 'Claim not found', details: [] },
              requestId,
            });
            return;
          }
          if (err.message?.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'Not authorised to flag this claim',
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
