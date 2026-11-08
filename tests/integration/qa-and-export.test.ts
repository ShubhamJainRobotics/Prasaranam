import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { execSync } from 'child_process';
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
  approveHandover,
} from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
  getTestSupabaseConfig,
} from '@relay/test-fixtures';
import {
  FakeDeterministicProvider,
  setFakeAdversarialMode,
} from '../../apps/api/src/ai/providers/fake-provider.js';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('Q&A and Export Integration Tests', () => {
  let pool: DbPool;
  let app: Express;
  let worker: RelayWorker;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let projectId: string;
  let orgId: string;
  let draftHandoverId: string;

  beforeAll(async () => {
    setFakeAdversarialMode('none');
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
    owner = await createRealTestUser(`qa-owner-${ts}@relay.local`, 'Password123!', 'QA Test Owner');
    reviewer = await createRealTestUser(
      `qa-reviewer-${ts}@relay.local`,
      'Password123!',
      'QA Test Reviewer'
    );
    recipient = await createRealTestUser(
      `qa-recipient-${ts}@relay.local`,
      'Password123!',
      'QA Test Recipient'
    );

    orgId = await bootstrapOrganisation(pool, owner.userId, `QA Org ${ts}`);
    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `QA Project ${ts}`,
      'Q&A and export integration test project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // 1. Ingest public source
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'Core Architecture and Database Decision',
        kind: 'text',
        content:
          'Decision: We decided to adopt PostgreSQL 16 as the primary datastore. Decision: Redis is selected for caching and rate limiting.',
        visibility: 'project',
      });
    expect(importRes.status).toBe(201);

    // 2. Trigger extraction
    const extractRes = await request(app)
      .post(`/api/v1/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();
    expect(extractRes.status).toBe(202);

    // Wait for extraction to complete
    const extractJobId = extractRes.body.data.jobId;
    let attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 200));
      const jobCheck = await pool.query('SELECT status FROM public.jobs WHERE id = $1', [
        extractJobId,
      ]);
      if (jobCheck.rows[0]?.status === 'succeeded') break;
      attempts++;
    }

    // 3. Generate handover draft
    const hoGenRes = await request(app)
      .post(`/api/v1/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        title: 'Engineering Architecture Handover',
        recipientId: recipient.userId,
        departingUserId: reviewer.userId,
        includedSections: ['snapshot', 'decisions'],
        detailLevel: 'standard',
        priorityFocus: 'Database resilience',
        includeCompletedWork: false,
        includeProposedNextActions: true,
        tone: 'professional',
      });
    expect(hoGenRes.status).toBe(202);

    const hoJobId = hoGenRes.body.data.jobId;
    attempts = 0;
    while (attempts < 30) {
      await new Promise((r) => setTimeout(r, 200));
      const jobCheck = await pool.query('SELECT status FROM public.jobs WHERE id = $1', [hoJobId]);
      if (jobCheck.rows[0]?.status === 'succeeded') break;
      attempts++;
    }

    // Get created handover
    const hListRes = await pool.query(
      'SELECT id, status FROM public.handovers WHERE project_id = $1 ORDER BY created_at DESC',
      [projectId]
    );
    expect(hListRes.rows.length).toBeGreaterThan(0);
    draftHandoverId = hListRes.rows[0].id;

    // Approve an item and the handover for export tests
    const itemRes = await pool.query(
      'SELECT id FROM public.handover_items WHERE handover_id = $1 LIMIT 1',
      [draftHandoverId]
    );
    if (itemRes.rows.length > 0) {
      await pool.query("UPDATE public.handover_items SET review_state = 'approved' WHERE id = $1", [
        itemRes.rows[0].id,
      ]);
    }

    await approveHandover(pool, {
      actorId: reviewer.userId,
      handoverId: draftHandoverId,
      confirmReviewedForRecipient: true,
      comment: 'Integration test approval for export testing',
    });
  }, 45000);

  afterAll(async () => {
    worker?.stop();
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  describe('Conversations and Evidence-Grounded Q&A', () => {
    let conversationId: string;

    it('creates a new conversation and records an audit event', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send();

      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty('id');
      expect(res.body.data.projectId).toBe(projectId);
      expect(res.body.data.userId).toBe(recipient.userId);
      conversationId = res.body.data.id;

      // Verify audit event
      const auditRes = await pool.query(
        "SELECT * FROM public.audit_events WHERE project_id = $1 AND action = 'conversation.create'",
        [projectId]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });

    it('lists only caller conversations for the project', async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.some((c: any) => c.id === conversationId)).toBe(true);

      // Other user (reviewer) sees only their own conversations
      const revRes = await request(app)
        .get(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);

      expect(revRes.status).toBe(200);
      expect(revRes.body.data.some((c: any) => c.id === conversationId)).toBe(false);
    });

    it('answers a question grounded in accessible project claims with citations', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What database did we decide to adopt?' });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty('body');
      const answer = res.body.data.body;
      expect(answer.status).toBe('answered');
      expect(answer.statements.length).toBeGreaterThan(0);

      // Statement should cite PostgreSQL decision
      const stmt = answer.statements[0];
      expect(stmt.text.toLowerCase()).toContain('postgresql');
      expect(stmt.citations.length).toBeGreaterThan(0);
      expect(stmt.citations[0].sourceTitle).toBe('Core Architecture and Database Decision');
      expect(stmt.citations[0].quote).toContain('PostgreSQL 16');

      // ai_usage record should exist
      const usageRes = await pool.query(
        "SELECT * FROM public.ai_usage WHERE project_id = $1 AND purpose = 'answer' AND outcome = 'ok'",
        [projectId]
      );
      expect(usageRes.rows.length).toBeGreaterThan(0);
    });

    it('short-circuits to insufficient_evidence with zero model calls on unknown question', async () => {
      // Count AI calls before
      const countBefore = await pool.query(
        "SELECT count(*)::int as c FROM public.ai_usage WHERE project_id = $1 AND purpose = 'answer'",
        [projectId]
      );

      const res = await request(app)
        .post(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What is the quantum telemetry satellite orbital inclination?' });

      expect(res.status).toBe(200);
      const answer = res.body.data.body;
      expect(answer.status).toBe('insufficient_evidence');
      expect(answer.statements).toHaveLength(0);
      expect(answer.limitations.length).toBeGreaterThan(0);

      // Count AI calls after should NOT increase
      const countAfter = await pool.query(
        "SELECT count(*)::int as c FROM public.ai_usage WHERE project_id = $1 AND purpose = 'answer'",
        [projectId]
      );
      expect(countAfter.rows[0].c).toBe(countBefore.rows[0].c);
    });

    it('retrieves conversation messages with enriched citations', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasStaleHistory).toBe(false);
      expect(res.body.data.historyUnavailableNotice).toBeNull();
      expect(res.body.data.messages.length).toBe(4); // 2 user questions + 2 assistant answers
    });

    it('shows history unavailable notice after access epoch is incremented', async () => {
      const epochBeforeRes = await pool.query(
        'SELECT access_epoch FROM public.projects WHERE id = $1',
        [projectId]
      );
      const epochBefore = BigInt(epochBeforeRes.rows[0].access_epoch);

      // Advance project epoch
      await pool.query('UPDATE public.projects SET access_epoch = access_epoch + 1 WHERE id = $1', [
        projectId,
      ]);

      const epochAfterRes = await pool.query(
        'SELECT access_epoch FROM public.projects WHERE id = $1',
        [projectId]
      );
      const epochAfter = BigInt(epochAfterRes.rows[0].access_epoch);
      expect(epochAfter).toBeGreaterThan(epochBefore);

      // Now query messages again: old messages occurred in previous epoch
      const res = await request(app)
        .get(`/api/v1/conversations/${conversationId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.hasStaleHistory).toBe(true);
      expect(res.body.data.historyUnavailableNotice).toContain('unavailable');
      expect(res.body.data.messages).toHaveLength(0); // Messages from prior epoch filtered out
    });
  });

  describe('Handover Export (Markdown and PDF)', () => {
    let freshApprovedHandoverId: string;

    beforeAll(async () => {
      // Create and approve a fresh handover in current epoch
      const curEpochRes = await pool.query(
        'SELECT access_epoch FROM public.projects WHERE id = $1',
        [projectId]
      );
      const curEpoch = BigInt(curEpochRes.rows[0].access_epoch);

      // Create draft handover
      const hoRes = await pool.query(
        `INSERT INTO public.handovers (
           project_id, root_id, version, title, recipient_id, created_by,
           status, generated_access_epoch, configuration, model_name, prompt_version
         ) VALUES ($1, gen_random_uuid(), 1, $2, $3, $4, 'draft', $5, $6, 'fake-deterministic', 'handover-v1')
         RETURNING id`,
        [
          projectId,
          'Production Core Systems Knowledge Handover',
          recipient.userId,
          reviewer.userId,
          curEpoch.toString(),
          JSON.stringify({
            title: 'Production Core Systems Knowledge Handover',
            recipientId: recipient.userId,
            includedSections: ['decisions'],
            priorityFocus: 'Database reliability',
          }),
        ]
      );
      freshApprovedHandoverId = hoRes.rows[0].id;

      // Add item and link claim
      const claimRes = await pool.query(
        'SELECT id, statement FROM public.claims WHERE project_id = $1 LIMIT 1',
        [projectId]
      );
      expect(claimRes.rows.length).toBeGreaterThan(0);
      const claimId = claimRes.rows[0].id;

      const itemInsert = await pool.query(
        `INSERT INTO public.handover_items (
           handover_id, project_id, section, ordinal, text, item_kind, evidence_state, review_state
         ) VALUES ($1, $2, 'decisions', 1, $3, 'fact', 'supported', 'approved')
         RETURNING id`,
        [freshApprovedHandoverId, projectId, claimRes.rows[0].statement]
      );
      const itemId = itemInsert.rows[0].id;

      await pool.query(
        'INSERT INTO public.handover_item_claims (item_id, project_id, claim_id) VALUES ($1, $2, $3)',
        [itemId, projectId, claimId]
      );

      // Approve handover
      await approveHandover(pool, {
        actorId: reviewer.userId,
        handoverId: freshApprovedHandoverId,
        confirmReviewedForRecipient: true,
        comment: 'Approved for export test',
      });
    });

    it('exports approved handover as valid Markdown with no-store and correct headers', async () => {
      const res = await request(app)
        .get(`/api/v1/handovers/${freshApprovedHandoverId}/export?format=md`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/markdown');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.headers['content-disposition']).toContain('.md');

      const mdText = res.text;
      expect(mdText).toContain('# Production Core Systems Knowledge Handover');
      expect(mdText).toContain('## Contents');
      expect(mdText).toContain('## 1. Decisions');
      expect(mdText).toContain('[Fact | Supported]');
      expect(mdText).toContain('PostgreSQL');
      expect(mdText).toContain('Generated by Relay Knowledge Handover Platform');

      // Audit event logged
      const auditRes = await pool.query(
        "SELECT * FROM public.audit_events WHERE project_id = $1 AND action = 'handover.export'",
        [projectId]
      );
      expect(auditRes.rows.length).toBeGreaterThan(0);
    });

    it('exports approved handover as valid PDF and pdftotext parses expected text', async () => {
      const res = await request(app)
        .get(`/api/v1/handovers/${freshApprovedHandoverId}/export?format=pdf`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toContain('attachment; filename=');
      expect(res.headers['content-disposition']).toContain('.pdf');

      const buffer = Buffer.from(res.body);
      expect(buffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

      // Parse text using pdftotext
      const parsedText = execSync('pdftotext - -', {
        input: buffer,
        encoding: 'utf-8',
      });

      expect(parsedText).toContain('Production Core Systems Knowledge Handover');
      expect(parsedText).toContain('Contents');
      expect(parsedText).toContain('1. Decisions');
      expect(parsedText).toContain('[Fact | Supported]');
      expect(parsedText).toContain('PostgreSQL');
      expect(parsedText).toContain('Relay Knowledge Handover Platform');
    });

    it('refuses export when format query parameter is invalid', async () => {
      const res = await request(app)
        .get(`/api/v1/handovers/${freshApprovedHandoverId}/export?format=docx`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('refuses export with 409 REGENERATION_REQUIRED when handover is draft', async () => {
      // Create a draft handover
      const dRes = await pool.query(
        `INSERT INTO public.handovers (
           project_id, root_id, version, title, recipient_id, created_by,
           status, generated_access_epoch, configuration, model_name, prompt_version
         ) VALUES ($1, gen_random_uuid(), 1, 'Draft Handover', $2, $3, 'draft', 1, '{}', 'fake-deterministic', 'handover-v1')
         RETURNING id`,
        [projectId, recipient.userId, reviewer.userId]
      );
      const draftId = dRes.rows[0].id;

      const res = await request(app)
        .get(`/api/v1/handovers/${draftId}/export?format=md`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('REGENERATION_REQUIRED');
    });

    it('refuses export with 409 REGENERATION_REQUIRED when project epoch has advanced', async () => {
      // Advance epoch
      await pool.query('UPDATE public.projects SET access_epoch = access_epoch + 1 WHERE id = $1', [
        projectId,
      ]);

      // Attempt export of previously approved handover
      const res = await request(app)
        .get(`/api/v1/handovers/${freshApprovedHandoverId}/export?format=pdf`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .responseType('blob');

      expect(res.status).toBe(409);
      const body = JSON.parse(res.body.toString('utf-8'));
      expect(body.error.code).toBe('REGENERATION_REQUIRED');
    });
  });
});
