import pg from 'pg';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const { Pool } = pg;

export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;
export type { SupabaseClient };

export function createDbPool(connectionString: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
}

export async function checkDatabaseHealth(pool: pg.Pool): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1;');
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

export async function closeDbPool(pool: pg.Pool): Promise<void> {
  await pool.end();
}

/**
 * Executes a function within a database transaction.
 * Commits on success; rolls back on error.
 */
export async function withTransaction<T>(
  pool: pg.Pool,
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve original error
    }
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Low-level runner: executes a named app_private mutation function with parameterised arguments.
 * If given a Pool, executes within an isolated transaction.
 * If given a PoolClient, executes on that client within the caller's transaction.
 */
export async function callMutation<T = unknown>(
  poolOrClient: pg.Pool | pg.PoolClient,
  fnName: string,
  args: unknown[]
): Promise<T> {
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const sql = `SELECT app_private.${fnName}(${placeholders}) as result;`;

  if ('connect' in poolOrClient && typeof poolOrClient.connect === 'function') {
    return withTransaction(poolOrClient as pg.Pool, async (client) => {
      const res = await client.query(sql, args);
      return res.rows[0]?.result as T;
    });
  } else {
    const client = poolOrClient as pg.PoolClient;
    const res = await client.query(sql, args);
    return res.rows[0]?.result as T;
  }
}

/**
 * Creates a user-scoped Supabase client that forwards the caller's verified JWT.
 * RLS applies to all queries made through this client.
 */
export function createUserClient(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string
): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

// ─── Typed Mutation Wrappers (no business logic; SQL functions enforce rules) ──

export async function bootstrapOrganisation(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  orgName: string
): Promise<string> {
  return callMutation<string>(db, 'bootstrap_organisation', [actorId, orgName]);
}

export async function createProject(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  orgId: string,
  name: string,
  description: string,
  domain: string,
  timezone: string
): Promise<string> {
  return callMutation<string>(db, 'create_project', [
    actorId,
    orgId,
    name,
    description,
    domain,
    timezone,
  ]);
}

export async function addOrgMember(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  orgId: string,
  targetUserId: string,
  role: string
): Promise<void> {
  await callMutation<void>(db, 'add_org_member', [actorId, orgId, targetUserId, role]);
}

export async function updateOrgMember(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  orgId: string,
  targetUserId: string,
  role: string,
  active: boolean
): Promise<void> {
  await callMutation<void>(db, 'update_org_member', [actorId, orgId, targetUserId, role, active]);
}

export async function addProjectMember(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  targetUserId: string,
  role: string
): Promise<void> {
  await callMutation<void>(db, 'add_project_member', [actorId, projectId, targetUserId, role]);
}

export async function updateProjectMember(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  targetUserId: string,
  role: string,
  active: boolean
): Promise<void> {
  await callMutation<void>(db, 'update_project_member', [
    actorId,
    projectId,
    targetUserId,
    role,
    active,
  ]);
}

export async function enqueueJob(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  kind: string,
  idempotencyKey: string,
  payload: Record<string, unknown>
): Promise<string> {
  return callMutation<string>(db, 'enqueue_job', [
    actorId,
    projectId,
    kind,
    idempotencyKey,
    JSON.stringify(payload),
  ]);
}

export interface LeasedJob {
  id: string;
  project_id: string;
  kind: string;
  payload: unknown;
  lock_token: string;
  attempts: number;
}

export async function leaseJob(
  db: pg.Pool | pg.PoolClient,
  leaseSeconds = 30
): Promise<LeasedJob | null> {
  const sql = 'SELECT * FROM app_private.lease_job($1);';
  if ('connect' in db && typeof db.connect === 'function') {
    return withTransaction(db as pg.Pool, async (client) => {
      const res = await client.query(sql, [leaseSeconds]);
      return (res.rows[0] as LeasedJob) || null;
    });
  } else {
    const client = db as pg.PoolClient;
    const res = await client.query(sql, [leaseSeconds]);
    return (res.rows[0] as LeasedJob) || null;
  }
}

export async function heartbeatJob(
  db: pg.Pool | pg.PoolClient,
  jobId: string,
  lockToken: string,
  leaseSeconds = 30
): Promise<void> {
  await callMutation<void>(db, 'heartbeat_job', [jobId, lockToken, leaseSeconds]);
}

export async function completeJob(
  db: pg.Pool | pg.PoolClient,
  jobId: string,
  lockToken: string,
  result: Record<string, unknown>
): Promise<void> {
  await callMutation<void>(db, 'complete_job', [jobId, lockToken, JSON.stringify(result)]);
}

export async function failJob(
  db: pg.Pool | pg.PoolClient,
  jobId: string,
  lockToken: string,
  errorCode: string,
  maxAttempts = 3,
  retryBaseSeconds = 30
): Promise<void> {
  await callMutation<void>(db, 'fail_job', [
    jobId,
    lockToken,
    errorCode,
    maxAttempts,
    retryBaseSeconds,
  ]);
}

export async function requeueExpiredJobs(
  db: pg.Pool | pg.PoolClient,
  maxAttempts = 3
): Promise<number> {
  return callMutation<number>(db, 'requeue_expired_jobs', [maxAttempts]);
}

export async function requestCancelJob(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  jobId: string
): Promise<void> {
  await callMutation<void>(db, 'request_cancel_job', [actorId, jobId]);
}
