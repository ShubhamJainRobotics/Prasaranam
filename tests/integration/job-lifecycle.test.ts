import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  enqueueJob,
  leaseJob,
  heartbeatJob,
  completeJob,
  failJob,
  requeueExpiredJobs,
  requestCancelJob,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Job Lifecycle and Concurrency', () => {
  let pool: DbPool;
  let user: TestUser;
  let projectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    user = await createRealTestUser(
      `test-job-${Date.now()}@relay.local`,
      'Password123!',
      'Job Test User'
    );
    const orgId = await bootstrapOrganisation(pool, user.userId, 'Job Test Org');
    projectId = await createProject(
      pool,
      user.userId,
      orgId,
      'Job Test Project',
      '',
      'general',
      'UTC'
    );
  });

  afterAll(async () => {
    if (user) await deleteRealTestUser(user.userId);
    await closeDbPool(pool);
  });

  it('enqueue_job enforces idempotency with payload_hash per 2A.10', async () => {
    const key = `key-${Date.now()}`;
    const payload = { source_id: '123', options: { fast: true } };

    // Initial enqueue
    const jobId1 = await enqueueJob(pool, user.userId, projectId, 'extract', key, payload);
    expect(jobId1).toBeDefined();

    // Re-enqueue with the exact same payload -> returns the existing jobId
    const jobId2 = await enqueueJob(pool, user.userId, projectId, 'extract', key, payload);
    expect(jobId2).toBe(jobId1);

    // Re-enqueue with a different payload -> throws IDEMPOTENCY_CONFLICT
    const differentPayload = { source_id: '456', options: { fast: false } };
    await expect(
      enqueueJob(pool, user.userId, projectId, 'extract', key, differentPayload)
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/);

    // Clean up queued job so queue is empty for subsequent tests
    await pool.query('DELETE FROM public.jobs WHERE id = $1', [jobId1]);
  });

  it('two concurrent workers never lease the same job (FOR UPDATE SKIP LOCKED)', async () => {
    // Ensure no pending queued jobs
    await pool.query("DELETE FROM public.jobs WHERE status = 'queued'");

    const key = `concur-${Date.now()}`;
    const targetJobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, { run: 1 });

    // Race two leaseJob calls concurrently
    const [lease1, lease2] = await Promise.all([leaseJob(pool, 60), leaseJob(pool, 60)]);

    // Exactly one worker must have obtained the single queued job; the other gets null
    const leases = [lease1, lease2].filter((l) => l !== null);
    expect(leases.length).toBe(1);
    const leased = leases[0]!;
    expect(leased.id).toBe(targetJobId);
    expect(leased.lock_token).toBeDefined();
    expect(leased.attempts).toBe(1);

    // Also assert that if both had received something, they could never be the same ID
    if (lease1 && lease2) {
      expect(lease1.id).not.toBe(lease2.id);
    }

    // Clean up: complete the job
    await completeJob(pool, leased.id, leased.lock_token, { status: 'done' });
  });

  it('heartbeat extends lease; fails if lock_token does not match', async () => {
    const key = `hb-${Date.now()}`;
    const jobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, {
      task: 'hb',
    });
    const leased = await leaseJob(pool, 30);
    expect(leased).not.toBeNull();
    expect(leased!.id).toBe(jobId);

    // Valid heartbeat
    await expect(heartbeatJob(pool, jobId, leased!.lock_token, 60)).resolves.not.toThrow();

    // Heartbeat with wrong lock token -> raises LEASE_LOST
    await expect(
      heartbeatJob(pool, jobId, '00000000-0000-0000-0000-000000000000', 60)
    ).rejects.toThrow(/LEASE_LOST/);

    await completeJob(pool, jobId, leased!.lock_token, { done: true });
  });

  it('worker that lost its lease cannot write results', async () => {
    const key = `lost-${Date.now()}`;
    const jobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, {
      task: 'lost',
    });
    const leased = await leaseJob(pool, 30);

    // Simulate lost lease by passing bad lock_token
    await expect(
      completeJob(pool, jobId, '00000000-0000-0000-0000-000000000000', {
        results: [],
      })
    ).rejects.toThrow(/LEASE_LOST/);

    // With correct lock token it completes successfully
    await expect(
      completeJob(pool, jobId, leased!.lock_token, { results: [1, 2, 3] })
    ).resolves.not.toThrow();
  });

  it('fail_job requeues when attempts < maxAttempts and marks failed when terminal', async () => {
    const key = `fail-${Date.now()}`;
    const jobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, {
      task: 'fail',
    });

    // Attempt 1: lease and fail (maxAttempts = 2)
    const lease1 = await leaseJob(pool, 30);
    expect(lease1!.id).toBe(jobId);
    expect(lease1!.attempts).toBe(1);

    await failJob(pool, jobId, lease1!.lock_token, 'TRANSIENT_ERROR', 2, 0);

    // Check status: should be 'queued' for retry
    let res = await pool.query('SELECT status, attempts FROM public.jobs WHERE id = $1', [jobId]);
    expect(res.rows[0].status).toBe('queued');
    expect(res.rows[0].attempts).toBe(1);

    // Fast-forward run_after so it can be leased immediately
    await pool.query('UPDATE public.jobs SET run_after = now() WHERE id = $1', [jobId]);

    // Attempt 2: lease and fail (should be terminal now)
    const lease2 = await leaseJob(pool, 30);
    expect(lease2!.id).toBe(jobId);
    expect(lease2!.attempts).toBe(2);

    await failJob(pool, jobId, lease2!.lock_token, 'FATAL_ERROR', 2, 0);

    // Check status: should be terminal 'failed'
    res = await pool.query('SELECT status, last_error_code FROM public.jobs WHERE id = $1', [
      jobId,
    ]);
    expect(res.rows[0].status).toBe('failed');
    expect(res.rows[0].last_error_code).toBe('FATAL_ERROR');
  });

  it('requeue_expired_jobs recovers jobs whose lease expired', async () => {
    const key = `expired-${Date.now()}`;
    const jobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, {
      task: 'expire',
    });
    const leased = await leaseJob(pool, 30);
    expect(leased).not.toBeNull();

    // Expire the lease manually in the DB
    await pool.query(
      "UPDATE public.jobs SET locked_until = now() - interval '1 second' WHERE id = $1",
      [jobId]
    );

    // Run reaper
    const count = await requeueExpiredJobs(pool, 3);
    expect(count).toBeGreaterThanOrEqual(1);

    // Verify job is back in queued status
    const res = await pool.query('SELECT status, lock_token FROM public.jobs WHERE id = $1', [
      jobId,
    ]);
    expect(res.rows[0].status).toBe('queued');
    expect(res.rows[0].lock_token).toBeNull();
  });

  it('request_cancel_job marks cancel_requested for authorised users', async () => {
    const key = `cancel-${Date.now()}`;
    const jobId = await enqueueJob(pool, user.userId, projectId, 'extract', key, {
      task: 'cancel',
    });

    await requestCancelJob(pool, user.userId, jobId);

    const res = await pool.query('SELECT cancel_requested FROM public.jobs WHERE id = $1', [jobId]);
    expect(res.rows[0].cancel_requested).toBe(true);
  });
});
