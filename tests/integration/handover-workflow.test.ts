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
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
  getTestSupabaseConfig,
} from '@relay/test-fixtures';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('Handover Workflow Integration', () => {
  let pool: DbPool;
  let app: Express;
  let worker: RelayWorker;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let projectId: string;
  let orgId: string;

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
    owner = await createRealTestUser(
      `ho-owner-${ts}@relay.local`,
      'Password123!',
      'Handover Owner'
    );
    reviewer = await createRealTestUser(
      `ho-reviewer-${ts}@relay.local`,
      'Password123!',
      'Handover Reviewer'
    );
    recipient = await createRealTestUser(
      `ho-recipient-${ts}@relay.local`,
      'Password123!',
      'Handover Recipient'
    );

    // Bootstrap Org and Project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Handover Org ${ts}`);

    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `Handover Project ${ts}`,
      'Handover workflow integration project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // Ingest public source with architecture decision & proposals
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'Architecture & Webhook Decisions',
        kind: 'text',
        content:
          'We decided to adopt PostgreSQL 16 as the core datastore. Proposal: Implement idempotency keys on payment webhooks to prevent duplicate charges.',
        visibility: 'project',
      });

    expect(importRes.status).toBe(201);

    // Trigger extraction
    const extractRes = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();
    expect(extractRes.status).toBe(202);

    // Wait for extraction job to complete
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
  });

  afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  it('runs complete handover generation, review, revision, approval, and superseding workflow', async () => {
    // 1. Request Handover Generation
    const idempotencyKey = crypto.randomUUID();
    const handoverPayload = {
      title: 'Payments Engineering Handover',
      recipientId: recipient.userId,
      departingUserId: reviewer.userId,
      includedSections: ['snapshot', 'decisions', 'next_actions'],
      detailLevel: 'standard',
      priorityFocus: 'Postgres migration and idempotency',
      includeCompletedWork: false,
      includeProposedNextActions: true,
      tone: 'professional',
    };

    const genRes = await request(app)
      .post(`/api/v1/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(handoverPayload);

    expect(genRes.status).toBe(202);
    expect(genRes.body.data.jobId).toBeDefined();

    const handoverJobId = genRes.body.data.jobId;

    // 2. Poll job completion
    let attempts = 0;
    let createdHandoverId: string | null = null;
    while (attempts < 30) {
      const jobCheck = await request(app)
        .get(`/api/v1/jobs/${handoverJobId}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      if (jobCheck.body?.data?.status === 'succeeded') {
        createdHandoverId = jobCheck.body.data.result?.handoverId;
        break;
      }
      if (jobCheck.body?.data?.status === 'failed') {
        throw new Error(`Handover generation job failed: ${jobCheck.body.data.lastErrorCode}`);
      }
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    expect(createdHandoverId).toBeDefined();
    const handoverId = createdHandoverId!;

    // 3. Reviewer inspects draft handover
    const detailRes = await request(app)
      .get(`/api/v1/handovers/${handoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(detailRes.status).toBe(200);
    const handover = detailRes.body.data;
    expect(handover.id).toBe(handoverId);
    expect(handover.status).toBe('draft');
    expect(handover.version).toBe(1);
    expect(handover.items.length).toBeGreaterThan(0);

    const firstItem = handover.items[0];
    expect(firstItem.reviewState).toBe('pending');
    expect(firstItem.citations.length).toBeGreaterThan(0);

    // 4. Test Optimistic Concurrency with If-Match on item update
    const staleVersion = firstItem.rowVersion - 1;
    const optimisticConflictRes = await request(app)
      .patch(`/api/v1/handovers/${handoverId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('If-Match', String(staleVersion))
      .send({ text: 'Updated description by reviewer' });

    expect(optimisticConflictRes.status).toBe(409); // Conflict: Version conflict

    // Valid update with exact row_version
    const validEditRes = await request(app)
      .patch(`/api/v1/handovers/${handoverId}/items/${firstItem.id}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('If-Match', String(firstItem.rowVersion))
      .send({ text: 'PostgreSQL 16 verified by lead architect.' });

    expect(validEditRes.status).toBe(200);
    expect(validEditRes.body.data.rowVersion).toBe(firstItem.rowVersion + 1);

    // 5. Add a supplementary item from claims
    const claimId = firstItem.claimIds[0];
    const addItemRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/items`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        section: 'decisions',
        text: 'Manually verified datastore choice during transition review.',
        itemKind: 'fact',
        claimIds: [claimId],
      });

    expect(addItemRes.status).toBe(201);
    expect(addItemRes.body.data.reviewState).toBe('pending');

    // 6. Verify Approval Preconditions (must reject if pending items remain)
    const prematureApproveRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        confirmReviewedForRecipient: true,
        comment: 'Premature approval attempt',
      });

    expect(prematureApproveRes.status).toBe(409); // Precondition failed because items are still pending

    // Approve all remaining pending items
    const refreshedDetail = await request(app)
      .get(`/api/v1/handovers/${handoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    for (const item of refreshedDetail.body.data.items) {
      if (item.reviewState === 'pending') {
        await request(app)
          .patch(`/api/v1/handovers/${handoverId}/items/${item.id}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .set('If-Match', String(item.rowVersion))
          .send({ reviewState: 'approved' });
      }
    }

    // Try approving without attestation confirmation
    const missingAttestationRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        confirmReviewedForRecipient: false,
      });

    expect(missingAttestationRes.status).toBe(422); // Validation error (Zod requires true)

    // Valid Approval
    const validApproveRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        confirmReviewedForRecipient: true,
        comment: 'Reviewed thoroughly for incoming team member.',
      });

    expect(validApproveRes.status).toBe(200);
    expect(validApproveRes.body.data.status).toBe('approved');
    expect(validApproveRes.body.data.approvedAt).toBeDefined();

    // 7. Verify Review Records Audit Log
    const reviewHistoryRes = await request(app)
      .get(`/api/v1/handovers/${handoverId}/reviews`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(reviewHistoryRes.status).toBe(200);
    expect(reviewHistoryRes.body.data.length).toBeGreaterThan(0);
    const approveRecord = reviewHistoryRes.body.data.find(
      (r: { action: string }) => r.action === 'approve_version'
    );
    expect(approveRecord).toBeDefined();
    expect(approveRecord.confirmedReviewedForRecipient).toBe(true);

    // 8. Share Handover Version 1
    const shareRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/share`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();

    expect(shareRes.status).toBe(200);
    expect(shareRes.body.data.status).toBe('shared');
    expect(shareRes.body.data.sharedAt).toBeDefined();

    // Recipient can view shared handover
    const recipientViewRes = await request(app)
      .get(`/api/v1/handovers/${handoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);

    expect(recipientViewRes.status).toBe(200);
    expect(recipientViewRes.body.data.status).toBe('shared');
    expect(recipientViewRes.body.data.items.length).toBeGreaterThan(0);

    // 9. Create Revision v2
    const revisionRes = await request(app)
      .post(`/api/v1/handovers/${handoverId}/versions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();

    expect(revisionRes.status).toBe(201);
    expect(revisionRes.body.data.version).toBe(2);
    const v2Id = revisionRes.body.data.handoverId;

    // Approve and share v2
    const v2Detail = await request(app)
      .get(`/api/v1/handovers/${v2Id}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    for (const item of v2Detail.body.data.items) {
      if (item.reviewState === 'pending') {
        await request(app)
          .patch(`/api/v1/handovers/${v2Id}/items/${item.id}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`)
          .set('If-Match', String(item.rowVersion))
          .send({ reviewState: 'approved' });
      }
    }

    await request(app)
      .post(`/api/v1/handovers/${v2Id}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ confirmReviewedForRecipient: true });

    // Share v2 -> should supersede v1!
    await request(app)
      .post(`/api/v1/handovers/${v2Id}/share`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send();

    // Verify v1 is now superseded
    const v1AfterSuperRes = await request(app)
      .get(`/api/v1/handovers/${handoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(v1AfterSuperRes.body.data.status).toBe('superseded');
  }, 30000);
});
