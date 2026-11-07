import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../apps/api/src/app.js';
import { RelayWorker } from '../../apps/worker/src/worker.js';
import {
  createDbPool,
  closeDbPool,
  type DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
} from '@relay/database';
import {
  getTestSupabaseConfig,
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
} from '@relay/test-fixtures';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('AI Pipeline & Knowledge Lifecycle Integration', () => {
  let pool: DbPool;
  let app: Express;
  let worker: RelayWorker;
  let config: ReturnType<typeof getTestSupabaseConfig>;
  let owner: TestUser;
  let reviewer: TestUser;
  let projectId: string;
  let orgId: string;
  let sourceId: string;

  beforeAll(async () => {
    config = getTestSupabaseConfig();
    pool = createDbPool(config.databaseUrl);

    const env = serverEnvironmentSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      AI_PROVIDER: 'fake',
      AI_TIMEOUT_MS: 5000,
      AI_MAX_INPUT_TOKENS: 10000,
      AI_MAX_OUTPUT_TOKENS: 2000,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_CONCURRENCY: 1,
      WORKER_POLL_INTERVAL_MS: 100,
      SUPABASE_URL: config.url,
      SUPABASE_ANON_KEY: config.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      DATABASE_URL: config.databaseUrl,
    });

    app = createApp({ env, pool });
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, env, fakeProvider);
    worker.start();

    const ts = Date.now();
    // Create Owner & Reviewer users
    owner = await createRealTestUser(`ai-pipe-owner-${ts}@relay.local`, 'Password123!', 'Owner');
    reviewer = await createRealTestUser(
      `ai-pipe-rev-${ts}@relay.local`,
      'Password123!',
      'Reviewer'
    );

    // Bootstrap organisation and project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Pipeline Test Org ${ts}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Pipeline Test Project',
      'Test description',
      'software_engineering',
      'UTC'
    );

    // Add reviewer to organisation and project
    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');

    // Import a test source with explicit decision, task, proposal, and contradiction
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Architecture & Migration Plan',
        kind: 'text',
        content:
          'We decided to approve PostgreSQL for our core database. I propose we use Redis for cache sessions. We need to implement database schema migrations by Friday. The database cutover is scheduled for Monday at 9am. Integration tests are blocked by missing sandbox credentials.',
        visibility: 'project',
      });

    expect(importRes.status).toBe(201);
    sourceId = importRes.body.data.source.id;
  });

  afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
    if (owner) {
      await deleteRealTestUser(owner.userId);
    }
    if (reviewer) {
      await deleteRealTestUser(reviewer.userId);
    }
    if (pool) {
      await closeDbPool(pool);
    }
  });

  it('enqueues and processes an extraction job, producing semantically validated claims', async () => {
    const idempotencyKey = crypto.randomUUID();

    const enqueueRes = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ sourceId });

    expect(enqueueRes.status).toBe(202);
    expect(enqueueRes.body.data.status).toBe('queued');
    const jobId = enqueueRes.body.data.jobId;

    // Wait for worker to finish processing the extract job
    let attempts = 0;
    let jobStatus = 'queued';
    while (attempts < 30 && jobStatus !== 'succeeded') {
      await new Promise((r) => setTimeout(r, 200));
      const jobRes = await request(app)
        .get(`/api/v1/jobs/${jobId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);
      jobStatus = jobRes.body.data?.status;
      attempts++;
    }

    expect(jobStatus).toBe('succeeded');

    // Query extracted claims
    const claimsRes = await request(app)
      .get(`/api/v1/projects/${projectId}/claims`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(claimsRes.status).toBe(200);
    expect(claimsRes.body.data.length).toBeGreaterThan(0);

    const kinds = claimsRes.body.data.map((c: any) => c.kind);
    expect(kinds).toContain('decision');
    expect(kinds).toContain('proposal');
    expect(kinds).toContain('task');
    expect(kinds).toContain('blocker');

    // Verify AI usage was recorded
    const usageRes = await pool.query(
      `SELECT * FROM public.ai_usage WHERE project_id = $1 AND purpose = 'extract';`,
      [projectId]
    );
    expect(usageRes.rows.length).toBeGreaterThan(0);
    expect(usageRes.rows[0].outcome).toBe('ok');
    expect(usageRes.rows[0].model_name).toBe('fake-deterministic');
  }, 15000);

  it('auto-runs relationship analysis and detects contradictions between Friday and Monday cutover', async () => {
    // Wait for auto-enqueued relationship analysis to complete
    let attempts = 0;
    let relCount = 0;
    while (attempts < 50 && relCount === 0) {
      await new Promise((r) => setTimeout(r, 200));
      const res = await pool.query(
        `SELECT count(*)::integer FROM public.claim_relationships WHERE project_id = $1;`,
        [projectId]
      );
      relCount = res.rows[0].count;
      attempts++;
    }

    expect(relCount).toBeGreaterThan(0);

    // Verify contradiction was found and lowered claim evidence_state to conflicting
    const claimsRes = await request(app)
      .get(`/api/v1/projects/${projectId}/claims?evidenceState=conflicting`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(claimsRes.status).toBe(200);
    expect(claimsRes.body.data.length).toBeGreaterThan(0);

    // Verify clarification question was auto-generated for the conflict
    const questionsRes = await request(app)
      .get(`/api/v1/projects/${projectId}/questions`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(questionsRes.status).toBe(200);
    expect(questionsRes.body.data.length).toBeGreaterThan(0);
  }, 15000);

  it('allows answering a clarification question, storing reviewer-context source and triggering extraction', async () => {
    // 1. Get an open question
    const qListRes = await request(app)
      .get(`/api/v1/projects/${projectId}/questions?status=open`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(qListRes.status).toBe(200);
    expect(qListRes.body.data.length).toBeGreaterThan(0);
    const questionId = qListRes.body.data[0].id;

    // 2. Answer question
    const answerRes = await request(app)
      .post(`/api/v1/questions/${questionId}/answer`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        answer:
          'We confirmed with ops that Monday at 9am is the official cutover schedule. Dave will oversee the migration.',
        visibility: 'project',
      });

    expect(answerRes.status).toBe(200);
    expect(answerRes.body.data.questionId).toBe(questionId);
    expect(answerRes.body.data.sourceId).toBeTruthy();
    expect(answerRes.body.data.jobId).toBeTruthy();

    const answerSourceId = answerRes.body.data.sourceId;

    // Verify question is now marked answered
    const updatedQRes = await pool.query(
      `SELECT status, answer_source_id, answered_by FROM public.clarification_questions WHERE id = $1;`,
      [questionId]
    );
    expect(updatedQRes.rows[0].status).toBe('answered');
    expect(updatedQRes.rows[0].answer_source_id).toBe(answerSourceId);
    expect(updatedQRes.rows[0].answered_by).toBe(reviewer.userId);
  });

  it('allows reviewing, linking owner, and flagging claims', async () => {
    // 1. Get a claim
    const claimsRes = await request(app)
      .get(`/api/v1/projects/${projectId}/claims?limit=1`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    const claim = claimsRes.body.data[0];
    expect(claim).toBeDefined();

    // 2. Review claim: approve
    const reviewRes = await request(app)
      .patch(`/api/v1/claims/${claim.id}/review`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ reviewState: 'approved' });

    expect(reviewRes.status).toBe(200);
    expect(reviewRes.body.data.reviewState).toBe('approved');

    // 3. Link claim owner to reviewer
    const ownerRes = await request(app)
      .patch(`/api/v1/claims/${claim.id}/owner`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ userId: reviewer.userId });

    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.ownerUserId).toBe(reviewer.userId);

    // 4. Flag claim with reason
    const flagRes = await request(app)
      .post(`/api/v1/claims/${claim.id}/flags`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        reason: 'Requires further verification from security team.',
        newEvidenceState: 'needs_confirmation',
      });

    expect(flagRes.status).toBe(200);
    expect(flagRes.body.data.evidenceState).toBe('needs_confirmation');

    // 5. Fetch single claim detail and verify relationships & evidence
    const detailRes = await request(app)
      .get(`/api/v1/claims/${claim.id}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.id).toBe(claim.id);
    expect(detailRes.body.data.evidence.length).toBeGreaterThan(0);
    expect(detailRes.body.data.reviewState).toBe('approved');
    expect(detailRes.body.data.evidenceState).toBe('needs_confirmation');
  });

  it('enforces idempotency on job endpoints: same key + same payload returns existing job', async () => {
    const key = crypto.randomUUID();

    const res1 = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ sourceId });

    expect(res1.status).toBe(202);
    const jobId1 = res1.body.data.jobId;

    const res2 = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ sourceId });

    expect(res2.status).toBe(202);
    expect(res2.body.data.jobId).toBe(jobId1);

    // Different payload with same key returns 422
    const res3 = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .set('Idempotency-Key', key)
      .send({ sourceId: '00000000-0000-4000-8000-000000000999' });

    expect(res3.status).toBe(422);
  });
});
