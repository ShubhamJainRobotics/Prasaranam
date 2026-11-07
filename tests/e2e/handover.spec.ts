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
} from '@relay/database';
import { RelayWorker } from '../../apps/worker/src/worker.js';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import request from 'supertest';

test.describe('Handover Review, Approval, Sharing & Security E2E Flow', () => {
  let reviewer: TestUser;
  let recipient: TestUser;
  let pool: DbPool;
  let worker: RelayWorker;
  let projectId: string;
  let orgId: string;
  const timestamp = Date.now();
  const reviewerEmail = `e2e-reviewer-${timestamp}@relay.local`;
  const reviewerPassword = 'ReviewerPassword123!';
  const recipientEmail = `e2e-recipient-${timestamp}@relay.local`;
  const recipientPassword = 'RecipientPassword123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    reviewer = await createRealTestUser(
      reviewerEmail,
      reviewerPassword,
      'Dana Vance (Departing Lead)'
    );
    recipient = await createRealTestUser(
      recipientEmail,
      recipientPassword,
      'Samira Patel (Incoming Lead)'
    );

    orgId = await bootstrapOrganisation(pool, reviewer.userId, `Handover E2E Org ${timestamp}`);
    await addOrgMember(pool, reviewer.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      reviewer.userId,
      orgId,
      'E2E Payments Handover Project',
      'Payments handover testing project',
      'software_engineering',
      'UTC'
    );
    await addProjectMember(pool, reviewer.userId, projectId, recipient.userId, 'recipient');

    // 1. Import Public Source via API
    const fakeApi = request('http://localhost:4000/api/v1');
    const pubText =
      'Architecture Decision Record: We decided to deploy PostgreSQL 16 for all financial transaction records. Proposal: Implement idempotency keys on payment webhooks to ensure at-most-once processing.';
    const pubImportRes = await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'ADR 001 - PostgreSQL Architecture',
        kind: 'text',
        content: pubText,
        visibility: 'project',
      });
    if (pubImportRes.status !== 201) {
      throw new Error(`Failed to import public source: ${JSON.stringify(pubImportRes.body)}`);
    }

    // 2. Import Restricted Source (granted to reviewer only) via API
    const privText =
      'Confidential Transition Note: Dana Vance $25,000 transition bonus allocation upon verified handover completion. Strict personnel compensation data.';
    const privImportRes = await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        title: 'Confidential Personnel Allocation',
        kind: 'text',
        content: privText,
        visibility: 'restricted',
        grantUserIds: [reviewer.userId],
      });
    if (privImportRes.status !== 201) {
      throw new Error(`Failed to import restricted source: ${JSON.stringify(privImportRes.body)}`);
    }

    // 3. Start background worker
    const env = {
      ...mockDevServerEnv,
      AI_PROVIDER: 'fake' as const,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_POLL_INTERVAL_MS: 100,
    };
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, env, fakeProvider);
    worker.start();

    // 4. Trigger extraction via API
    const extractRes = await fakeApi
      .post(`/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();

    // Wait for extraction to complete
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
  });

  test.afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
    if (reviewer) {
      await deleteRealTestUser(reviewer.userId);
    }
    if (recipient) {
      await deleteRealTestUser(recipient.userId);
    }
    if (pool) {
      await closeDbPool(pool);
    }
  });

  test('departing reviewer generates handover, reviews and approves items with attestation, and shares with incoming engineer without restricted leak', async ({
    page,
  }) => {
    test.setTimeout(90000);

    // ─── Phase 1: Reviewer logs in and creates handover ──────────────────────────
    console.log('STEP 1: Logging in as reviewer');
    await page.goto('/login');
    await page.getByLabel('Email address').fill(reviewerEmail);
    await page.getByLabel('Password').fill(reviewerPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/app/);

    // Navigate to project handovers page
    console.log('STEP 2: Navigating to project handovers');
    await page.goto(`/app/projects/${projectId}/handovers`);
    await expect(page.getByRole('heading', { name: 'Project Handovers' })).toBeVisible();

    // Click "New Handover"
    console.log('STEP 3: Clicking New Handover');
    await page.getByRole('link', { name: 'New Handover' }).click();
    await expect(page).toHaveURL(`/app/projects/${projectId}/handovers/new`);

    // Submit configuration form
    console.log('STEP 4: Submitting configuration form');
    await page.locator('#title').fill('Payments Service Architecture Handover');
    await page.getByRole('button', { name: 'Generate Handover Draft' }).click();

    // Wait for generation to complete and navigate to review page
    console.log('STEP 5: Waiting for review page URL');
    await expect(page).toHaveURL(/\/app\/handovers\/[0-9a-f-]+\/review/, { timeout: 40000 });
    console.log('STEP 6: Reached review page');
    await expect(page.getByText('Payments Service Architecture Handover')).toBeVisible();

    // ─── Phase 2: Review and Approve items in draft ──────────────────────────────
    console.log('STEP 7: Reviewing and approving items');
    await expect(page.getByTestId('approve-item-btn').first()).toBeVisible({ timeout: 15000 });
    while ((await page.getByTestId('approve-item-btn').count()) > 0) {
      console.log('Approving an item...');
      const btn = page.getByTestId('approve-item-btn').first();
      await btn.click();
      await page.waitForTimeout(400);
    }
    console.log('STEP 8: All items approved');

    // ─── Phase 3: Approve Handover with Attestation ─────────────────────────────
    console.log('STEP 9: Approving handover with attestation');
    const approveHandoverBtn = page.getByRole('button', { name: 'Approve Draft' });
    await expect(approveHandoverBtn).toBeEnabled({ timeout: 10000 });
    await approveHandoverBtn.click();

    // Attestation Dialog opens
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Attestation checkbox must be confirmed
    const attestationCheckbox = dialog.getByRole('checkbox');
    await attestationCheckbox.check();

    // Confirm approval
    console.log('STEP 10: Confirming approval');
    await dialog.getByRole('button', { name: 'Confirm & Approve' }).click();

    // Verify status changes to APPROVED
    await expect(page.getByText('approved').first()).toBeVisible({ timeout: 10000 });
    console.log('STEP 11: Handover status is approved');

    // ─── Phase 4: Share Handover with Recipient ─────────────────────────────────
    console.log('STEP 12: Sharing with recipient');
    const shareBtn = page.getByRole('button', { name: 'Share with Recipient' });
    await expect(shareBtn).toBeVisible({ timeout: 10000 });
    await shareBtn.click();

    const shareDialog = page.getByRole('dialog');
    await expect(shareDialog).toBeVisible();
    await shareDialog.getByRole('button', { name: 'Share Handover' }).click();

    // Status updates to SHARED
    await expect(page.getByText('shared').first()).toBeVisible({ timeout: 10000 });
    console.log('STEP 13: Handover status is shared');

    // Get current handover URL
    const handoverReviewUrl = page.url();
    const handoverIdMatch = handoverReviewUrl.match(/\/handovers\/([0-9a-f-]+)\/review/);
    expect(handoverIdMatch).not.toBeNull();
    const handoverId = handoverIdMatch![1];
    console.log('STEP 14: Handover ID is', handoverId);

    // ─── Phase 5: Incoming Engineer logs in and views handover ──────────────────
    console.log('STEP 15: Recipient viewing handover');
    // Use fresh page context for recipient
    const recipientContext = await page.context().browser()!.newContext();
    const recipientPage = await recipientContext.newPage();

    await recipientPage.goto('http://localhost:5173/login');
    await recipientPage.getByLabel('Email address').fill(recipientEmail);
    await recipientPage.getByLabel('Password').fill(recipientPassword);
    await recipientPage.getByRole('button', { name: 'Sign In' }).click();
    await expect(recipientPage).toHaveURL(/\/app/);

    // Incoming engineer visits shared handover view
    await recipientPage.goto(`http://localhost:5173/app/handovers/${handoverId}`);
    await expect(
      recipientPage.getByRole('heading', { name: 'Payments Service Architecture Handover' })
    ).toBeVisible({
      timeout: 15000,
    });
    await expect(recipientPage.getByText('shared').first()).toBeVisible();

    // Verify public architecture facts are visible
    await expect(recipientPage.getByText('PostgreSQL 16').first()).toBeVisible();
    console.log('STEP 16: Public facts verified for recipient');

    // ─── Phase 6: Invariant Verification: Restricted note NEVER appears ─────────
    const pageContent = await recipientPage.content();
    expect(pageContent).not.toContain('$25,000');
    expect(pageContent).not.toContain('transition bonus');
    expect(pageContent).not.toContain('Strict personnel compensation data');
    console.log('STEP 17: Invariant verified: Restricted note NEVER reached recipient');
    await recipientContext.close();
  });
});
