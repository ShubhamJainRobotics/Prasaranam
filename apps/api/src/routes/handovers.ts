import { Router } from 'express';
import type { DbPool } from '@relay/database';
import type { ServerEnvironment, HandoverDetail } from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import {
  CreateHandoverInputSchema,
  UpdateHandoverItemSchema,
  AddItemFromClaimsSchema,
  AddReviewerContextSchema,
  ApproveHandoverSchema,
  PaginationQuerySchema,
  ExportHandoverQuerySchema,
} from '@relay/contracts';
import {
  enqueueJob,
  updateHandoverItem,
  addItemFromClaims,
  addReviewerContext,
  createRevision,
  approveHandover,
  shareHandover,
  acknowledgeHandover,
} from '@relay/database';
import { decodeCursor, encodeCursor } from '../lib/pagination.js';
import { renderHandoverMarkdown, renderHandoverPdf, type ExportMetadata } from '../export/index.js';

export function createHandoverRoutes(pool: DbPool, _env: ServerEnvironment): Router {
  const router = Router();

  // ─── POST /projects/:id/handovers ──────────────────────────────────────────
  router.post(
    '/projects/:id/handovers',
    requireAction(pool, 'PROJECT_CREATE_HANDOVER', (req) => ({ projectId: req.params.id })),
    async (req, res, next) => {
      try {
        const projectId = req.params.id as string;
        const idempotencyKey = req.header('idempotency-key');

        if (!idempotencyKey) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Idempotency-Key header is required',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const parseResult = CreateHandoverInputSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid handover configuration',
              details: parseResult.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const config = parseResult.data;

        // Verify recipient is an active project member
        const recipCheck = await pool.query(
          `SELECT 1 FROM public.project_members
           WHERE project_id = $1 AND user_id = $2 AND active = true`,
          [projectId, config.recipientId]
        );
        if (recipCheck.rows.length === 0) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Recipient must be an active project member.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // Enqueue generation job
        try {
          const jobId = await enqueueJob(
            pool,
            req.user!.id,
            projectId,
            'generate_handover',
            idempotencyKey,
            config as unknown as Record<string, unknown>
          );

          res.status(202).json({
            data: {
              jobId,
              status: 'queued',
            },
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (
            errMsg.includes('IDEMPOTENCY_CONFLICT') ||
            errMsg.includes('IDEMPOTENCY_PAYLOAD_MISMATCH')
          ) {
            res.status(422).json({
              error: {
                code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
                message: 'Idempotency key has already been used with different payload',
                details: [],
              },
              requestId: req.id,
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

  // ─── GET /projects/:id/handovers ───────────────────────────────────────────
  router.get(
    '/projects/:id/handovers',
    requireAction(pool, 'PROJECT_VIEW_HANDOVERS', (req) => ({ projectId: req.params.id })),
    async (req, res, next) => {
      try {
        const projectId = req.params.id as string;
        const paginationResult = PaginationQuerySchema.safeParse(req.query);
        const { cursor, limit = 25 } = paginationResult.success ? paginationResult.data : {};

        let cursorCreatedAt: string | null = null;
        let cursorId: string | null = null;
        if (cursor) {
          const decoded = decodeCursor(cursor);
          if (decoded) {
            const [sortKey, id] = decoded;
            cursorCreatedAt = String(sortKey);
            cursorId = id;
          }
        }

        const values: unknown[] = [projectId, req.user!.id, limit + 1];
        let cursorClause = '';
        if (cursorCreatedAt && cursorId) {
          values.push(cursorCreatedAt, cursorId);
          cursorClause = `AND (h.created_at, h.id) < ($4, $5)`;
        }

        const query = `
          SELECT
            h.id,
            h.project_id as "projectId",
            h.root_id as "rootId",
            h.version,
            h.title,
            h.recipient_id as "recipientId",
            pr.display_name as "recipientName",
            h.departing_user_id as "departingUserId",
            pdep.display_name as "departingUserName",
            h.created_by as "createdBy",
            h.status,
            h.generated_access_epoch as "generatedAccessEpoch",
            h.approved_access_epoch as "approvedAccessEpoch",
            h.approved_by as "approvedBy",
            h.approved_at as "approvedAt",
            h.shared_at as "sharedAt",
            h.shared_by as "sharedBy",
            h.row_version as "rowVersion",
            h.created_at as "createdAt",
            h.updated_at as "updatedAt",
            ha.acknowledged_at as "acknowledgedAt",
            (SELECT count(*)::int FROM public.handover_items hi WHERE hi.handover_id = h.id) as "itemCount"
          FROM public.handovers h
          LEFT JOIN public.profiles pr ON pr.id = h.recipient_id
          LEFT JOIN public.profiles pdep ON pdep.id = h.departing_user_id
          LEFT JOIN public.handover_acknowledgements ha ON ha.handover_id = h.id AND ha.user_id = h.recipient_id
          WHERE h.project_id = $1
            AND app_private.can_read_handover(h.id, $2) = true
            ${cursorClause}
          ORDER BY h.created_at DESC, h.id DESC
          LIMIT $3
        `;

        const dbRes = await pool.query(query, values);
        const hasMore = dbRes.rows.length > limit;
        const items = hasMore ? dbRes.rows.slice(0, limit) : dbRes.rows;

        let nextCursor: string | null = null;
        if (hasMore && items.length > 0) {
          const lastItem = items[items.length - 1];
          nextCursor = encodeCursor(new Date(lastItem.createdAt).toISOString(), lastItem.id);
        }

        res.json({
          data: items,
          page: {
            nextCursor,
            hasMore,
          },
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /handovers/:id ────────────────────────────────────────────────────
  router.get(
    '/handovers/:id',
    requireAction(pool, 'HANDOVER_VIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const userId = req.user!.id;

        // Fetch handover with project epoch
        const hRes = await pool.query(
          `SELECT
             h.*,
             pr.display_name as "recipientName",
             pdep.display_name as "departingUserName",
             p.access_epoch as "currentProjectEpoch",
             ha.acknowledged_at as "acknowledgedAt"
           FROM public.handovers h
           JOIN public.projects p ON p.id = h.project_id
           LEFT JOIN public.profiles pr ON pr.id = h.recipient_id
           LEFT JOIN public.profiles pdep ON pdep.id = h.departing_user_id
           LEFT JOIN public.handover_acknowledgements ha ON ha.handover_id = h.id AND ha.user_id = h.recipient_id
           WHERE h.id = $1`,
          [handoverId]
        );

        if (hRes.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const h = hRes.rows[0];
        const projectId = h.project_id;
        const isRecipient = h.recipient_id === userId;
        const isReviewer =
          req.user!.projectMemberships.has(projectId) &&
          ['owner', 'reviewer'].includes(req.user!.projectMemberships.get(projectId)!.role);

        // Security check: only reviewers/owners or the designated recipient may view this handover
        if (!isRecipient && !isReviewer) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const currentEpoch = BigInt(h.currentProjectEpoch);
        const genEpoch = BigInt(h.generated_access_epoch);
        const appEpoch = h.approved_access_epoch ? BigInt(h.approved_access_epoch) : null;

        const isEpochStale =
          genEpoch !== currentEpoch || (h.status === 'shared' && appEpoch !== currentEpoch);

        // Recipient handling per Section 2A.9 item 3
        if (isRecipient && !isReviewer) {
          if (h.status !== 'shared' || isEpochStale) {
            res.status(409).json({
              error: {
                code: 'REGENERATION_REQUIRED',
                message:
                  'The requested handover is no longer valid due to an access policy change and must be regenerated.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }

          // Check if any non-rejected item's cited claim is no longer readable by recipient
          const claimCheck = await pool.query(
            `SELECT 1
             FROM public.handover_items hi
             JOIN public.handover_item_claims hic ON hic.item_id = hi.id
             WHERE hi.handover_id = $1
               AND hi.review_state <> 'rejected'
               AND not app_private.can_read_claim(hic.claim_id, $2) = true
             LIMIT 1`,
            [handoverId, userId]
          );

          if (claimCheck.rows.length > 0) {
            res.status(409).json({
              error: {
                code: 'REGENERATION_REQUIRED',
                message:
                  'The requested handover is no longer valid due to an access policy change and must be regenerated.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
        }

        // Reviewer handling
        if (isReviewer) {
          // If reviewer cannot read every cited claim, 404 (SPEC Section 2A.2 line 92)
          const reviewerClaimCheck = await pool.query(
            `SELECT 1
             FROM public.handover_items hi
             JOIN public.handover_item_claims hic ON hic.item_id = hi.id
             WHERE hi.handover_id = $1
               AND not app_private.can_read_claim(hic.claim_id, $2) = true
             LIMIT 1`,
            [handoverId, userId]
          );

          if (reviewerClaimCheck.rows.length > 0) {
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: 'Resource not found.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }

          // If epoch is stale, return metadata only (SPEC Section 2A.9 item 3)
          if (isEpochStale) {
            res.json({
              data: {
                id: h.id,
                projectId: h.project_id,
                rootId: h.root_id,
                version: h.version,
                title: h.title,
                recipientId: h.recipient_id,
                recipientName: h.recipientName,
                departingUserId: h.departing_user_id,
                departingUserName: h.departingUserName,
                createdBy: h.created_by,
                status: 'stale',
                generatedAccessEpoch: String(h.generated_access_epoch),
                approvedAccessEpoch: h.approved_access_epoch
                  ? String(h.approved_access_epoch)
                  : null,
                approvedBy: h.approved_by,
                approvedAt: h.approved_at,
                sharedAt: h.shared_at,
                sharedBy: h.shared_by,
                rowVersion: h.row_version,
                createdAt: h.created_at,
                updatedAt: h.updated_at,
                configuration: h.configuration,
                items: [],
                isStale: true,
                reasonCode: 'ACCESS_CHANGED',
                acknowledgedAt: h.acknowledgedAt ?? null,
              },
              requestId: req.id,
            });
            return;
          }
        }

        // Query accessible items
        const itemsRes = await pool.query(
          `SELECT
             hi.id,
             hi.handover_id as "handoverId",
             hi.project_id as "projectId",
             hi.section,
             hi.ordinal,
             hi.text,
             hi.item_kind as "itemKind",
             hi.evidence_state as "evidenceState",
             hi.review_state as "reviewState",
             hi.original_text as "originalText",
             hi.edited_by as "editedBy",
             hi.edited_at as "editedAt",
             hi.row_version as "rowVersion",
             coalesce(
               array_agg(hic.claim_id) filter (where hic.claim_id is not null),
               '{}'
             ) as "claimIds",
             coalesce(
               json_agg(
                 json_build_object(
                   'claimId', c.id,
                   'statement', c.statement,
                   'evidenceState', c.evidence_state,
                   'quote', ce.quote,
                   'sourceTitle', s.title,
                   'chunkId', ce.chunk_id,
                   'quoteStart', ce.quote_start,
                   'quoteEnd', ce.quote_end
                 )
               ) filter (where c.id is not null),
               '[]'
             ) as citations
           FROM public.handover_items hi
           LEFT JOIN public.handover_item_claims hic ON hic.item_id = hi.id
           LEFT JOIN public.claims c ON c.id = hic.claim_id AND app_private.can_read_claim(c.id, $2) = true
           LEFT JOIN public.claim_evidence ce ON ce.claim_id = c.id
           LEFT JOIN public.source_chunks sc ON sc.id = ce.chunk_id
           LEFT JOIN public.sources s ON s.id = sc.source_id AND app_private.can_read_source(s.id, $2) = true
           WHERE hi.handover_id = $1
           GROUP BY hi.id
           ORDER BY hi.section, hi.ordinal ASC`,
          [handoverId, userId]
        );

        let items = itemsRes.rows;
        // If recipient viewing shared handover, only show approved items
        if (isRecipient && !isReviewer) {
          items = items.filter((i) => i.reviewState === 'approved');
        }

        res.json({
          data: {
            id: h.id,
            projectId: h.project_id,
            rootId: h.root_id,
            version: h.version,
            title: h.title,
            recipientId: h.recipient_id,
            recipientName: h.recipientName,
            departingUserId: h.departing_user_id,
            departingUserName: h.departingUserName,
            createdBy: h.created_by,
            status: h.status,
            generatedAccessEpoch: String(h.generated_access_epoch),
            approvedAccessEpoch: h.approved_access_epoch ? String(h.approved_access_epoch) : null,
            approvedBy: h.approved_by,
            approvedAt: h.approved_at,
            sharedAt: h.shared_at,
            sharedBy: h.shared_by,
            rowVersion: h.row_version,
            createdAt: h.created_at,
            updatedAt: h.updated_at,
            acknowledgedAt: h.acknowledgedAt ?? null,
            configuration: h.configuration,
            items,
            isStale: false,
          },
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── PATCH /handovers/:id/items/:itemId ────────────────────────────────────
  router.patch(
    '/handovers/:id/items/:itemId',
    requireAction(pool, 'HANDOVER_REVIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const itemId = req.params.itemId as string;
        const ifMatch = req.header('if-match');

        if (!ifMatch) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'If-Match header with integer row_version is required',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const expectedRowVersion = parseInt(ifMatch, 10);
        if (isNaN(expectedRowVersion)) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'If-Match header must be a valid integer row_version',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const parseResult = UpdateHandoverItemSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid item update payload',
              details: parseResult.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { reviewState, text, comment } = parseResult.data;

        try {
          const updated = await updateHandoverItem(pool, {
            actorId: req.user!.id,
            handoverId,
            itemId,
            expectedRowVersion,
            reviewState: reviewState || null,
            text: text || null,
            comment: comment || null,
          });

          res.json({
            data: updated,
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('VERSION_CONFLICT')) {
            res.status(409).json({
              error: {
                code: 'VERSION_CONFLICT',
                message: 'Item has been modified concurrently. Please reload.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('STALE_ACCESS_EPOCH')) {
            res.status(409).json({
              error: {
                code: 'STALE_CONTEXT',
                message: 'Handover is stale due to an access policy change.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('FACTS_REQUIRE_EVIDENCE')) {
            res.status(422).json({
              error: {
                code: 'VALIDATION_ERROR',
                message: 'Facts and suggestions must retain at least one supporting claim link.',
                details: [],
              },
              requestId: req.id,
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

  // ─── POST /handovers/:id/items ─────────────────────────────────────────────
  router.post(
    '/handovers/:id/items',
    requireAction(pool, 'HANDOVER_REVIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const parseResult = AddItemFromClaimsSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid item creation payload',
              details: parseResult.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { section, ordinal, text, itemKind, claimIds } = parseResult.data;

        try {
          const newItem = await addItemFromClaims(pool, {
            actorId: req.user!.id,
            handoverId,
            section,
            ordinal: ordinal ?? null,
            text,
            itemKind,
            claimIds,
          });

          res.status(201).json({
            data: newItem,
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('ACCESS_VALIDATION_FAILED')) {
            res.status(409).json({
              error: {
                code: 'ACCESS_VALIDATION_FAILED',
                message:
                  'One or more cited claims are not accessible to both reviewer and recipient.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('STALE_ACCESS_EPOCH')) {
            res.status(409).json({
              error: {
                code: 'STALE_CONTEXT',
                message: 'Handover is stale due to an access policy change.',
                details: [],
              },
              requestId: req.id,
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

  // ─── POST /handovers/:id/context ───────────────────────────────────────────
  router.post(
    '/handovers/:id/context',
    requireAction(pool, 'HANDOVER_REVIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const parseResult = AddReviewerContextSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid reviewer context payload',
              details: parseResult.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { title, content, format, visibility, grantUserIds } = parseResult.data;

        const result = await addReviewerContext(pool, {
          actorId: req.user!.id,
          handoverId,
          title,
          content,
          format,
          visibility,
          grantUserIds,
        });

        res.status(201).json({
          data: result,
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── POST /handovers/:id/versions ──────────────────────────────────────────
  router.post(
    '/handovers/:id/versions',
    requireAction(pool, 'HANDOVER_REVIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;

        try {
          const rev = await createRevision(pool, req.user!.id, handoverId);
          res.status(201).json({
            data: rev,
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('ILLEGAL_STATE')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'Only approved or shared handovers can be revised.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('ACCESS_VALIDATION_FAILED')) {
            res.status(409).json({
              error: {
                code: 'ACCESS_VALIDATION_FAILED',
                message: 'Cited claims are no longer accessible to recipient.',
                details: [],
              },
              requestId: req.id,
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

  // ─── POST /handovers/:id/approve ───────────────────────────────────────────
  router.post(
    '/handovers/:id/approve',
    requireAction(pool, 'HANDOVER_APPROVE', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const parseResult = ApproveHandoverSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid approval payload',
              details: parseResult.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { confirmReviewedForRecipient, comment } = parseResult.data;
        if (!confirmReviewedForRecipient) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Confirmation that handover was reviewed for recipient is required.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        try {
          const appRes = await approveHandover(pool, {
            actorId: req.user!.id,
            handoverId,
            confirmReviewedForRecipient: true,
            comment: comment || null,
          });

          res.json({
            data: appRes,
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('PENDING_ITEMS_EXIST')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'All items must be reviewed (approved or rejected) before approval.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('NO_APPROVED_ITEMS')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'At least one item must be approved to approve the handover.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('FACTS_REQUIRE_EVIDENCE')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'Approved facts and suggestions must link to supporting claims.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('STALE_ACCESS_EPOCH')) {
            res.status(409).json({
              error: {
                code: 'STALE_CONTEXT',
                message: 'Project access policy has changed. Regeneration is required.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('ACCESS_VALIDATION_FAILED')) {
            res.status(409).json({
              error: {
                code: 'ACCESS_VALIDATION_FAILED',
                message: 'One or more cited claims cannot be read by the recipient or reviewer.',
                details: [],
              },
              requestId: req.id,
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

  // ─── POST /handovers/:id/share ─────────────────────────────────────────────
  router.post(
    '/handovers/:id/share',
    requireAction(pool, 'HANDOVER_SHARE', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;

        try {
          const shareRes = await shareHandover(pool, req.user!.id, handoverId);
          res.json({
            data: shareRes,
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('ILLEGAL_STATE')) {
            res.status(409).json({
              error: {
                code: 'ILLEGAL_STATE',
                message: 'Handover must be in approved status before it can be shared.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('STALE_ACCESS_EPOCH')) {
            res.status(409).json({
              error: {
                code: 'STALE_CONTEXT',
                message:
                  'Project access policy has changed. Re-approval or regeneration is required.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('ACCESS_VALIDATION_FAILED')) {
            res.status(409).json({
              error: {
                code: 'ACCESS_VALIDATION_FAILED',
                message: 'One or more cited claims cannot be read by the recipient.',
                details: [],
              },
              requestId: req.id,
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

  // ─── POST /handovers/:id/acknowledge ──────────────────────────────────────
  router.post(
    '/handovers/:id/acknowledge',
    requireAction(pool, 'HANDOVER_ACKNOWLEDGE', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const actorId = req.user!.id;

        try {
          const ackRes = await acknowledgeHandover(pool, actorId, handoverId);
          res.status(200).json({
            data: {
              id: ackRes.id,
              handoverId: ackRes.handover_id,
              userId: ackRes.user_id,
              acknowledgedAt: ackRes.acknowledged_at,
            },
            requestId: req.id,
          });
        } catch (err: unknown) {
          const errMsg = (err as Error).message || String(err);
          if (errMsg.includes('HANDOVER_NOT_FOUND') || errMsg.includes('PROJECT_NOT_FOUND')) {
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: 'Resource not found.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('FORBIDDEN')) {
            res.status(403).json({
              error: {
                code: 'FORBIDDEN',
                message: 'You do not have permission to acknowledge this handover.',
                details: [],
              },
              requestId: req.id,
            });
            return;
          }
          if (errMsg.includes('REGENERATION_REQUIRED')) {
            res.status(409).json({
              error: {
                code: 'REGENERATION_REQUIRED',
                message:
                  'The requested handover is no longer valid due to an access policy change and must be regenerated.',
                details: [],
              },
              requestId: req.id,
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

  // ─── GET /handovers/:id/reviews ────────────────────────────────────────────
  router.get(
    '/handovers/:id/reviews',
    requireAction(pool, 'HANDOVER_VIEW', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;

        const revRes = await pool.query(
          `SELECT
             r.id,
             r.handover_id as "handoverId",
             r.item_id as "itemId",
             r.reviewer_id as "reviewerId",
             pr.display_name as "reviewerName",
             r.action,
             r.comment,
             r.confirmed_reviewed_for_recipient as "confirmedReviewedForRecipient",
             r.created_at as "createdAt"
           FROM public.reviews r
           LEFT JOIN public.profiles pr ON pr.id = r.reviewer_id
           WHERE r.handover_id = $1
           ORDER BY r.created_at ASC`,
          [handoverId]
        );

        res.json({
          data: revRes.rows,
          requestId: req.id,
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // ─── GET /handovers/:id/export ─────────────────────────────────────────────
  router.get(
    '/handovers/:id/export',
    requireAction(pool, 'HANDOVER_EXPORT', (req) => ({ handoverId: req.params.id })),
    async (req, res, next) => {
      try {
        const handoverId = req.params.id as string;
        const userId = req.user!.id;

        const parseQuery = ExportHandoverQuerySchema.safeParse(req.query);
        if (!parseQuery.success) {
          res.status(400).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid export query parameters. Supported formats: md, pdf.',
              details: parseQuery.error.errors,
            },
            requestId: req.id,
          });
          return;
        }

        const { format } = parseQuery.data;

        // Fetch handover with project info & epoch
        const hRes = await pool.query(
          `SELECT
             h.*,
             pr.display_name as "recipientName",
             pdep.display_name as "departingUserName",
             p.access_epoch as "currentProjectEpoch",
             p.organisation_id as "organisationId"
           FROM public.handovers h
           JOIN public.projects p ON p.id = h.project_id
           LEFT JOIN public.profiles pr ON pr.id = h.recipient_id
           LEFT JOIN public.profiles pdep ON pdep.id = h.departing_user_id
           WHERE h.id = $1`,
          [handoverId]
        );

        if (hRes.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        const h = hRes.rows[0];

        // Validity Check 1: Handover status must be 'approved' or 'shared' (SPEC Section 2A.9 item 2)
        if (h.status !== 'approved' && h.status !== 'shared') {
          res.status(409).json({
            error: {
              code: 'REGENERATION_REQUIRED',
              message: 'Only approved or shared handovers can be exported.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // Validity Check 2: Access epochs must match current project access epoch
        const currentEpoch = BigInt(h.currentProjectEpoch);
        const genEpoch = BigInt(h.generated_access_epoch);
        const appEpoch = h.approved_access_epoch ? BigInt(h.approved_access_epoch) : null;

        if (genEpoch !== currentEpoch || (h.approved_access_epoch && appEpoch !== currentEpoch)) {
          res.status(409).json({
            error: {
              code: 'REGENERATION_REQUIRED',
              message:
                'The requested handover is stale due to an access policy change and must be regenerated.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // Validity Check 3: Check active project ownership and recipient membership
        const memberCheck = await pool.query(
          `SELECT
             (SELECT count(*) FROM public.project_members WHERE project_id = $1 AND role = 'owner' AND active = true) as owner_count,
             (SELECT count(*) FROM public.project_members WHERE project_id = $1 AND user_id = $2 AND active = true) as recip_count`,
          [h.project_id, h.recipient_id]
        );
        if (
          parseInt(memberCheck.rows[0].owner_count, 10) < 1 ||
          parseInt(memberCheck.rows[0].recip_count, 10) < 1
        ) {
          res.status(409).json({
            error: {
              code: 'REGENERATION_REQUIRED',
              message:
                'Handover is invalid because project ownership or recipient membership is missing.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // Validity Check 4: Caller must be able to read all cited claims in non-rejected items
        const claimCheck = await pool.query(
          `SELECT 1
           FROM public.handover_items hi
           JOIN public.handover_item_claims hic ON hic.item_id = hi.id
           WHERE hi.handover_id = $1
             AND hi.review_state <> 'rejected'
             AND not app_private.can_read_claim(hic.claim_id, $2) = true
           LIMIT 1`,
          [handoverId, userId]
        );

        if (claimCheck.rows.length > 0) {
          res.status(409).json({
            error: {
              code: 'REGENERATION_REQUIRED',
              message: 'The requested handover cites evidence that is no longer accessible to you.',
              details: [],
            },
            requestId: req.id,
          });
          return;
        }

        // Fetch accessible items with citations
        const itemsRes = await pool.query(
          `SELECT
             hi.id,
             hi.handover_id as "handoverId",
             hi.project_id as "projectId",
             hi.section,
             hi.ordinal,
             hi.text,
             hi.item_kind as "itemKind",
             hi.evidence_state as "evidenceState",
             hi.review_state as "reviewState",
             hi.original_text as "originalText",
             hi.edited_by as "editedBy",
             hi.edited_at as "editedAt",
             hi.row_version as "rowVersion",
             coalesce(
               array_agg(hic.claim_id) filter (where hic.claim_id is not null),
               '{}'
             ) as "claimIds",
             coalesce(
               json_agg(
                 json_build_object(
                   'claimId', c.id,
                   'statement', c.statement,
                   'evidenceState', c.evidence_state,
                   'quote', ce.quote,
                   'sourceTitle', s.title,
                   'chunkId', ce.chunk_id,
                   'quoteStart', ce.quote_start,
                   'quoteEnd', ce.quote_end
                 )
               ) filter (where c.id is not null),
               '[]'
             ) as citations
           FROM public.handover_items hi
           LEFT JOIN public.handover_item_claims hic ON hic.item_id = hi.id
           LEFT JOIN public.claims c ON c.id = hic.claim_id AND app_private.can_read_claim(c.id, $2) = true
           LEFT JOIN public.claim_evidence ce ON ce.claim_id = c.id
           LEFT JOIN public.source_chunks sc ON sc.id = ce.chunk_id
           LEFT JOIN public.sources s ON s.id = sc.source_id AND app_private.can_read_source(s.id, $2) = true
           WHERE hi.handover_id = $1
           GROUP BY hi.id
           ORDER BY hi.section, hi.ordinal ASC`,
          [handoverId, userId]
        );

        const handoverDetail: HandoverDetail = {
          id: h.id,
          projectId: h.project_id,
          rootId: h.root_id,
          version: h.version,
          title: h.title,
          recipientId: h.recipient_id,
          recipientName: h.recipientName,
          departingUserId: h.departing_user_id,
          departingUserName: h.departingUserName,
          createdBy: h.created_by,
          status: h.status,
          generatedAccessEpoch: String(h.generated_access_epoch),
          approvedAccessEpoch: h.approved_access_epoch ? String(h.approved_access_epoch) : null,
          approvedBy: h.approved_by,
          approvedAt: h.approved_at,
          sharedAt: h.shared_at,
          sharedBy: h.shared_by,
          rowVersion: h.row_version,
          createdAt: h.created_at,
          updatedAt: h.updated_at,
          configuration: h.configuration,
          items: itemsRes.rows,
          isStale: false,
        };

        const exportMetadata: ExportMetadata = {
          exportedAt: new Date().toISOString(),
        };

        // Write audit event (identifiers only, per SPEC 2A.14)
        await pool.query(
          `INSERT INTO public.audit_events (organisation_id, project_id, actor_id, action, entity_type, entity_id, metadata)
           VALUES ($1, $2, $3, 'handover.export', 'handover', $4, $5)`,
          [
            h.organisationId,
            h.project_id,
            userId,
            h.id,
            JSON.stringify({
              handoverId: h.id,
              rootId: h.root_id,
              version: h.version,
              format,
              recipientId: h.recipient_id,
            }),
          ]
        );

        // Build safe filename: relay-handover-${slug}-v${version}.${format}
        const titleStr = h.title || h.configuration?.title || 'handover';
        const slug =
          titleStr
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '')
            .slice(0, 50) || 'handover';
        const filename = `relay-handover-${slug}-v${h.version}.${format}`;

        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        if (format === 'md') {
          const markdownContent = renderHandoverMarkdown(handoverDetail, exportMetadata);
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
          res.send(markdownContent);
        } else {
          const pdfBuffer = await renderHandoverPdf(handoverDetail, exportMetadata);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Length', pdfBuffer.length);
          res.send(pdfBuffer);
        }
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
