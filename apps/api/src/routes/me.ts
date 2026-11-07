import { Router, type Request, type Response, type NextFunction } from 'express';
import type { DbPool } from '@relay/database';
import { updateProfileSchema } from '@relay/contracts';

export function createMeRouter(pool: DbPool): Router {
  const router = Router();

  // GET /me - Returns authenticated user account, display name, and active memberships
  router.get('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;

      // Fetch user's active organisation memberships with org details
      const orgsRes = await pool.query(
        `SELECT o.id, o.name, om.role, o.created_at as "createdAt"
         FROM public.organisation_members om
         JOIN public.organisations o ON o.id = om.organisation_id
         WHERE om.user_id = $1 AND om.active = true
         ORDER BY o.name ASC`,
        [user.id]
      );

      // Fetch user's active project memberships with project details
      const projsRes = await pool.query(
        `SELECT p.id, p.organisation_id as "organisationId", p.name, p.domain, pm.role, p.created_at as "createdAt"
         FROM public.project_members pm
         JOIN public.projects p ON p.id = pm.project_id
         JOIN public.organisation_members om ON om.organisation_id = p.organisation_id AND om.user_id = pm.user_id
         WHERE pm.user_id = $1 AND pm.active = true AND om.active = true
         ORDER BY p.name ASC`,
        [user.id]
      );

      res.status(200).json({
        data: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          organisations: orgsRes.rows,
          projects: projsRes.rows,
        },
        requestId: String(req.id || 'unknown'),
      });
    } catch (err) {
      next(err);
    }
  });

  // PATCH /me - Updates display name
  router.patch('/', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const user = req.user!;
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(422).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid profile data.',
            details: parsed.error.issues,
          },
          requestId: String(req.id || 'unknown'),
        });
        return;
      }

      const { displayName } = parsed.data;

      const updateRes = await pool.query(
        `UPDATE public.profiles
         SET display_name = $1
         WHERE id = $2
         RETURNING id, display_name as "displayName"`,
        [displayName, user.id]
      );

      user.displayName = displayName;

      res.status(200).json({
        data: {
          id: user.id,
          email: user.email,
          displayName: updateRes.rows[0].displayName,
        },
        requestId: String(req.id || 'unknown'),
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
