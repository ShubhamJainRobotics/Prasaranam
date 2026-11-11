import crypto from 'node:crypto';
import request from 'supertest';
import { createAdminClient, createAnonClient, getTestSupabaseConfig } from '../src/index.js';
import type { ScenarioContext, ScenarioUser } from './types.js';

export function assertLocalEnvironment(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run scenario operations in production (SPEC Section 2A.15)');
  }

  const { url } = getTestSupabaseConfig();
  try {
    const parsed = new URL(url);
    const allowed = ['127.0.0.1', 'localhost', 'host.docker.internal'];
    if (!allowed.includes(parsed.hostname)) {
      throw new Error(
        `Refusing to execute scenarios on non-local Supabase host: ${parsed.hostname} (SPEC Section 2A.15)`
      );
    }
  } catch (err: any) {
    throw new Error(`Invalid SUPABASE_URL: ${err.message}`);
  }
}

/**
 * Polls local Mailpit (port 54324) for an email delivered to recipientEmail.
 */
export async function getMailpitMessage(
  recipientEmail: string,
  subjectFilter?: string,
  timeoutMs = 10000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:54324/api/v1/messages');
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.find((m: any) => {
          const toMatch = m.To?.some(
            (t: any) => t.Address?.toLowerCase() === recipientEmail.toLowerCase()
          );
          if (!toMatch) return false;
          if (subjectFilter && !m.Subject?.toLowerCase().includes(subjectFilter.toLowerCase())) {
            return false;
          }
          return true;
        });
        if (msg) {
          const fullRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`);
          if (fullRes.ok) {
            return await fullRes.json();
          }
        }
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`Timeout waiting for Mailpit email to ${recipientEmail}`);
}

export function extractLinkFromEmail(htmlOrText: string): string {
  const match = htmlOrText.match(/href="([^"]+)"/) || htmlOrText.match(/(https?:\/\/[^\s"']+)/);
  if (!match || !match[1]) {
    throw new Error('Could not find link in email body');
  }
  return match[1].replace(/&amp;/g, '&');
}

/**
 * Creates a real scenario user through Supabase Auth Admin.
 * Marks email confirmed and signs in via anon client to acquire a valid user JWT.
 */
export async function createScenarioUser(
  email: string,
  displayName = 'Scenario User',
  password?: string
): Promise<ScenarioUser> {
  assertLocalEnvironment();
  const adminClient = createAdminClient();
  const anonClient = createAnonClient();

  const finalPassword = password || `ScnPass-${crypto.randomBytes(8).toString('hex')}!`;

  // Check if user already exists
  const { data: usersData } = await adminClient.auth.admin.listUsers();
  const existing = usersData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  let userId: string;
  if (existing) {
    userId = existing.id;
    await adminClient.auth.admin.updateUserById(userId, {
      password: finalPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
  } else {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: { display_name: displayName },
    });
    if (createErr || !created.user) {
      throw new Error(`Failed to create scenario user ${email}: ${createErr?.message}`);
    }
    userId = created.user.id;
  }

  // Sign in with anon client to get real JWT access token
  const { data: signInData, error: signInErr } = await anonClient.auth.signInWithPassword({
    email,
    password: finalPassword,
  });

  if (signInErr || !signInData.session) {
    throw new Error(`Failed to sign in scenario user ${email}: ${signInErr?.message}`);
  }

  return {
    id: userId,
    email,
    password: finalPassword,
    displayName,
    accessToken: signInData.session.access_token,
  };
}

/**
 * Deletes all database entities and auth users associated with scenarios (prefixed with scn-).
 */
export async function resetScenarioData(pool: any): Promise<{
  deletedProjects: number;
  deletedOrgs: number;
  deletedUsers: number;
}> {
  assertLocalEnvironment();
  const adminClient = createAdminClient();

  // 1. Delete audit events referencing scn- projects or orgs to avoid foreign key errors
  await pool.query(`
    DELETE FROM public.audit_events
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%')
       OR organisation_id IN (SELECT id FROM public.organisations WHERE name LIKE 'scn-%');
  `);

  // 1b. Demote approved/shared handovers to draft so immutability triggers do not reject cascading deletes
  await pool.query(`
    UPDATE public.handovers
    SET status = 'draft'
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%')
      AND status IN ('approved', 'shared');
  `);

  // 1c. Delete reviews, handover item claims, items, and handovers explicitly
  await pool.query(`
    DELETE FROM public.reviews
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%');
    DELETE FROM public.handover_item_claims
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%');
    DELETE FROM public.handover_items
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%');
    DELETE FROM public.handovers
    WHERE project_id IN (SELECT id FROM public.projects WHERE name LIKE 'scn-%');
  `);

  // 2. Delete projects with scn- prefix (cascades to sources, claims, handovers, etc.)
  const projRes = await pool.query(`
    DELETE FROM public.projects WHERE name LIKE 'scn-%' RETURNING id;
  `);

  // 3. Delete organisations with scn- prefix (cascades to project_members, org_members)
  const orgRes = await pool.query(`
    DELETE FROM public.organisations WHERE name LIKE 'scn-%' RETURNING id;
  `);

  // 4. Delete Supabase Auth users whose email ends with @example.test or starts with scn
  const { data: usersData } = await adminClient.auth.admin.listUsers();
  let deletedUsers = 0;
  if (usersData?.users) {
    for (const u of usersData.users) {
      if (
        u.email?.endsWith('@example.test') ||
        u.email?.startsWith('scn-') ||
        u.email?.startsWith('scn')
      ) {
        try {
          await adminClient.auth.admin.deleteUser(u.id);
          deletedUsers++;
        } catch {
          // Continue
        }
      }
    }
  }

  return {
    deletedProjects: projRes.rowCount || 0,
    deletedOrgs: orgRes.rowCount || 0,
    deletedUsers,
  };
}

/**
 * Creates a fresh scenario context wired to the given app and database pool.
 */
export function createScenarioContext(pool: any, app: any, env?: any): ScenarioContext {
  const callApi = async (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    path: string,
    token?: string,
    body?: unknown,
    headers: Record<string, string> = {}
  ): Promise<{ status: number; body: any; headers: Record<string, any> }> => {
    let req: any;
    switch (method) {
      case 'GET':
        req = request(app).get(path);
        break;
      case 'POST':
        req = request(app).post(path);
        break;
      case 'PATCH':
        req = request(app).patch(path);
        break;
      case 'DELETE':
        req = request(app).delete(path);
        break;
      case 'PUT':
        req = request(app).put(path);
        break;
    }

    if (token) {
      req.set('Authorization', `Bearer ${token}`);
    }

    for (const [k, v] of Object.entries(headers)) {
      req.set(k, v);
    }

    if (body !== undefined) {
      req.send(body);
    }

    const res = await req;
    return {
      status: res.status,
      body: res.body,
      headers: res.headers,
    };
  };

  return {
    pool,
    app,
    env,
    users: {},
    orgs: {},
    projects: {},
    sources: {},
    claims: {},
    handovers: {},
    questions: {},
    jobs: {},
    conversations: {},
    state: {},
    callApi,
  };
}
