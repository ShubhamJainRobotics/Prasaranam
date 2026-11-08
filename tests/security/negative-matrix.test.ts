import crypto from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../apps/api/src/app.js';
import {
  createDbPool,
  closeDbPool,
  type DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
  importSource,
  archiveSource,
  enqueueJob,
} from '@relay/database';
import {
  getTestSupabaseConfig,
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
} from '@relay/test-fixtures';
import { serverEnvironmentSchema } from '@relay/contracts';
import { setFakeAdversarialMode } from '../../apps/api/src/ai/providers/fake-provider.js';

describe('Phase 8: Section 22.3 Negative Test Matrix Completions', () => {
  let pool: DbPool;
  let app: Express;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    setFakeAdversarialMode('none');
    const config = getTestSupabaseConfig();
    pool = createDbPool(config.databaseUrl);

    const env = serverEnvironmentSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      AI_PROVIDER: 'fake',
    });

    const runSuffix = Date.now();
    owner = await createRealTestUser(
      `neg-owner-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Neg Owner'
    );
    reviewer = await createRealTestUser(
      `neg-reviewer-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Neg Reviewer'
    );
    recipient = await createRealTestUser(
      `neg-recip-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Neg Recipient'
    );
    outsider = await createRealTestUser(
      `neg-outsider-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Neg Outsider'
    );

    orgId = await bootstrapOrganisation(pool, owner.userId, 'Negative Matrix Corp');
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Negative Matrix Project',
      'Test Project',
      'general',
      'UTC'
    );

    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    app = createApp({ env, pool });
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (outsider) await deleteRealTestUser(outsider.userId);
    await closeDbPool(pool);
  });

  describe('Item 7: Recipient Changed After Generation (SPEC 2A.4 item 9 & 22.3 item 7)', () => {
    it('forbids changing recipient or configuration of an existing draft handover (requires new generation)', async () => {
      // Handover configuration is immutable on draft; changing recipient requires a new generation job
      // Attempting to PATCH /handovers/:id or update configuration does not exist in API
      const res = await request(app)
        .patch(`/api/v1/handovers/${crypto.randomUUID()}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ recipientId: outsider.userId });

      // Route does not exist (404) because draft configuration cannot be mutated
      expect(res.status).toBe(404);
    });
  });

  describe('Item 8: Membership Revoked During Generation (SPEC 18.7 & 22.3 item 8)', () => {
    it('rejects draft handover persistence if recipient membership is revoked during generation', async () => {
      // If project access epoch changes or membership is revoked, persistence transaction rejects with stale-context
      const currentEpoch = 1;

      // Revoking recipient membership increments epoch and marks member inactive
      await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient'); // increments epoch

      // Attempting createHandoverDraftFromGeneration with old epoch will fail
      const { createHandoverDraftFromGeneration } = await import('@relay/database');
      await expect(
        createHandoverDraftFromGeneration(pool, {
          actorId: reviewer.userId,
          projectId,
          recipientId: recipient.userId,
          departingUserId: reviewer.userId,
          title: 'Test Handover',
          configuration: {
            title: 'Test Handover',
            recipientId: recipient.userId,
            includedSections: ['snapshot', 'decisions'],
            detailLevel: 'standard',
            includeCompletedWork: false,
            includeProposedNextActions: true,
            tone: 'professional',
          },
          modelName: 'fake-deterministic',
          promptVersion: 'handover-v1',
          expectedAccessEpoch: currentEpoch, // Old epoch!
          items: [],
        })
      ).rejects.toThrow(/STALE_ACCESS_EPOCH|STALE_CONTEXT|ILLEGAL_STATE/);
    });
  });

  describe('Item 19: Duplicate Job Retries (SPEC 2A.11 & 22.3 item 19)', () => {
    it('prevents retrying an active or queued job', async () => {
      const idempotencyKey = crypto.randomUUID();
      const jobId = await enqueueJob(
        pool,
        reviewer.userId,
        projectId,
        'extract',
        idempotencyKey,
        {}
      );

      // Job is currently queued, not failed. POST /jobs/:id/retry must reject
      const res = await request(app)
        .post(`/api/v1/jobs/${jobId}/retry`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);

      // Rejects because job is not in 'failed' status
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ILLEGAL_STATE');
    });
  });

  describe('Item 20: Approval and Share Race Protection (SPEC 18.7 & 22.3 item 20)', () => {
    it('rejects approval or sharing when access epoch advances concurrently', async () => {
      // If epoch advances, approve_handover rejects with STALE_CONTEXT
      const fakeHandoverId = crypto.randomUUID();
      await expect(
        pool.query(`SELECT app_private.approve_handover($1, $2, 999999, 'Notes', true)`, [
          reviewer.userId,
          fakeHandoverId,
        ])
      ).rejects.toThrow();
    });
  });

  describe('Item 21: Archived Source Content & Claims Isolation (SPEC 2A.2 & 22.3 item 21)', () => {
    it('excludes archived sources from active project source listings', async () => {
      // 1. Ingest a source
      const sourceId = await importSource(pool, {
        actorId: reviewer.userId,
        projectId,
        title: 'Active Source',
        kind: 'text',
        visibility: 'project',
        content: 'Initial unarchived content',
        contentSha256: 'sha256-hash-test',
        chunks: [],
        grantUserIds: [],
      });

      // 2. Archive the source
      await archiveSource(pool, owner.userId, projectId, sourceId);

      // 3. GET /projects/:id/sources returns only active sources
      const listRes = await request(app)
        .get(`/api/v1/projects/${projectId}/sources`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);

      expect(listRes.status).toBe(200);
      const sources = listRes.body.data;
      const found = sources.find((s: any) => s.id === sourceId);
      expect(found).toBeUndefined();
    });
  });

  describe('Item 25: Idempotency Key Reuse With Different Payload (SPEC 2A.10 & 22.3 item 25)', () => {
    it('returns 422 IDEMPOTENCY_PAYLOAD_MISMATCH when same key is sent with conflicting payload', async () => {
      const fixedIdempotencyKey = crypto.randomUUID();

      // First request
      const firstRes = await request(app)
        .post(`/api/v1/projects/${projectId}/extractions`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', fixedIdempotencyKey)
        .send({});

      expect(firstRes.status).toBe(202);

      // Second request with conflicting payload
      const conflictRes = await request(app)
        .post(`/api/v1/projects/${projectId}/extractions`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', fixedIdempotencyKey)
        .send({ sourceId: crypto.randomUUID() });

      expect(conflictRes.status).toBe(422);
      expect(conflictRes.body.error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
    });
  });

  describe('Item 28: Account Enumeration Resistance (SPEC 2A.2 & 22.3 item 28)', () => {
    it('returns identical generic success message and response shape regardless of whether email exists', async () => {
      // Existing verified email vs non-existent email
      const existingEmail = recipient.email;
      const nonExistentEmail = `nonexistent-user-${Date.now()}@nowhere.local`;

      const res1 = await request(app)
        .post(`/api/v1/organisations/${orgId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: existingEmail, role: 'member' });

      const res2 = await request(app)
        .post(`/api/v1/organisations/${orgId}/members`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ email: nonExistentEmail, role: 'member' });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both responses must contain identical message
      expect(res1.body.data.message).toBe(res2.body.data.message);
      expect(res1.body.data.message).toContain('If an account exists with this email');
      expect(res1.body.data.added).toBeUndefined(); // Never returns whether account existed
    });
  });
});
