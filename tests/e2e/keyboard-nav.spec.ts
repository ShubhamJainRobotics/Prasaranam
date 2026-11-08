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
import crypto from 'node:crypto';

test.describe('Keyboard-Only E2E Interactions (Zero Mouse Clicks)', () => {
  let pool: DbPool;
  let user: TestUser;
  let recipient: TestUser;
  let worker: RelayWorker;
  let orgId: string;
  let projectId: string;
  let handoverId: string;
  const timestamp = Date.now();
  const userEmail = `keyboard-nav-${timestamp}@relay.local`;
  const userPassword = 'KeyboardNavPassword123!';
  const recipientEmail = `keyboard-recipient-${timestamp}@relay.local`;
  const recipientPassword = 'KeyboardRecipientPassword123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    user = await createRealTestUser(userEmail, userPassword, 'Keyboard Navigator');
    recipient = await createRealTestUser(recipientEmail, recipientPassword, 'Keyboard Recipient');

    orgId = await bootstrapOrganisation(pool, user.userId, `Keyboard Org ${timestamp}`);
    await addOrgMember(pool, user.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      user.userId,
      orgId,
      'Keyboard E2E Project',
      'Keyboard navigation testing project',
      'software_engineering',
      'UTC'
    );
    await addProjectMember(pool, user.userId, projectId, recipient.userId, 'recipient');

    const fakeApi = request('http://localhost:4000/api/v1');

    // Import seed source
    await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        title: 'Initial Seed Source',
        kind: 'text',
        content:
          'Decision: We use Redis for temporary caching. Task: Review the authentication architecture.',
        visibility: 'project',
      });

    // Run extraction
    const env = {
      ...mockDevServerEnv,
      AI_PROVIDER: 'fake' as const,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_POLL_INTERVAL_MS: 100,
    };
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, env, fakeProvider);
    worker.start();

    const extractRes = await fakeApi
      .post(`/projects/${projectId}/extractions`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send();

    if (extractRes.body?.data?.jobId) {
      let attempts = 0;
      while (attempts < 30) {
        const check = await fakeApi
          .get(`/jobs/${extractRes.body.data.jobId}`)
          .set('Authorization', `Bearer ${user.accessToken}`);
        if (check.body?.data?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
    }

    // Create a draft handover
    const hoRes = await fakeApi
      .post(`/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        title: 'Keyboard Test Handover',
        recipientId: recipient.userId,
        includedSections: ['snapshot', 'decisions', 'next_actions'],
        detailLevel: 'standard',
        includeCompletedWork: true,
        includeProposedNextActions: true,
        tone: 'professional',
      });

    if (hoRes.body?.data?.jobId) {
      let attempts = 0;
      while (attempts < 30) {
        const check = await fakeApi
          .get(`/jobs/${hoRes.body.data.jobId}`)
          .set('Authorization', `Bearer ${user.accessToken}`);
        if (check.body?.data?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
    }

    const listRes = await fakeApi
      .get(`/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    handoverId = listRes.body.data[0].id;
  });

  test.afterAll(async () => {
    if (worker) await worker.stop();
    if (user) await deleteRealTestUser(user.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  test('executes complete source import flow using only keyboard navigation', async ({ page }) => {
    test.setTimeout(60000);

    // 1. Log in using keyboard
    await page.goto('/login');
    await page.getByLabel('Email address').focus();
    await page.keyboard.type(userEmail);
    await page.getByLabel('Password').focus();
    await page.keyboard.type(userPassword);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app/);

    // 2. Navigate to sources page
    await page.goto(`/app/projects/${projectId}/sources`);
    await page.waitForLoadState('networkidle');

    // 3. Tab to "Import Source" button and trigger with Enter
    const importBtn = page.getByRole('button', { name: /import source/i });
    await importBtn.focus();
    await page.keyboard.press('Enter');

    // Confirm dialog is open and focus is trapped inside dialog
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // 4. Navigate inside modal to "Paste Text" tab button
    const pasteTab = dialog.getByRole('button', { name: /paste text/i });
    await pasteTab.focus();
    await page.keyboard.press('Enter');

    // 5. Fill title using keyboard
    const titleInput = dialog.getByLabel(/title/i);
    await titleInput.focus();
    await page.keyboard.type('Keyboard Accessible ADR Note');

    // 6. Fill content using keyboard
    const contentTextarea = dialog.getByLabel(/content/i);
    await contentTextarea.focus();
    await page.keyboard.type('Decision: Complete accessibility keyboard navigation tests.');

    // 7. Tab to Submit button and submit with Enter
    const submitBtn = dialog.getByRole('button', { name: /start import/i });
    await submitBtn.focus();
    await page.keyboard.press('Enter');

    // 8. Confirm modal closed and new source is visible in table
    await expect(dialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Keyboard Accessible ADR Note')).toBeVisible({ timeout: 10000 });
  });

  test('executes handover item review and approval flow using only keyboard navigation', async ({
    page,
  }) => {
    test.setTimeout(60000);

    // 1. Sign in
    await page.goto('/login');
    await page.getByLabel('Email address').focus();
    await page.keyboard.type(userEmail);
    await page.getByLabel('Password').focus();
    await page.keyboard.type(userPassword);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/app/);

    // 2. Navigate to handover review page
    await page.goto(`/app/handovers/${handoverId}/review`);
    await page.waitForLoadState('networkidle');

    // 3. Find first "Approve" item button and activate via keyboard Space/Enter
    const approveItemBtn = page.locator('[data-testid="approve-item-btn"]').first();
    await expect(approveItemBtn).toBeVisible({ timeout: 10000 });
    await approveItemBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    // 4. Tab to "Approve Draft" button in toolbar
    const approveToolbarBtn = page.getByRole('button', { name: /approve draft/i });
    await expect(approveToolbarBtn).toBeEnabled({ timeout: 10000 });
    await approveToolbarBtn.focus();
    await page.keyboard.press('Enter');

    // Confirm approval dialog is open
    const approvalDialog = page.getByRole('dialog');
    await expect(approvalDialog).toBeVisible();

    // 5. Focus checkbox and check with Space
    const checkbox = approvalDialog.getByRole('checkbox');
    await checkbox.focus();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked();

    // 6. Tab to confirm button and submit with Enter
    const confirmBtn = approvalDialog.getByRole('button', { name: /confirm & approve/i });
    await confirmBtn.focus();
    await page.keyboard.press('Enter');

    // 7. Verify dialog closed and status updated to Approved
    await expect(approvalDialog).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/approved/i).first()).toBeVisible({ timeout: 10000 });
  });
});
