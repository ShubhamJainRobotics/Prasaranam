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
} from '@relay/database';
import { RelayWorker } from '../../apps/worker/src/worker.js';
import { FakeDeterministicProvider } from '../../apps/api/src/ai/providers/fake-provider.js';
import request from 'supertest';

test.describe('Knowledge Base & Clarifications E2E Flow', () => {
  let owner: TestUser;
  let pool: DbPool;
  let worker: RelayWorker;
  let projectId: string;
  let orgId: string;
  const timestamp = Date.now();
  const ownerEmail = `e2e-ai-owner-${timestamp}@relay.local`;
  const ownerPassword = 'OwnerPassword123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    owner = await createRealTestUser(ownerEmail, ownerPassword, 'AI Knowledge Owner');

    orgId = await bootstrapOrganisation(pool, owner.userId, `Knowledge E2E Org ${timestamp}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'E2E Knowledge Project',
      'AI Extraction and Knowledge testing',
      'software_engineering',
      'UTC'
    );

    // Pre-import a source with explicit decision, task, contradiction, and blocker
    const fakeApi = request('http://localhost:4000/api/v1');
    const importRes = await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Core Architecture and Cutover Plan',
        kind: 'text',
        content:
          'We decided to approve PostgreSQL for our core database. I propose we use Redis for cache sessions. We need to implement database schema migrations by Friday. The database cutover is scheduled for Monday at 9am. Integration tests are blocked by missing sandbox credentials.',
        visibility: 'project',
      });

    if (importRes.status !== 201) {
      throw new Error(
        `Failed to import test source in beforeAll: ${JSON.stringify(importRes.body)}`
      );
    }

    // Start background worker with fake provider
    const env = {
      ...mockDevServerEnv,
      AI_PROVIDER: 'fake' as const,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_POLL_INTERVAL_MS: 100,
    };
    const fakeProvider = new FakeDeterministicProvider('test', false);
    worker = new RelayWorker(pool, env, fakeProvider);
    worker.start();
  });

  test.afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
    if (owner) {
      await deleteRealTestUser(owner.userId);
    }
    if (pool) {
      await closeDbPool(pool);
    }
  });

  test('user can trigger extraction, view knowledge cards, open claim detail & evidence drawer, and answer clarification question', async ({
    page,
  }) => {
    test.setTimeout(60000);

    // 1. Log in
    await page.goto('/login');
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Verify redirected to /app
    await expect(page).toHaveURL(/\/app/);

    // 2. Navigate to Knowledge Base page
    await page.goto(`/app/projects/${projectId}/knowledge`);
    await expect(page.getByRole('heading', { name: 'Project Knowledge Base' })).toBeVisible();

    // 3. Trigger Extraction via the "Run Extraction" button
    const runExtractionBtn = page.getByRole('button', { name: 'Run Extraction' }).first();
    await expect(runExtractionBtn).toBeVisible();
    await runExtractionBtn.click();

    // Wait for Knowledge Cards to appear after worker processes extraction and relationship analysis
    const claimCard = page.locator('[data-testid="claim-card"]').first();
    await expect(claimCard).toBeVisible({ timeout: 20000 });

    // 4. Open Claim Detail panel
    await claimCard.click();
    const detailPanel = page.getByRole('dialog', { name: 'Claim Overview' });
    await expect(detailPanel).toBeVisible({ timeout: 5000 });

    // Close detail panel
    await page.getByRole('button', { name: 'Close claim details' }).click();
    await expect(detailPanel).toBeHidden({ timeout: 5000 });

    // 5. Open Evidence Drawer via the quotes button
    const viewEvidenceBtn = page.getByRole('button', { name: /\d+ quotes?/i }).first();
    await expect(viewEvidenceBtn).toBeVisible();
    await viewEvidenceBtn.click();
    const evidenceDrawer = page.getByRole('dialog', { name: 'Supporting Evidence' });
    await expect(evidenceDrawer).toBeVisible({ timeout: 5000 });

    // Close evidence drawer
    await page.getByRole('button', { name: 'Close evidence drawer' }).click();
    await expect(evidenceDrawer).toBeHidden({ timeout: 5000 });

    // 6. Navigate to Clarification Questions page
    await page.goto(`/app/projects/${projectId}/questions`);
    await expect(page.getByRole('heading', { name: 'Clarification Questions' })).toBeVisible();

    // Verify generated question card exists
    const questionCard = page.locator('.rounded-lg.border.bg-white').first();
    await expect(questionCard).toBeVisible({ timeout: 15000 });

    // 7. Answer question through dialog
    const answerBtn = page.getByRole('button', { name: 'Answer Question' }).first();
    await expect(answerBtn).toBeVisible();
    await answerBtn.click();

    // Dialog opens
    const answerDialog = page.getByRole('dialog', { name: 'Answer Clarification Question' });
    await expect(answerDialog).toBeVisible();

    // Fill answer and submit
    const textarea = page.getByLabel('Your Answer / Context');
    await textarea.fill(
      'We confirmed with the operations team that Monday at 9am is the cutover time.'
    );

    const submitBtn = page.getByRole('button', { name: 'Submit & Enqueue Extraction' });
    await submitBtn.click();

    // Verify toast confirmation and question card status updates
    await expect(
      page.getByText('Answer submitted; extraction enqueued for reviewer context')
    ).toBeVisible({ timeout: 10000 });
  });
});
