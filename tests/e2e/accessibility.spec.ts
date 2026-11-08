import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
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

test.describe('Automated Axe Accessibility (WCAG 2.1 AA) Suite', () => {
  let pool: DbPool;
  let user: TestUser;
  let recipient: TestUser;
  let worker: RelayWorker;
  let orgId: string;
  let projectId: string;
  let sourceId: string;
  let handoverId: string;
  const timestamp = Date.now();
  const userEmail = `axe-auditor-${timestamp}@relay.local`;
  const userPassword = 'AxeAuditorPassword123!';
  const recipientEmail = `axe-recipient-${timestamp}@relay.local`;
  const recipientPassword = 'AxeRecipientPassword123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    user = await createRealTestUser(userEmail, userPassword, 'Axe Accessibility Auditor');
    recipient = await createRealTestUser(
      recipientEmail,
      recipientPassword,
      'Axe Recipient Auditor'
    );

    orgId = await bootstrapOrganisation(pool, user.userId, `Axe A11y Org ${timestamp}`);
    await addOrgMember(pool, user.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      user.userId,
      orgId,
      'A11y Audit Workspace',
      'Accessibility verification workspace',
      'software_engineering',
      'UTC'
    );
    await addProjectMember(pool, user.userId, projectId, recipient.userId, 'recipient');

    const fakeApi = request('http://localhost:4000/api/v1');

    // Import a source so sources and chunks pages have content
    const sourceRes = await fakeApi
      .post(`/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        title: 'Core Architecture Overview',
        kind: 'text',
        content:
          'Decision: We use PostgreSQL 16 for persistent storage. Proposal: We deploy automated Axe audits for all accessible components. Blocker: Need sandbox credentials.',
        visibility: 'project',
      });
    sourceId = sourceRes.body.data.sources[0].id;

    // Run extraction job via worker
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

    // Generate clarification questions
    await fakeApi
      .post(`/projects/${projectId}/questions/generate`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send();

    // Create a draft handover
    const hoRes = await fakeApi
      .post(`/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        title: 'Accessibility Test Handover',
        recipientId: recipient.userId,
        includedSections: ['snapshot', 'decisions', 'next_actions'],
        detailLevel: 'standard',
        includeCompletedWork: true,
        includeProposedNextActions: true,
        tone: 'professional',
      });

    console.log(
      'hoRes status:',
      hoRes.status,
      'details:',
      JSON.stringify(hoRes.body.error?.details)
    );

    if (hoRes.body?.data?.jobId) {
      let attempts = 0;
      while (attempts < 30) {
        const check = await fakeApi
          .get(`/jobs/${hoRes.body.data.jobId}`)
          .set('Authorization', `Bearer ${user.accessToken}`);
        console.log(
          'check attempt',
          attempts,
          check.body?.data?.status,
          check.body?.data?.lastError
        );
        if (check.body?.data?.status === 'succeeded') break;
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
    }

    const listRes = await fakeApi
      .get(`/projects/${projectId}/handovers`)
      .set('Authorization', `Bearer ${user.accessToken}`);
    console.log('listRes:', listRes.status, listRes.body);
    handoverId = listRes.body.data[0].id;
  });

  test.afterAll(async () => {
    if (worker) await worker.stop();
    if (user) await deleteRealTestUser(user.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (pool) await closeDbPool(pool);
  });

  async function auditPage(page: Page, path: string, label: string) {
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(500);

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      // Disable color-contrast on external SVGs/third-party gradients if necessary, or keep strict
      .analyze();

    const seriousViolations = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious' || v.impact === 'moderate'
    );

    expect(
      seriousViolations,
      `Accessibility violations on ${label} (${path}):\n${JSON.stringify(seriousViolations, null, 2)}`
    ).toEqual([]);
  }

  const viewports = [
    { name: 'Desktop (1280x800)', size: { width: 1280, height: 800 } },
    { name: 'Mobile (375x667)', size: { width: 375, height: 667 } },
  ];

  for (const vp of viewports) {
    test.describe(`${vp.name} Viewport Audits`, () => {
      test(`public authentication and landing pages at ${vp.name}`, async ({ page }) => {
        test.setTimeout(60000);
        await page.setViewportSize(vp.size);

        await auditPage(page, '/', `Landing [${vp.name}]`);
        await auditPage(page, '/login', `Login [${vp.name}]`);
        await auditPage(page, '/register', `Register [${vp.name}]`);
        await auditPage(page, '/forgot-password', `Forgot Password [${vp.name}]`);
        await auditPage(page, '/reset-password', `Reset Password [${vp.name}]`);
      });

      test(`authenticated application and workspace pages at ${vp.name}`, async ({ page }) => {
        test.setTimeout(90000);
        await page.setViewportSize(vp.size);

        // Sign in
        await page.goto('/login');
        await page.getByLabel('Email address').fill(userEmail);
        await page.getByLabel('Password').fill(userPassword);
        await page.getByRole('button', { name: 'Sign In' }).click();
        await expect(page).toHaveURL(/\/app/);

        // Scan authenticated pages
        await auditPage(page, '/app', `Org Overview [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/dashboard`, `Dashboard [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/sources`, `Sources [${vp.name}]`);
        await auditPage(
          page,
          `/app/projects/${projectId}/sources/${sourceId}`,
          `Source Viewer [${vp.name}]`
        );
        await auditPage(page, `/app/projects/${projectId}/knowledge`, `Knowledge [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/questions`, `Questions [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/handovers`, `Handovers [${vp.name}]`);
        await auditPage(
          page,
          `/app/projects/${projectId}/handovers/new`,
          `New Handover [${vp.name}]`
        );
        await auditPage(
          page,
          `/app/handovers/${handoverId}/review`,
          `Handover Review [${vp.name}]`
        );
        await auditPage(page, `/app/handovers/${handoverId}`, `Handover Viewer [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/ask`, `Ask Relay [${vp.name}]`);
        await auditPage(page, `/app/projects/${projectId}/members`, `Project Members [${vp.name}]`);
        await auditPage(
          page,
          `/app/projects/${projectId}/settings`,
          `Project Settings [${vp.name}]`
        );
        await auditPage(
          page,
          `/app/organisations/${orgId}/members`,
          `Organisation Members [${vp.name}]`
        );
        await auditPage(page, '/app/settings', `User Settings [${vp.name}]`);
      });
    });
  }
});
