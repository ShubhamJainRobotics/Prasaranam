import type { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { ServerEnvironment } from '@relay/contracts';
import type { DbPool } from '@relay/database';

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  orgMemberships: Map<string, 'owner' | 'admin' | 'member'>;
  projectMemberships: Map<
    string,
    { role: 'owner' | 'reviewer' | 'contributor' | 'recipient'; orgId: string }
  >;
  token: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function createAuthMiddleware(env: ServerEnvironment, pool?: DbPool) {
  // Use Supabase client with service role key strictly for server-side user verification
  const supabase: SupabaseClient = createClient(
    env.SUPABASE_URL || 'http://127.0.0.1:54321',
    env.SUPABASE_SERVICE_ROLE_KEY || '',
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    }
  );

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header.',
          details: [],
        },
        requestId: String(req.id || 'unknown'),
      });
      return;
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing token in Authorization header.',
          details: [],
        },
        requestId: String(req.id || 'unknown'),
      });
      return;
    }

    try {
      // 1. Server-side verification using Supabase auth.getUser(token) per 2A.1
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Invalid or expired access token.',
            details: [],
          },
          requestId: String(req.id || 'unknown'),
        });
        return;
      }

      const authUser = data.user;

      // 2. Reject unconfirmed emails per 2A.1
      if (!authUser.email_confirmed_at) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'Email address has not been confirmed.',
            details: [],
          },
          requestId: String(req.id || 'unknown'),
        });
        return;
      }

      const userId = authUser.id;
      const userEmail = authUser.email || '';
      let displayName = (authUser.user_metadata?.display_name as string) || 'User';

      const orgMemberships = new Map<string, 'owner' | 'admin' | 'member'>();
      const projectMemberships = new Map<
        string,
        { role: 'owner' | 'reviewer' | 'contributor' | 'recipient'; orgId: string }
      >();

      // 3. Load profile and memberships from the database on every request per 2A.1
      if (pool) {
        // Fetch display name from profiles
        const profileRes = await pool.query(
          'SELECT display_name FROM public.profiles WHERE id = $1',
          [userId]
        );
        if (profileRes.rows.length > 0 && profileRes.rows[0].display_name) {
          displayName = profileRes.rows[0].display_name;
        }

        // Fetch active org memberships
        const orgRes = await pool.query(
          'SELECT organisation_id, role FROM public.organisation_members WHERE user_id = $1 AND active = true',
          [userId]
        );
        for (const row of orgRes.rows) {
          orgMemberships.set(row.organisation_id, row.role);
        }

        // Fetch active project memberships (must also have active org membership per 2A.2)
        const projRes = await pool.query(
          `SELECT pm.project_id, pm.role, p.organisation_id
           FROM public.project_members pm
           JOIN public.projects p ON p.id = pm.project_id
           JOIN public.organisation_members om ON om.organisation_id = p.organisation_id AND om.user_id = pm.user_id
           WHERE pm.user_id = $1 AND pm.active = true AND om.active = true`,
          [userId]
        );
        for (const row of projRes.rows) {
          projectMemberships.set(row.project_id, {
            role: row.role,
            orgId: row.organisation_id,
          });
        }
      }

      req.user = {
        id: userId,
        email: userEmail,
        displayName,
        orgMemberships,
        projectMemberships,
        token,
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
