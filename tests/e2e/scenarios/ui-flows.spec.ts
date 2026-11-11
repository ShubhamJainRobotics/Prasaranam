import fs from 'node:fs';
import path from 'node:path';
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
import { getFeatureInventory } from '../../../scripts/feature-inventory.js';
import { RelayWorker } from '../../../apps/worker/src/worker.js';
import { FakeDeterministicProvider } from '../../../apps/api/src/ai/providers/fake-provider.js';

const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results/scenario-screenshots');

test.describe('Scenario Pack & UI Flows Health Check', () => {
  let pool: DbPool;
  let worker: RelayWorker;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let orgId: string;
  let projectId: string;
  let sourceId: string;
  let handoverId: string;

  const ts = Date.now();
  const ownerEmail = `scn-ui-owner-${ts}@example.test`;
  const ownerPass = 'UiPass12345!';
  const reviewerEmail = `scn-ui-rev-${ts}@example.test`;
  const reviewerPass = 'UiPass12345!';
  const recipientEmail = `scn-ui-recip-${ts}@example.test`;
  const recipientPass = 'UiPass12345!';

  test.beforeAll(async () => {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    pool = createDbPool(mockDevServerEnv.DATABASE_URL);

    // Setup seed users
    owner = await createRealTestUser(ownerEmail, ownerPass, 'Scenario Owner');
    reviewer = await createRealTestUser(reviewerEmail, reviewerPass, 'Scenario Reviewer');
    recipient = await createRealTestUser(recipientEmail, recipientPass, 'Scenario Recipient');

    orgId = await bootstrapOrganisation(pool, owner.userId, `scn-org-ui-${ts}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `scn-proj-ui-${ts}`,
      'Payments Integration',
      'software_engineering',
      'UTC'
    );

    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // Start background worker for async AI jobs (extraction, handover generation)
    const workerEnv = {
      ...mockDevServerEnv,
      AI_PROVIDER: 'fake' as const,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_POLL_INTERVAL_MS: 100,
    };
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, workerEnv as any, fakeProvider);
    worker.start();

    // Dynamically check feature inventory
    const inventory = getFeatureInventory();
    const notBuiltWeb = inventory.webRoutes.filter((r) => r.status === 'not built');
    for (const nb of notBuiltWeb) {
      console.log(
        `[Feature Inventory] Verified web route '${nb.path}' is marked 'not built'. Skipping UI flow.`
      );
    }
  });

  test.afterAll(async () => {
    if (worker) await worker.stop();
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  test('walks through key application UI flows capturing visual screenshots', async ({
    page,
    browser,
  }) => {
    test.setTimeout(90000);

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 1: Register and Sign-in pages
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-register.png'), fullPage: true });

    await page.goto('/login');
    await expect(page.getByRole('heading', { name: /sign in to your account/i })).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-login.png'), fullPage: true });

    // Authenticate as owner
    await page.getByLabel(/email address/i).fill(ownerEmail);
    await page.getByLabel(/password/i).fill(ownerPass);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/app/);

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 2: Organisation & Project dashboard
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}`);
    await expect(page.getByText(`scn-proj-ui-${ts}`).first()).toBeVisible({ timeout: 15000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-org-project.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 3: Managing members
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}/members`);
    await expect(page.getByRole('heading', { name: /members/i })).toBeVisible();
    await expect(page.getByText(ownerEmail)).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-members.png'), fullPage: true });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 4: Importing a source
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}/sources`);
    await expect(page.getByRole('heading', { name: /sources/i }).first()).toBeVisible();

    // Use API to import text source with rich facts
    const apiRes = await fetch(
      `http://127.0.0.1:4000/api/v1/projects/${projectId}/sources/import`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${reviewer.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          kind: 'text',
          visibility: 'project',
          title: 'Payments Integration Architecture',
          content:
            'We decided to use Stripe and PayPal. We plan to launch payments integration on Friday.\n\nWe will launch payments integration on Monday.',
        }),
      }
    );
    const sJson = await apiRes.json();
    sourceId = sJson.data.sources[0].id;

    // Trigger extraction
    await fetch(`http://127.0.0.1:4000/api/v1/projects/${projectId}/extractions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reviewer.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });

    await page.reload();
    await expect(page.getByText('Payments Integration Architecture').first()).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-import-sources.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 5: Viewing evidence (Chunk viewer)
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}/sources/${sourceId}`);
    await expect(page.getByText('Payments Integration Architecture').first()).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '06-chunk-viewer.png'),
      fullPage: true,
    });

    // Wait for worker extraction to finish
    await page.waitForTimeout(2500);

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 6: Knowledge page
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}/knowledge`);
    await expect(page.getByRole('heading', { name: /knowledge/i }).first()).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '07-knowledge-page.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 7: Clarification questions page
    // ─────────────────────────────────────────────────────────────────────────
    await page.goto(`/app/projects/${projectId}/questions`);
    await expect(page.getByRole('heading', { name: /questions/i }).first()).toBeVisible();
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '08-questions-page.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 8: Handover review and approval flow (as Reviewer)
    // ─────────────────────────────────────────────────────────────────────────
    // Reviewer generates handover
    const hoRes = await fetch(`http://127.0.0.1:4000/api/v1/projects/${projectId}/handovers`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reviewer.accessToken}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        title: 'Core Payments Handover',
        recipientId: recipient.userId,
        departingUserId: reviewer.userId,
        includedSections: ['snapshot', 'decisions', 'next_actions'],
        detailLevel: 'standard',
        includeCompletedWork: true,
        includeProposedNextActions: true,
        tone: 'professional',
      }),
    });
    const hoJson = await hoRes.json();
    const jobId = hoJson.data.jobId;

    // Poll until handover draft is ready
    let draftId: string | undefined;
    for (let i = 0; i < 30; i++) {
      const jRes = await fetch(`http://127.0.0.1:4000/api/v1/jobs/${jobId}`, {
        headers: { Authorization: `Bearer ${reviewer.accessToken}` },
      });
      const jData = await jRes.json();
      if (jData.data?.status === 'succeeded') {
        draftId = jData.data.resultRef || jData.data.result?.handoverId;
        break;
      }
      await page.waitForTimeout(400);
    }
    handoverId = draftId!;

    // Sign in as Reviewer in a fresh context
    const reviewerContext = await browser.newContext();
    const revPage = await reviewerContext.newPage();
    await revPage.goto('/login');
    await revPage.getByLabel(/email address/i).fill(reviewerEmail);
    await revPage.getByLabel(/password/i).fill(reviewerPass);
    await revPage.getByRole('button', { name: /sign in/i }).click();
    await expect(revPage).toHaveURL(/\/app/);

    await revPage.goto(`/app/handovers/${handoverId}/review`);
    await expect(revPage.getByRole('heading', { name: /Core Payments Handover/i })).toBeVisible({
      timeout: 15000,
    });
    await revPage.screenshot({
      path: path.join(SCREENSHOT_DIR, '09-handover-review.png'),
      fullPage: true,
    });

    // Approve items and approve handover
    const hoDetailRes = await fetch(`http://127.0.0.1:4000/api/v1/handovers/${handoverId}`, {
      headers: { Authorization: `Bearer ${reviewer.accessToken}` },
    });
    const hoDetail = await hoDetailRes.json();
    for (const it of hoDetail.data.items || []) {
      await fetch(`http://127.0.0.1:4000/api/v1/handovers/${handoverId}/items/${it.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${reviewer.accessToken}`,
          'Content-Type': 'application/json',
          'If-Match': String(it.rowVersion),
        },
        body: JSON.stringify({ reviewState: 'approved' }),
      });
    }

    await fetch(`http://127.0.0.1:4000/api/v1/handovers/${handoverId}/approve`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reviewer.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ confirmReviewedForRecipient: true }),
    });

    await fetch(`http://127.0.0.1:4000/api/v1/handovers/${handoverId}/share`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${reviewer.accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 9: Recipient view of shared handover
    // ─────────────────────────────────────────────────────────────────────────
    const recipContext = await browser.newContext();
    const recipPage = await recipContext.newPage();
    await recipPage.goto('/login');
    await recipPage.getByLabel(/email address/i).fill(recipientEmail);
    await recipPage.getByLabel(/password/i).fill(recipientPass);
    await recipPage.getByRole('button', { name: /sign in/i }).click();
    await expect(recipPage).toHaveURL(/\/app/);

    await recipPage.goto(`/app/handovers/${handoverId}`);
    await expect(recipPage.getByText('Core Payments Handover').first()).toBeVisible({
      timeout: 15000,
    });
    await recipPage.screenshot({
      path: path.join(SCREENSHOT_DIR, '10-recipient-handover.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 10: Q&A page
    // ─────────────────────────────────────────────────────────────────────────
    await recipPage.goto(`/app/projects/${projectId}/ask`);
    await expect(recipPage.getByRole('heading', { name: /ask/i }).first()).toBeVisible({
      timeout: 15000,
    });
    await recipPage.screenshot({
      path: path.join(SCREENSHOT_DIR, '11-qa-page.png'),
      fullPage: true,
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Flow 11: Export menu
    // ─────────────────────────────────────────────────────────────────────────
    await recipPage.goto(`/app/handovers/${handoverId}`);
    const exportBtn = recipPage.getByRole('button', { name: /export/i });
    if (await exportBtn.isVisible()) {
      await exportBtn.click();
      await recipPage.screenshot({ path: path.join(SCREENSHOT_DIR, '12-export-menu.png') });
    }

    await reviewerContext.close();
    await recipContext.close();
  });
});
