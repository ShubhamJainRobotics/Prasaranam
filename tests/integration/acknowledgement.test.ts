import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import crypto from 'node:crypto';
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
  updateProjectMember,
} from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
  getTestSupabaseConfig,
  createAnonClient,
} from '@relay/test-fixtures';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('Handover Acknowledgement (Hackathon Addition 1)', () => {
  let pool: DbPool;
  let app: Express;
  let worker: RelayWorker;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let otherMember: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let orgId: string;
  let sharedHandoverId: string;
  let draftHandoverId: string;
  let approvedUnsharedHandoverId: string;

  beforeAll(async () => {
    const config = getTestSupabaseConfig();
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
    owner = await createRealTestUser(`ack-owner-${ts}@relay.local`, 'Password123!', 'Ack Owner');
    reviewer = await createRealTestUser(
      `ack-rev-${ts}@relay.local`,
      'Password123!',
      'Ack Reviewer'
    );
    recipient = await createRealTestUser(
      `ack-recip-${ts}@relay.local`,
      'Password123!',
      'Ack Recipient'
    );
    otherMember = await createRealTestUser(
      `ack-other-${ts}@relay.local`,
      'Password123!',
      'Ack Other'
    );
    outsider = await createRealTestUser(
      `ack-out-${ts}@relay.local`,
      'Password123!',
      'Ack Outsider'
    );

    // Bootstrap Org and Project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Ack Org ${ts}`);
    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, otherMember.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `Ack Project ${ts}`,
      'Handover acknowledgement testing project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');
    await addProjectMember(pool, owner.userId, projectId, otherMember.userId, 'contributor');

    // Ingest source
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'Core Architecture Overview',
        kind: 'text',
        content:
          'We decided to adopt PostgreSQL 16 for high-throughput ledgers. Blocker: Sandbox credentials must be rotated before release.',
        visibility: 'project',
      });
    expect(importRes.status).toBe(201);

    // Extraction
    const extractRes = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();
    expect(extractRes.status).toBe(202);

    const extractJobId = extractRes.body.data.jobId;
    let attempts = 0;
    while (attempts < 30) {
      const jobCheck = await request(app)
        .get(`/api/v1/jobs/${extractJobId}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      if (jobCheck.body?.data?.status === 'succeeded') break;
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    // Helper to generate handover
    async function generateHandover(title: string): Promise<string> {
      const genRes = await request(app)
        .post(`/api/v1/projects/${projectId}/handovers`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          title,
          recipientId: recipient.userId,
          includedSections: ['decisions', 'risks_dependencies'],
          detailLevel: 'standard',
          includeCompletedWork: false,
          includeProposedNextActions: false,
          tone: 'professional',
        });
      expect(genRes.status).toBe(202);
      const hJobId = genRes.body.data.jobId;

      attempts = 0;
      let createdHandoverId: string | null = null;
      while (attempts < 60) {
        const jobCheck = await request(app)
          .get(`/api/v1/jobs/${hJobId}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`);
        if (jobCheck.body?.data?.status === 'succeeded') {
          createdHandoverId = jobCheck.body.data.result?.handoverId;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
      expect(createdHandoverId).toBeDefined();
      return createdHandoverId!;
    }

    // 1. Generate Shared Handover
    sharedHandoverId = await generateHandover('Shared Handover For Ack');

    // Approve items
    const detailRes = await request(app)
      .get(`/api/v1/handovers/${sharedHandoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    const items = detailRes.body.data.items;
    for (const it of items) {
      await request(app)
        .patch(`/api/v1/handovers/${sharedHandoverId}/items/${it.id}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('If-Match', String(it.rowVersion))
        .send({ reviewState: 'approved' });
    }

    // Approve handover
    const approveRes = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ confirmReviewedForRecipient: true });
    expect(approveRes.status).toBe(200);

    // Share handover
    const shareRes = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/share`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();
    expect(shareRes.status).toBe(200);

    // 2. Generate Approved but unshared handover
    approvedUnsharedHandoverId = await generateHandover('Approved Unshared Handover');
    const appDet = await request(app)
      .get(`/api/v1/handovers/${approvedUnsharedHandoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    for (const it of appDet.body.data.items) {
      await request(app)
        .patch(`/api/v1/handovers/${approvedUnsharedHandoverId}/items/${it.id}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('If-Match', String(it.rowVersion))
        .send({ reviewState: 'approved' });
    }
    await request(app)
      .post(`/api/v1/handovers/${approvedUnsharedHandoverId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ confirmReviewedForRecipient: true });

    // 3. Draft handover
    draftHandoverId = await generateHandover('Draft Handover');
  });

  afterAll(async () => {
    if (worker) await worker.stop();
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (otherMember) await deleteRealTestUser(otherMember.userId);
    if (outsider) await deleteRealTestUser(outsider.userId);
    if (pool) await closeDbPool(pool);
  });

  it('recipient succeeds in acknowledging a valid shared handover', async () => {
    const res = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.handoverId).toBe(sharedHandoverId);
    expect(res.body.data.userId).toBe(recipient.userId);
    expect(res.body.data.acknowledgedAt).toBeDefined();

    // Verify GET /handovers/:id includes acknowledgedAt
    const getRes = await request(app)
      .get(`/api/v1/handovers/${sharedHandoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.acknowledgedAt).toBe(res.body.data.acknowledgedAt);

    // Verify GET /projects/:id/handovers includes acknowledgedAt for reviewer list
    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    expect(listRes.status).toBe(200);
    const item = listRes.body.data.find((h: any) => h.id === sharedHandoverId);
    expect(item).toBeDefined();
    expect(item.acknowledgedAt).toBe(res.body.data.acknowledgedAt);
  });

  it('calling acknowledge a second time is idempotent and returns existing acknowledgement', async () => {
    // First read current timestamp
    const firstGet = await request(app)
      .get(`/api/v1/handovers/${sharedHandoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);
    const firstAckTime = firstGet.body.data.acknowledgedAt;
    expect(firstAckTime).toBeDefined();

    // Second call
    const res = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.data.handoverId).toBe(sharedHandoverId);
    expect(new Date(res.body.data.acknowledgedAt).getTime()).toBe(new Date(firstAckTime).getTime());

    // Verify no duplicate row was created in DB
    const countCheck = await pool.query(
      'SELECT count(*) FROM public.handover_acknowledgements WHERE handover_id = $1',
      [sharedHandoverId]
    );
    expect(Number(countCheck.rows[0].count)).toBe(1);
  });

  it('non-recipient project member is refused with 403 FORBIDDEN', async () => {
    const res = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${otherMember.accessToken}`)
      .send();

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('outsider without project membership is refused with 404 NOT_FOUND', async () => {
    const res = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send();

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('draft handover cannot be acknowledged (409 REGENERATION_REQUIRED)', async () => {
    const res = await request(app)
      .post(`/api/v1/handovers/${draftHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGENERATION_REQUIRED');
  });

  it('approved but unshared handover cannot be acknowledged (409 REGENERATION_REQUIRED)', async () => {
    const res = await request(app)
      .post(`/api/v1/handovers/${approvedUnsharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGENERATION_REQUIRED');
  });

  it('superseded version cannot be acknowledged (409 REGENERATION_REQUIRED)', async () => {
    // Revise the shared handover to create v2, approve and share it -> v1 becomes superseded
    const revRes = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/versions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();
    expect(revRes.status).toBe(201);
    const v2Id = revRes.body.data.handoverId;

    // Approve items in v2
    const v2Det = await request(app)
      .get(`/api/v1/handovers/${v2Id}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    for (const it of v2Det.body.data.items) {
      await request(app)
        .patch(`/api/v1/handovers/${v2Id}/items/${it.id}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('If-Match', String(it.rowVersion))
        .send({ reviewState: 'approved' });
    }

    // Approve v2
    const v2Approve = await request(app)
      .post(`/api/v1/handovers/${v2Id}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ confirmReviewedForRecipient: true });
    expect(v2Approve.status).toBe(200);

    // Share v2 -> marks sharedHandoverId as superseded
    const v2Share = await request(app)
      .post(`/api/v1/handovers/${v2Id}/share`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();
    expect(v2Share.status).toBe(200);

    // Check v1 status in DB is now superseded
    const v1Check = await pool.query('SELECT status FROM public.handovers WHERE id = $1', [
      sharedHandoverId,
    ]);
    expect(v1Check.rows[0].status).toBe('superseded');

    // Attempting to acknowledge v1 fails
    const res = await request(app)
      .post(`/api/v1/handovers/${sharedHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGENERATION_REQUIRED');
  });

  it('stale version fails with 409 REGENERATION_REQUIRED', async () => {
    // Generate fresh handover and share it
    const freshHandoverId = await (async () => {
      const genRes = await request(app)
        .post(`/api/v1/projects/${projectId}/handovers`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          title: 'Fresh Stale Test Handover',
          recipientId: recipient.userId,
          includedSections: ['decisions', 'risks_dependencies'],
          detailLevel: 'standard',
          includeCompletedWork: false,
          includeProposedNextActions: false,
          tone: 'professional',
        });
      expect(genRes.status).toBe(202);
      const hJobId = genRes.body.data.jobId;
      let hId: string | null = null;
      let attempts = 0;
      while (attempts < 60) {
        const jobCheck = await request(app)
          .get(`/api/v1/jobs/${hJobId}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`);
        if (jobCheck.body?.data?.status === 'succeeded') {
          hId = jobCheck.body.data.result?.handoverId;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
      expect(hId).toBeDefined();

      const det = await request(app)
        .get(`/api/v1/handovers/${hId}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      for (const it of det.body.data.items) {
        await request(app)
          .patch(`/api/v1/handovers/${hId}/items/${it.id}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .set('If-Match', String(it.rowVersion))
          .send({ reviewState: 'approved' });
      }
      await request(app)
        .post(`/api/v1/handovers/${hId}/approve`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ confirmReviewedForRecipient: true });
      await request(app)
        .post(`/api/v1/handovers/${hId}/share`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send();
      return hId!;
    })();

    // Increment project access epoch (e.g. by updating a member)
    await updateProjectMember(
      pool,
      owner.userId,
      projectId,
      otherMember.userId,
      'contributor',
      true
    );

    // Attempting to acknowledge now that epoch changed fails
    const res = await request(app)
      .post(`/api/v1/handovers/${freshHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REGENERATION_REQUIRED');
  }, 30000);

  it('revocation after acknowledgement still blocks viewing', async () => {
    // Generate, share and acknowledge a new handover
    const ackHandoverId = await (async () => {
      const genRes = await request(app)
        .post(`/api/v1/projects/${projectId}/handovers`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({
          title: 'Ack Then Revoke Handover',
          recipientId: recipient.userId,
          includedSections: ['decisions', 'risks_dependencies'],
          detailLevel: 'standard',
          includeCompletedWork: false,
          includeProposedNextActions: false,
          tone: 'professional',
        });
      expect(genRes.status).toBe(202);
      const hJobId = genRes.body.data.jobId;
      let hId: string | null = null;
      let attempts = 0;
      while (attempts < 60) {
        const jobCheck = await request(app)
          .get(`/api/v1/jobs/${hJobId}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`);
        if (jobCheck.body?.data?.status === 'succeeded') {
          hId = jobCheck.body.data.result?.handoverId;
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
      expect(hId).toBeDefined();

      const det = await request(app)
        .get(`/api/v1/handovers/${hId}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      for (const it of det.body.data.items) {
        await request(app)
          .patch(`/api/v1/handovers/${hId}/items/${it.id}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .set('If-Match', String(it.rowVersion))
          .send({ reviewState: 'approved' });
      }
      await request(app)
        .post(`/api/v1/handovers/${hId}/approve`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ confirmReviewedForRecipient: true });
      await request(app)
        .post(`/api/v1/handovers/${hId}/share`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send();
      return hId!;
    })();

    // Recipient acknowledges
    const ackRes = await request(app)
      .post(`/api/v1/handovers/${ackHandoverId}/acknowledge`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send();
    expect(ackRes.status).toBe(200);

    // Deactivate recipient project membership
    await updateProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient', false);

    // Recipient tries to view the acknowledged handover -> rejected!
    const viewRes = await request(app)
      .get(`/api/v1/handovers/${ackHandoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);

    expect([404, 409]).toContain(viewRes.status);
    if (viewRes.status === 409) {
      expect(viewRes.body.error.code).toBe('REGENERATION_REQUIRED');
    }
  }, 30000);

  it('direct Data API calls cannot insert or call the function', async () => {
    const anon = createAnonClient();

    // 1. Anon direct insert on handover_acknowledgements fails
    const { error: insertErr } = await anon.from('handover_acknowledgements').insert({
      project_id: projectId,
      handover_id: sharedHandoverId,
      user_id: recipient.userId,
    });
    expect(insertErr).not.toBeNull();

    // 2. Anon direct RPC call fails
    const { error: rpcErr } = await anon.rpc('acknowledge_handover', {
      p_actor_id: recipient.userId,
      p_handover_id: sharedHandoverId,
    });
    expect(rpcErr).not.toBeNull();
  });
});
