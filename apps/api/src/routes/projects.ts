import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { type DbPool, addProjectMember, updateProjectMember } from '@relay/database';
import {
  updateProjectSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
  PaginationQuerySchema,
  UuidSchema,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';

export function createProjectsRouter(pool: DbPool): Router {
  const router = Router();

  // GET /projects/:id - Project summary
  router.get(
    '/:id',
    requireAction(pool, 'PROJECT_VIEW', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const result = await pool.query(
          `SELECT 
            id, 
            organisation_id as "organisationId", 
            name, 
            description, 
            domain, 
            timezone, 
            access_epoch as "accessEpoch", 
            created_at as "createdAt",
            updated_at as "updatedAt"
           FROM public.projects
           WHERE id = $1`,
          [projectId]
        );

        if (result.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const project = result.rows[0];
        const userRole = req.user!.projectMemberships.get(projectId)?.role || 'viewer';

        res.status(200).json({
          data: {
            ...project,
            role: userRole,
            currentUserRole: userRole,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /projects/:id - Edit project
  router.patch(
    '/:id',
    requireAction(pool, 'PROJECT_EDIT_SETTINGS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const parsed = updateProjectSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid project update data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const updates = parsed.data;
        const setClauses: string[] = [];
        const params: unknown[] = [projectId];

        if (updates.name !== undefined) {
          params.push(updates.name);
          setClauses.push(`name = $${params.length}`);
        }
        if (updates.description !== undefined) {
          params.push(updates.description);
          setClauses.push(`description = $${params.length}`);
        }
        if (updates.domain !== undefined) {
          params.push(updates.domain);
          setClauses.push(`domain = $${params.length}`);
        }
        if (updates.timezone !== undefined) {
          params.push(updates.timezone);
          setClauses.push(`timezone = $${params.length}`);
        }

        if (setClauses.length === 0) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'No fields provided to update.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const query = `
          UPDATE public.projects
          SET ${setClauses.join(', ')}
          WHERE id = $1
          RETURNING id, organisation_id as "organisationId", name, description, domain, timezone, access_epoch as "accessEpoch", updated_at as "updatedAt"
        `;

        const result = await pool.query(query, params);

        res.status(200).json({
          data: result.rows[0],
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /projects/:id/members - Accessible project members
  router.get(
    '/:id/members',
    requireAction(pool, 'PROJECT_VIEW', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const callerMembership = req.user!.projectMemberships.get(projectId);
        const isOwner = callerMembership?.role === 'owner';

        const parsedQuery = PaginationQuerySchema.safeParse(req.query);
        if (!parsedQuery.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid pagination query.',
              details: parsedQuery.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { cursor, limit } = parsedQuery.data;
        const decoded = decodeCursor(cursor);

        let query = `
          SELECT 
            pm.user_id as "userId",
            p.display_name as "displayName",
            pm.role,
            pm.active,
            pm.created_at as "createdAt"
            ${isOwner ? ', u.email' : ''}
          FROM public.project_members pm
          JOIN public.profiles p ON p.id = pm.user_id
          ${isOwner ? 'LEFT JOIN auth.users u ON u.id = pm.user_id' : ''}
          WHERE pm.project_id = $1
        `;
        const params: unknown[] = [projectId];

        if (decoded) {
          const [sortKey, id] = decoded;
          params.push(sortKey, id);
          query += ` AND (pm.created_at, pm.user_id) < ($${params.length - 1}, $${params.length})`;
        }

        params.push(limit + 1);
        query += ` ORDER BY pm.created_at DESC, pm.user_id DESC LIMIT $${params.length}`;

        const result = await pool.query(query, params);
        const rows = result.rows;
        const hasMore = rows.length > limit;
        const data = hasMore ? rows.slice(0, limit) : rows;

        let nextCursor: string | null = null;
        if (hasMore && data.length > 0) {
          const last = data[data.length - 1];
          nextCursor = encodeCursor(last.createdAt, last.userId);
        }

        res.status(200).json({
          data,
          page: {
            nextCursor,
            hasMore,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // POST /projects/:id/members - Add project member (non-enumerating)
  router.post(
    '/:id/members',
    requireAction(pool, 'PROJECT_MANAGE_MEMBERS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const parsed = addProjectMemberSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid project member data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { email, role } = parsed.data;

        // Constant amount of work to prevent timing side-channels
        const dummyHash = crypto.createHash('sha256').update(email).digest('hex');

        // Look up verified existing account
        const userRes = await pool.query(
          'SELECT id FROM auth.users WHERE email = $1 AND email_confirmed_at IS NOT NULL',
          [email.toLowerCase()]
        );

        if (userRes.rows.length > 0) {
          const targetUserId = userRes.rows[0].id;
          try {
            await addProjectMember(pool, req.user!.id, projectId, targetUserId, role);
          } catch {
            // If target is not an active org member or fails check, ignore silently per non-enumeration rule
          }
        } else {
          // Perform dummy work of identical computational cost
          crypto.pbkdf2Sync(dummyHash, 'salt', 100, 32, 'sha256');
        }

        res.status(200).json({
          data: {
            message: 'If an account exists with this email, the member has been added.',
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // PATCH /projects/:id/members/:userId - Change role / deactivate
  router.patch(
    '/:id/members/:userId',
    requireAction(pool, 'PROJECT_MANAGE_MEMBERS', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;
        const targetUserId = req.params.userId as string;
        if (
          !UuidSchema.safeParse(projectId).success ||
          !UuidSchema.safeParse(targetUserId).success
        ) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Resource not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const parsed = updateProjectMemberSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid member update data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { role, active } = parsed.data;

        const currentMember = await pool.query(
          'SELECT role, active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
          [projectId, targetUserId]
        );
        if (currentMember.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Member not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const effectiveRole = role ?? currentMember.rows[0].role;
        const effectiveActive = active ?? currentMember.rows[0].active;

        try {
          await updateProjectMember(
            pool,
            req.user!.id,
            projectId,
            targetUserId,
            effectiveRole,
            effectiveActive
          );
        } catch (err: any) {
          if (err?.message?.includes('LAST_OWNER')) {
            res.status(409).json({
              error: {
                code: 'LAST_OWNER',
                message: 'Cannot demote or deactivate the last active owner of the project.',
                details: [],
              },
              requestId: String(req.id || 'unknown'),
            });
            return;
          }
          if (err?.message?.includes('NOT_FOUND')) {
            res.status(404).json({
              error: {
                code: 'NOT_FOUND',
                message: 'Member not found.',
                details: [],
              },
              requestId: String(req.id || 'unknown'),
            });
            return;
          }
          throw err;
        }

        res.status(200).json({
          data: {
            userId: targetUserId,
            role,
            active,
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /projects/:id/dashboard - Access-filtered dashboard summary
  router.get(
    '/:id/dashboard',
    requireAction(pool, 'PROJECT_VIEW_DASHBOARD', (req) => ({ projectId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const projectId = req.params.id as string;

        // Fetch project info
        const projRes = await pool.query(
          `SELECT 
            id, 
            organisation_id as "organisationId", 
            name, 
            description, 
            domain, 
            timezone, 
            access_epoch as "accessEpoch", 
            created_at as "createdAt"
           FROM public.projects
           WHERE id = $1`,
          [projectId]
        );

        if (projRes.rows.length === 0) {
          res.status(404).json({
            error: {
              code: 'NOT_FOUND',
              message: 'Project not found.',
              details: [],
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        // Fetch member count
        const memberCountRes = await pool.query(
          'SELECT count(*) FROM public.project_members WHERE project_id = $1 AND active = true',
          [projectId]
        );
        const memberCount = Number(memberCountRes.rows[0].count);

        // Sources, claims, handovers, open questions counts (filtered by user access or 0 in initial phase)
        const sourcesCountRes = await pool.query(
          `SELECT count(*) FROM public.sources WHERE project_id = $1 AND archived_at IS NULL AND app_private.can_read_source(id, $2)`,
          [projectId, req.user!.id]
        );
        const sourcesCount = Number(sourcesCountRes.rows[0].count);

        const claimsCountRes = await pool.query(
          `SELECT count(*) FROM public.claims WHERE project_id = $1 AND archived_at IS NULL AND app_private.can_read_claim(id, $2)`,
          [projectId, req.user!.id]
        );
        const claimsCount = Number(claimsCountRes.rows[0].count);

        const handoversCountRes = await pool.query(
          `SELECT count(*) FROM public.handovers WHERE project_id = $1 AND app_private.can_read_handover(id, $2)`,
          [projectId, req.user!.id]
        );
        const handoversCount = Number(handoversCountRes.rows[0].count);

        const questionsCountRes = await pool.query(
          `SELECT count(*) FROM public.clarification_questions WHERE project_id = $1 AND status = 'open' AND app_private.can_read_question(id, $2)`,
          [projectId, req.user!.id]
        );
        const openQuestionsCount = Number(questionsCountRes.rows[0].count);

        res.status(200).json({
          data: {
            project: projRes.rows[0],
            memberCount,
            sourcesCount,
            claimsCount,
            handoversCount,
            openQuestionsCount,
            counts: {
              sources: sourcesCount,
              claims: claimsCount,
              handovers: handoversCount,
              questions: openQuestionsCount,
            },
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
