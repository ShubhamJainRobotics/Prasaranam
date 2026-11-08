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

  if (
    poolOrClient instanceof pg.Pool ||
    (typeof (poolOrClient as any).connect === 'function' &&
      typeof (poolOrClient as any).release !== 'function')
  ) {
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
  requested_by: string;
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

// ─── Source Ingestion & Access Mutations ─────────────────────────────────────

export interface ImportSourceParams {
  actorId: string;
  projectId: string;
  title: string;
  kind: string;
  visibility: string;
  content: string;
  contentSha256: string;
  originalUrl?: string | null;
  authorLabel?: string | null;
  eventAt?: string | null;
  chunks?: unknown[];
  grantUserIds?: string[];
  replacesSourceId?: string | null;
}

export async function importSource(
  db: pg.Pool | pg.PoolClient,
  params: ImportSourceParams
): Promise<string> {
  return callMutation<string>(db, 'import_source', [
    params.actorId,
    params.projectId,
    params.title,
    params.kind,
    params.visibility,
    params.content,
    params.contentSha256,
    params.originalUrl ?? null,
    params.authorLabel ?? null,
    params.eventAt ?? null,
    JSON.stringify(params.chunks ?? []),
    params.grantUserIds ?? [],
    params.replacesSourceId ?? null,
  ]);
}

export async function setSourceAccess(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  sourceId: string,
  visibility: string,
  grantUserIds: string[] = []
): Promise<void> {
  await callMutation<void>(db, 'set_source_access', [
    actorId,
    projectId,
    sourceId,
    visibility,
    grantUserIds,
  ]);
}

export async function archiveSource(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  sourceId: string
): Promise<void> {
  await callMutation<void>(db, 'archive_source', [actorId, projectId, sourceId]);
}

// ─── Phase 5 AI Persistence & Claims Mutations ──────────────────────────────

export async function persistClaims(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  jobId: string,
  claims: unknown[],
  accessEpoch: number | string
): Promise<{ inserted: number; existing: number }> {
  return callMutation<{ inserted: number; existing: number }>(db, 'persist_claims', [
    actorId,
    projectId,
    jobId,
    JSON.stringify(claims),
    accessEpoch,
  ]);
}

export async function persistRelationships(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  jobId: string,
  relationships: unknown[],
  conflicts: unknown[],
  accessEpoch: number | string
): Promise<{ relationships: number; conflicts: number }> {
  return callMutation<{ relationships: number; conflicts: number }>(db, 'persist_relationships', [
    actorId,
    projectId,
    jobId,
    JSON.stringify(relationships),
    JSON.stringify(conflicts),
    accessEpoch,
  ]);
}

export async function persistQuestions(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  jobId: string,
  questions: unknown[],
  createdFor: string,
  accessEpoch: number | string
): Promise<{ inserted: number }> {
  return callMutation<{ inserted: number }>(db, 'persist_questions', [
    actorId,
    projectId,
    jobId,
    JSON.stringify(questions),
    createdFor,
    accessEpoch,
  ]);
}

export async function recordAiUsage(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string,
  jobId: string | null,
  purpose: string,
  modelName: string,
  promptVersion: string,
  inputTokens: number | null,
  outputTokens: number | null,
  latencyMs: number,
  outcome: string
): Promise<string> {
  return callMutation<string>(db, 'record_ai_usage', [
    actorId,
    projectId,
    jobId,
    purpose,
    modelName,
    promptVersion,
    inputTokens,
    outputTokens,
    latencyMs,
    outcome,
  ]);
}

export async function reviewClaim(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  claimId: string,
  reviewState: string
): Promise<{ claimId: string; reviewState: string }> {
  return callMutation<{ claimId: string; reviewState: string }>(db, 'review_claim', [
    actorId,
    claimId,
    reviewState,
  ]);
}

export async function setClaimOwner(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  claimId: string,
  ownerUserId: string | null
): Promise<{ claimId: string; ownerUserId: string | null }> {
  return callMutation<{ claimId: string; ownerUserId: string | null }>(db, 'set_claim_owner', [
    actorId,
    claimId,
    ownerUserId,
  ]);
}

export async function flagClaim(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  claimId: string,
  reason: string,
  newEvidenceState: string
): Promise<{ flagId: string; claimId: string; evidenceState: string }> {
  return callMutation<{
    flagId: string;
    claimId: string;
    evidenceState: string;
  }>(db, 'flag_claim', [actorId, claimId, reason, newEvidenceState]);
}

export async function dismissQuestion(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  questionId: string
): Promise<{ questionId: string; status: string }> {
  return callMutation<{ questionId: string; status: string }>(db, 'dismiss_question', [
    actorId,
    questionId,
  ]);
}

export async function retryJob(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  jobId: string
): Promise<{ jobId: string; status: string }> {
  return callMutation<{ jobId: string; status: string }>(db, 'retry_job', [actorId, jobId]);
}

// ─── Phase 6: Handover Mutations ─────────────────────────────────────────────

export interface CreateHandoverDraftInput {
  actorId: string;
  projectId: string;
  recipientId: string;
  departingUserId?: string | null;
  title: string;
  configuration: Record<string, unknown>;
  modelName: string;
  promptVersion: string;
  expectedAccessEpoch: number | string;
  items: Array<{
    section: string;
    ordinal: number;
    text: string;
    itemKind: string;
    claimIds: string[];
    evidenceState?: string;
  }>;
}

export async function createHandoverDraftFromGeneration(
  db: pg.Pool | pg.PoolClient,
  input: CreateHandoverDraftInput
): Promise<{ handoverId: string; version: number; rowVersion: number }> {
  return callMutation<{ handoverId: string; version: number; rowVersion: number }>(
    db,
    'create_handover_draft_from_generation',
    [
      input.actorId,
      input.projectId,
      input.recipientId,
      input.departingUserId ?? null,
      input.title,
      JSON.stringify(input.configuration),
      input.modelName,
      input.promptVersion,
      input.expectedAccessEpoch,
      JSON.stringify(input.items),
    ]
  );
}

export interface UpdateHandoverItemInput {
  actorId: string;
  handoverId: string;
  itemId: string;
  expectedRowVersion: number;
  reviewState?: string | null;
  text?: string | null;
  comment?: string | null;
}

export async function updateHandoverItem(
  db: pg.Pool | pg.PoolClient,
  input: UpdateHandoverItemInput
): Promise<{
  itemId: string;
  rowVersion: number;
  reviewState: string;
  text: string;
  originalText: string | null;
}> {
  return callMutation<{
    itemId: string;
    rowVersion: number;
    reviewState: string;
    text: string;
    originalText: string | null;
  }>(db, 'update_item', [
    input.actorId,
    input.handoverId,
    input.itemId,
    input.expectedRowVersion,
    input.reviewState ?? null,
    input.text ?? null,
    input.comment ?? null,
  ]);
}

export interface AddItemFromClaimsInput {
  actorId: string;
  handoverId: string;
  section: string;
  ordinal?: number | null;
  text: string;
  itemKind: string;
  claimIds: string[];
}

export async function addItemFromClaims(
  db: pg.Pool | pg.PoolClient,
  input: AddItemFromClaimsInput
): Promise<{
  itemId: string;
  handoverId: string;
  section: string;
  ordinal: number;
  itemKind: string;
  evidenceState: string;
  reviewState: string;
  rowVersion: number;
}> {
  return callMutation<{
    itemId: string;
    handoverId: string;
    section: string;
    ordinal: number;
    itemKind: string;
    evidenceState: string;
    reviewState: string;
    rowVersion: number;
  }>(db, 'add_item_from_claims', [
    input.actorId,
    input.handoverId,
    input.section,
    input.ordinal ?? null,
    input.text,
    input.itemKind,
    input.claimIds,
  ]);
}

export interface AttachClaimsInput {
  actorId: string;
  handoverId: string;
  itemId: string;
  claimIds: string[];
}

export async function attachClaims(
  db: pg.Pool | pg.PoolClient,
  input: AttachClaimsInput
): Promise<{ itemId: string; evidenceState: string; rowVersion: number }> {
  return callMutation<{ itemId: string; evidenceState: string; rowVersion: number }>(
    db,
    'attach_claims',
    [input.actorId, input.handoverId, input.itemId, input.claimIds]
  );
}

export interface FlagHandoverItemInput {
  actorId: string;
  handoverId: string;
  itemId: string;
  reason: string;
  comment?: string | null;
}

export async function flagHandoverItem(
  db: pg.Pool | pg.PoolClient,
  input: FlagHandoverItemInput
): Promise<{ itemId: string; evidenceState: string; rowVersion: number }> {
  return callMutation<{ itemId: string; evidenceState: string; rowVersion: number }>(
    db,
    'flag_item',
    [input.actorId, input.handoverId, input.itemId, input.reason, input.comment ?? null]
  );
}

export interface AddReviewerContextInput {
  actorId: string;
  handoverId: string;
  title: string;
  content: string;
  format: 'text' | 'markdown';
  visibility: 'project' | 'restricted';
  grantUserIds?: string[];
}

export async function addReviewerContext(
  db: pg.Pool | pg.PoolClient,
  input: AddReviewerContextInput
): Promise<{ sourceId: string; jobId: string }> {
  return callMutation<{ sourceId: string; jobId: string }>(db, 'add_reviewer_context', [
    input.actorId,
    input.handoverId,
    input.title,
    input.content,
    input.format,
    input.visibility,
    input.grantUserIds ?? null,
  ]);
}

export async function createRevision(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  handoverId: string
): Promise<{ handoverId: string; version: number; rowVersion: number }> {
  return callMutation<{ handoverId: string; version: number; rowVersion: number }>(
    db,
    'create_revision',
    [actorId, handoverId]
  );
}

export interface ApproveHandoverInput {
  actorId: string;
  handoverId: string;
  confirmReviewedForRecipient: boolean;
  comment?: string | null;
}

export async function approveHandover(
  db: pg.Pool | pg.PoolClient,
  input: ApproveHandoverInput
): Promise<{
  handoverId: string;
  status: string;
  approvedAccessEpoch: number | string;
  approvedAt: string;
}> {
  return callMutation<{
    handoverId: string;
    status: string;
    approvedAccessEpoch: number | string;
    approvedAt: string;
  }>(db, 'approve_handover', [
    input.actorId,
    input.handoverId,
    input.confirmReviewedForRecipient,
    input.comment ?? null,
  ]);
}

export async function shareHandover(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  handoverId: string
): Promise<{ handoverId: string; status: string; sharedAt: string }> {
  return callMutation<{ handoverId: string; status: string; sharedAt: string }>(
    db,
    'share_handover',
    [actorId, handoverId]
  );
}

// ─── Phase 7: Q&A and Conversation Mutations ─────────────────────────────────

export interface CreateConversationResult {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
}

export async function createConversation(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  projectId: string
): Promise<CreateConversationResult> {
  return callMutation<CreateConversationResult>(db, 'create_conversation', [actorId, projectId]);
}

export interface RecordMessageResult {
  messageId: string;
  conversationId: string;
  projectId: string;
  role: string;
  accessEpoch: number | string;
  createdAt: string;
}

export async function recordMessage(
  db: pg.Pool | pg.PoolClient,
  actorId: string,
  conversationId: string,
  role: 'user' | 'assistant',
  body: unknown,
  accessEpoch: number | string | bigint
): Promise<RecordMessageResult> {
  return callMutation<RecordMessageResult>(db, 'record_message', [
    actorId,
    conversationId,
    role,
    JSON.stringify(body),
    accessEpoch.toString(),
  ]);
}
