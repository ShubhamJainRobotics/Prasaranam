import crypto from 'node:crypto';
import { test, expect } from '@playwright/test';
import {
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
  mockDevServerEnv,
} from '@relay/test-fixtures';
import {
  createDbPool,
  closeDbPool,
  type DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
  approveHandover,
  shareHandover,
} from '@relay/database';
import { RelayWorker } from '../../apps/worker/src/worker.js';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import request from 'supertest';

test.describe('Evidence-Grounded Q&A and Handover Export E2E Flow', () => {
  let reviewer: TestUser;
  let recipient: TestUser;
  let pool: DbPool;
  let worker: RelayWorker;
  let projectId: string;
  let orgId: string;
  let approvedHandoverId: string;
  const timestamp = Date.now();
  const reviewerEmail = `e2e-qa-rev-${timestamp}@relay.local`;
  const reviewerPassword = 'Password123!';
  const recipientEmail = `e2e-qa-rec-${timestamp}@relay.local`;
  const recipientPassword = 'Password123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    reviewer = await createRealTestUser(reviewerEmail, reviewerPassword, 'Reviewer Lead');
    recipient = await createRealTestUser(recipientEmail, recipientPassword, 'Incoming Engineer');

    orgId = await bootstrapOrganisation(pool, reviewer.userId, `QA E2E Org ${timestamp}`);
    await addOrgMember(pool, reviewer.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      reviewer.userId,
      orgId,
      'E2E Core Knowledge Platform',
      'Knowledge platform testing project',
      'software_engineering',
      'UTC'
    );
    await addProjectMember(pool, reviewer.userId, projectId, recipient.userId, 'recipient');

    const fakeApi = request('http://localhost:4000/api/v1');

    // 1. Import source via API
    const pubText =
      'Decision: We decided to deploy PostgreSQL 16 as the primary persistent database. Proposal: Use Redis for in-memory session cache.';
    const pubImportRes = await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'Infrastructure and Datastore Decision',
        kind: 'text',
        content: pubText,
        visibility: 'project',
      });
    expect(pubImportRes.status).toBe(201);

    // 2. Start background worker
    const env = {
      ...mockDevServerEnv,
      AI_PROVIDER: 'fake' as const,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_POLL_INTERVAL_MS: 100,
    };
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, env, fakeProvider);
    worker.start();

    // 3. Trigger extraction via API
    const extractRes = await fakeApi
      .post(`/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();

    if (extractRes.body?.data?.jobId) {
      let attempts = 0;
      while (attempts < 30) {
        const check = await fakeApi
          .get(`/jobs/${extractRes.body.data.jobId}`)
          .set('Authorization', `Bearer ${reviewer.accessToken}`);
        if (check.body?.data?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
    }

    // 4. Create and approve a handover for export testing
    const curEpochRes = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    const curEpoch = BigInt(curEpochRes.rows[0].access_epoch);

    const hoRes = await pool.query(
      `INSERT INTO public.handovers (
         project_id, root_id, version, title, recipient_id, created_by,
         status, generated_access_epoch, configuration, model_name, prompt_version
       ) VALUES ($1, gen_random_uuid(), 1, $2, $3, $4, 'draft', $5, $6, 'fake-deterministic', 'handover-v1')
       RETURNING id`,
      [
        projectId,
        'Core Knowledge Handover Document',
        recipient.userId,
        reviewer.userId,
        curEpoch.toString(),
        JSON.stringify({
          title: 'Core Knowledge Handover Document',
          recipientId: recipient.userId,
          includedSections: ['decisions'],
        }),
      ]
    );
    approvedHandoverId = hoRes.rows[0].id;

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
      [approvedHandoverId, projectId, claimRes.rows[0].statement]
    );
    const itemId = itemInsert.rows[0].id;

    await pool.query(
      'INSERT INTO public.handover_item_claims (item_id, project_id, claim_id) VALUES ($1, $2, $3)',
      [itemId, projectId, claimId]
    );

    await approveHandover(pool, {
      actorId: reviewer.userId,
      handoverId: approvedHandoverId,
      confirmReviewedForRecipient: true,
      comment: 'E2E test approval',
    });

    await shareHandover(pool, reviewer.userId, approvedHandoverId);
  });

  test.afterAll(async () => {
    worker?.stop();
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  test('incoming engineer uses Ask Relay for grounded Q&A and exports handover document', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // ─── Phase 1: Recipient logs in ──────────────────────────────────────────────
    console.log('E2E STEP 1: Logging in as recipient');
    await page.goto('/login');
    await page.getByLabel('Email address').fill(recipientEmail);
    await page.getByLabel('Password').fill(recipientPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/app/);

    // ─── Phase 2: Navigate to Ask Relay page ─────────────────────────────────────
    console.log('E2E STEP 2: Navigating to Ask Relay page');
    await page.goto(`/app/projects/${projectId}/ask`);
    await expect(page.getByRole('heading', { name: 'Ask Prasaranam' })).toBeVisible();

    // Verify chat UI elements
    const questionInput = page.getByPlaceholder(/Ask an evidence-grounded question/i);
    await expect(questionInput).toBeVisible();
    const sendButton = page.getByRole('button', { name: /^Ask$/i });
    await expect(sendButton).toBeVisible();

    // ─── Phase 3: Ask grounded question with citations ───────────────────────────
    console.log('E2E STEP 3: Asking grounded question');
    await questionInput.fill('What database did we decide to deploy?');
    await sendButton.click();

    // Expect answered status and PostgreSQL statement
    await expect(page.getByText(/Answered with Evidence/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/PostgreSQL 16/i).first()).toBeVisible();
    await expect(page.getByText(/Infrastructure and Datastore Decision/i).first()).toBeVisible();

    // ─── Phase 4: Ask question with insufficient evidence ────────────────────────
    console.log('E2E STEP 4: Asking question with no matching evidence');
    await questionInput.fill('What is the supersonic flight altitude limit?');
    await sendButton.click();

    // Expect insufficient evidence state
    await expect(page.getByText('Insufficient Evidence', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/No relevant evidence was found/i)).toBeVisible();

    // ─── Phase 5: Export handover as Markdown and PDF ───────────────────────────
    console.log('E2E STEP 5: Navigating to handover detail page');
    await page.goto(`/app/handovers/${approvedHandoverId}`);
    await expect(
      page.getByRole('heading', { name: 'Core Knowledge Handover Document' })
    ).toBeVisible();

    // Open Export dropdown
    const exportBtn = page.getByTestId('export-handover-btn');
    await expect(exportBtn).toBeVisible();
    await exportBtn.click();

    // Trigger Markdown download
    console.log('E2E STEP 6: Triggering Markdown download');
    const [downloadMd] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-md-btn').click(),
    ]);
    expect(downloadMd.suggestedFilename()).toContain('.md');

    // Reopen Export dropdown and trigger PDF download
    console.log('E2E STEP 7: Triggering PDF download');
    await exportBtn.click();
    const [downloadPdf] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-pdf-btn').click(),
    ]);
    expect(downloadPdf.suggestedFilename()).toContain('.pdf');

    console.log('E2E STEP 8: All Q&A and export interactions completed successfully!');
  });
});
