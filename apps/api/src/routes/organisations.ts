import crypto from 'node:crypto';
import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  type DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  updateOrgMember,
} from '@relay/database';
import {
  createOrgSchema,
  addOrgMemberSchema,
  updateOrgMemberSchema,
  createProjectSchema,
  PaginationQuerySchema,
  UuidSchema,
} from '@relay/contracts';
import { requireAction } from '../auth/authorisation.js';
import { encodeCursor, decodeCursor } from '../lib/pagination.js';

export function createOrganisationsRouter(pool: DbPool): Router {
  const router = Router();

  // POST /organisations - Transactional bootstrap
  router.post('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const parsed = createOrgSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid organisation data.',
            details: parsed.error.issues,
          },
          requestId: String(req.id || 'unknown'),
        });
        return;
      }

      const orgId = await bootstrapOrganisation(pool, user.id, parsed.data.name);

      // Refresh caller's org memberships map
      user.orgMemberships.set(orgId, 'owner');

      const orgRes = await pool.query(
        'SELECT id, name, created_at as "createdAt" FROM public.organisations WHERE id = $1',
        [orgId]
      );

      res.status(201).json({
        data: {
          ...orgRes.rows[0],
          role: 'owner',
        },
        requestId: String(req.id || 'unknown'),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /organisations - Accessible organisations (cursor paginated)
  router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
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
        SELECT o.id, o.name, om.role, o.created_at as "createdAt"
        FROM public.organisation_members om
        JOIN public.organisations o ON o.id = om.organisation_id
        WHERE om.user_id = $1 AND om.active = true
      `;
      const params: unknown[] = [user.id];

      if (decoded) {
        const [sortKey, id] = decoded;
        params.push(sortKey, id);
        query += ` AND (o.created_at, o.id) < ($${params.length - 1}, $${params.length})`;
      }

      params.push(limit + 1);
      query += ` ORDER BY o.created_at DESC, o.id DESC LIMIT $${params.length}`;

      const result = await pool.query(query, params);
      const rows = result.rows;
      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;

      let nextCursor: string | null = null;
      if (hasMore && data.length > 0) {
        const last = data[data.length - 1];
        nextCursor = encodeCursor(last.createdAt, last.id);
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
  });

  // GET /organisations/:id/members - Authorised membership list
  router.get(
    '/:id/members',
    requireAction(pool, 'ORG_VIEW', (req) => ({ orgId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const orgId = req.params.id as string;
        const validUuid = UuidSchema.safeParse(orgId);
        if (!validUuid.success) {
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

        const callerRole = req.user!.orgMemberships.get(orgId);
        const isAdminOrOwner = callerRole === 'owner' || callerRole === 'admin';

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
            om.user_id as "userId",
            p.display_name as "displayName",
            om.role,
            om.active,
            om.created_at as "createdAt"
            ${isAdminOrOwner ? ', u.email' : ''}
          FROM public.organisation_members om
          JOIN public.profiles p ON p.id = om.user_id
          ${isAdminOrOwner ? 'LEFT JOIN auth.users u ON u.id = om.user_id' : ''}
          WHERE om.organisation_id = $1
        `;
        const params: unknown[] = [orgId];

        if (decoded) {
          const [sortKey, id] = decoded;
          params.push(sortKey, id);
          query += ` AND (om.created_at, om.user_id) < ($${params.length - 1}, $${params.length})`;
        }

        params.push(limit + 1);
        query += ` ORDER BY om.created_at DESC, om.user_id DESC LIMIT $${params.length}`;

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

  // POST /organisations/:id/members - Add verified existing account (non-enumerating)
  router.post(
    '/:id/members',
    requireAction(pool, 'ORG_MANAGE_MEMBERS', (req) => ({ orgId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const orgId = req.params.id as string;
        const validUuid = UuidSchema.safeParse(orgId);
        if (!validUuid.success) {
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

        const parsed = addOrgMemberSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid member data.',
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
          await addOrgMember(pool, req.user!.id, orgId, targetUserId, role);
        } else {
          // Perform dummy work of identical computational cost
          crypto.pbkdf2Sync(dummyHash, 'salt', 100, 32, 'sha256');
        }

        // Return same generic success response per Section 2A.2
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

  // PATCH /organisations/:id/members/:userId - Update role/active state
  router.patch(
    '/:id/members/:userId',
    requireAction(pool, 'ORG_MANAGE_MEMBERS', (req) => ({ orgId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const orgId = req.params.id as string;
        const targetUserId = req.params.userId as string;
        if (!UuidSchema.safeParse(orgId).success || !UuidSchema.safeParse(targetUserId).success) {
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

        const parsed = updateOrgMemberSchema.safeParse(req.body);
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

        try {
          await updateOrgMember(pool, req.user!.id, orgId, targetUserId, role, active);
        } catch (err: any) {
          if (err?.message?.includes('LAST_OWNER')) {
            res.status(409).json({
              error: {
                code: 'LAST_OWNER',
                message: 'Cannot demote or deactivate the last active owner of the organisation.',
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

  // POST /organisations/:id/projects - Create project
  router.post(
    '/:id/projects',
    requireAction(pool, 'ORG_CREATE_PROJECT', (req) => ({ orgId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const orgId = req.params.id as string;
        const validUuid = UuidSchema.safeParse(orgId);
        if (!validUuid.success) {
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

        const parsed = createProjectSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(422).json({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid project data.',
              details: parsed.error.issues,
            },
            requestId: String(req.id || 'unknown'),
          });
          return;
        }

        const { name, description, domain, timezone } = parsed.data;

        const projectId = await createProject(
          pool,
          req.user!.id,
          orgId,
          name,
          description,
          domain,
          timezone
        );

        // Update user project memberships map
        req.user!.projectMemberships.set(projectId, {
          role: 'owner',
          orgId,
        });

        const projRes = await pool.query(
          `SELECT id, organisation_id as "organisationId", name, description, domain, timezone, access_epoch as "accessEpoch", created_at as "createdAt"
           FROM public.projects WHERE id = $1`,
          [projectId]
        );

        res.status(201).json({
          data: {
            ...projRes.rows[0],
            role: 'owner',
          },
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  // GET /organisations/:id/projects - List projects in organisation per 2A.2
  router.get(
    '/:id/projects',
    requireAction(pool, 'ORG_VIEW', (req) => ({ orgId: req.params.id })),
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const orgId = req.params.id as string;
        const validUuid = UuidSchema.safeParse(orgId);
        if (!validUuid.success) {
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

        const callerRole = req.user!.orgMemberships.get(orgId);
        const isAdminOrOwner = callerRole === 'owner' || callerRole === 'admin';

        let result;
        if (isAdminOrOwner) {
          result = await pool.query(
            `SELECT p.id, p.organisation_id as "organisationId", p.name, p.domain, p.description, p.created_at as "createdAt"
             FROM public.projects p
             WHERE p.organisation_id = $1
             ORDER BY p.name ASC`,
            [orgId]
          );
        } else {
          result = await pool.query(
            `SELECT p.id, p.organisation_id as "organisationId", p.name, p.domain, p.description, p.created_at as "createdAt"
             FROM public.projects p
             JOIN public.project_members pm ON pm.project_id = p.id
             WHERE p.organisation_id = $1 AND pm.user_id = $2 AND pm.active = true
             ORDER BY p.name ASC`,
            [orgId, req.user!.id]
          );
        }

        res.status(200).json({
          data: result.rows,
          requestId: String(req.id || 'unknown'),
        });
      } catch (err) {
        next(err);
      }
    }
  );

  return router;
}
