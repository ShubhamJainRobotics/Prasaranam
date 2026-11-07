import type { Request, Response, NextFunction } from 'express';
import type { AuthenticatedUser } from '../middleware/auth.js';
import type { DbPool } from '@relay/database';

export type Action =
  | 'ORG_VIEW'
  | 'ORG_MANAGE_MEMBERS'
  | 'ORG_CREATE_PROJECT'
  | 'PROJECT_VIEW'
  | 'PROJECT_EDIT_SETTINGS'
  | 'PROJECT_MANAGE_MEMBERS'
  | 'PROJECT_VIEW_DASHBOARD';

export interface AuthorisationContext {
  orgId?: string;
  projectId?: string;
}

/**
 * Evaluates whether an authenticated user is authorized to perform an action.
 * Returns:
 *   - 'ALLOWED': permission granted
 *   - 'NOT_FOUND': the target resource does not exist or caller has no visibility into the parent
 *   - 'FORBIDDEN': caller has visibility into the parent, but their role forbids the action
 */
export async function authorizeAction(
  pool: DbPool,
  user: AuthenticatedUser,
  action: Action,
  context: AuthorisationContext
): Promise<'ALLOWED' | 'FORBIDDEN' | 'NOT_FOUND'> {
  const { orgId, projectId } = context;

  // Organisation-scoped actions
  if (action === 'ORG_VIEW' || action === 'ORG_MANAGE_MEMBERS' || action === 'ORG_CREATE_PROJECT') {
    if (!orgId) return 'NOT_FOUND';

    const orgRole = user.orgMemberships.get(orgId);
    if (!orgRole) {
      // User is not an active member of this organisation -> 404 (do not reveal existence)
      return 'NOT_FOUND';
    }

    if (action === 'ORG_VIEW') {
      return 'ALLOWED';
    }

    if (action === 'ORG_MANAGE_MEMBERS' || action === 'ORG_CREATE_PROJECT') {
      if (orgRole === 'owner' || orgRole === 'admin') {
        return 'ALLOWED';
      }
      return 'FORBIDDEN';
    }
  }

  // Project-scoped actions
  if (
    action === 'PROJECT_VIEW' ||
    action === 'PROJECT_EDIT_SETTINGS' ||
    action === 'PROJECT_MANAGE_MEMBERS' ||
    action === 'PROJECT_VIEW_DASHBOARD'
  ) {
    if (!projectId) return 'NOT_FOUND';

    // Look up project's organisation_id from the database
    const projRes = await pool.query(
      'SELECT id, organisation_id FROM public.projects WHERE id = $1',
      [projectId]
    );

    if (projRes.rows.length === 0) {
      return 'NOT_FOUND';
    }

    const projectOrgId = projRes.rows[0].organisation_id as string;
    const projectMembership = user.projectMemberships.get(projectId);
    const orgRole = user.orgMemberships.get(projectOrgId);

    // Can caller view the project?
    // Project member (active) OR org admin/owner of project's org (Section 2A.2)
    const canViewProject = Boolean(
      projectMembership || (orgRole && (orgRole === 'owner' || orgRole === 'admin'))
    );

    if (!canViewProject) {
      return 'NOT_FOUND';
    }

    if (action === 'PROJECT_VIEW' || action === 'PROJECT_VIEW_DASHBOARD') {
      return 'ALLOWED';
    }

    if (action === 'PROJECT_EDIT_SETTINGS' || action === 'PROJECT_MANAGE_MEMBERS') {
      if (projectMembership && projectMembership.role === 'owner') {
        return 'ALLOWED';
      }
      return 'FORBIDDEN';
    }
  }

  return 'NOT_FOUND';
}

/**
 * Express middleware helper to enforce action-based authorization.
 */
export function requireAction(
  pool: DbPool,
  action: Action,
  resolveContext: (req: Request) => AuthorisationContext
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required.',
          details: [],
        },
        requestId: String(req.id || 'unknown'),
      });
      return;
    }

    try {
      const context = resolveContext(req);
      const result = await authorizeAction(pool, req.user, action, context);

      if (result === 'NOT_FOUND') {
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

      if (result === 'FORBIDDEN') {
        res.status(403).json({
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have permission to perform this action.',
            details: [],
          },
          requestId: String(req.id || 'unknown'),
        });
        return;
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
