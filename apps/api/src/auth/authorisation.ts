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
  | 'PROJECT_VIEW_DASHBOARD'
  | 'PROJECT_IMPORT_SOURCES'
  | 'PROJECT_VIEW_SOURCES'
  | 'SOURCE_MANAGE_ACCESS'
  | 'SOURCE_ARCHIVE';

export interface AuthorisationContext {
  orgId?: string;
  projectId?: string;
  sourceId?: string;
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

  // Source-scoped & source-import actions
  if (action === 'PROJECT_IMPORT_SOURCES' || action === 'PROJECT_VIEW_SOURCES') {
    if (!projectId) return 'NOT_FOUND';

    const projectMembership = user.projectMemberships.get(projectId);
    if (!projectMembership) {
      return 'NOT_FOUND';
    }

    if (action === 'PROJECT_VIEW_SOURCES') {
      return 'ALLOWED';
    }

    if (action === 'PROJECT_IMPORT_SOURCES') {
      // owner, reviewer, contributor can import (SPEC 2A.2 line 80)
      if (
        projectMembership.role === 'owner' ||
        projectMembership.role === 'reviewer' ||
        projectMembership.role === 'contributor'
      ) {
        return 'ALLOWED';
      }
      return 'FORBIDDEN';
    }
  }

  if (action === 'SOURCE_MANAGE_ACCESS' || action === 'SOURCE_ARCHIVE') {
    let targetProjectId = projectId;

    if (!targetProjectId && context.sourceId) {
      const sourceRes = await pool.query(
        'SELECT project_id FROM public.sources WHERE id = $1 AND archived_at IS NULL',
        [context.sourceId]
      );
      if (sourceRes.rows.length === 0) {
        return 'NOT_FOUND';
      }
      targetProjectId = sourceRes.rows[0].project_id as string;
    }

    if (!targetProjectId) return 'NOT_FOUND';

    const projectMembership = user.projectMemberships.get(targetProjectId);
    if (!projectMembership) {
      return 'NOT_FOUND';
    }

    // Changing access or archiving requires project owner role (SPEC 2A.2 line 79)
    if (projectMembership.role === 'owner') {
      return 'ALLOWED';
    }
    return 'FORBIDDEN';
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
