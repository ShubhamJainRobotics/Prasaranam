import { test, expect } from '@playwright/test';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';
import { createDbPool, closeDbPool, bootstrapOrganisation, createProject } from '@relay/database';

test.describe('Source Ingestion & Evidence Viewer E2E', () => {
  let owner: TestUser;
  let pool: any;
  let projectId: string;
  let orgId: string;
  const timestamp = Date.now();
  const ownerEmail = `e2e-source-owner-${timestamp}@relay.local`;
  const ownerPassword = 'OwnerPassword123!';

  test.beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    owner = await createRealTestUser(ownerEmail, ownerPassword, 'Source Owner');

    orgId = await bootstrapOrganisation(pool, owner.userId, `Sources E2E Org ${timestamp}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'E2E Sources Project',
      'Ingestion and evidence E2E testing',
      'software_engineering',
      'UTC'
    );
  });

  test.afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (pool) await closeDbPool(pool);
  });

  test('user can log in, view sources page, import source via wizard, and inspect chunks in viewer', async ({
    page,
  }) => {
    test.setTimeout(45000);

    // 1. Log in
    await page.goto('/login');
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Sign In' }).click();

    // Wait until navigated to /app
    await expect(page).toHaveURL(/\/app/);

    // 2. Navigate to Project Sources
    await page.goto(`/app/projects/${projectId}/sources`);
    await expect(page.getByRole('heading', { name: 'Project Sources' })).toBeVisible();

    // 3. Open Import Wizard
    const importBtn = page.getByRole('button', { name: 'Import Sources' });
    await expect(importBtn).toBeVisible();
    await importBtn.click();

    // Verify dialog opened
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import Project Sources' })).toBeVisible();

    // 4. Switch to Paste Text tab
    await page.getByRole('button', { name: 'Paste Text' }).click();

    // Fill paste form
    await page.getByLabel('Title', { exact: false }).fill('E2E Pasted Decision Note');
    await page
      .getByPlaceholder('Paste project discussion, meeting notes')
      .fill(
        'We decided to approve PostgreSQL for our core transaction ledger.\n\nTransactions require strict serializable isolation.'
      );

    // Submit import
    await page.getByRole('button', { name: 'Start Import' }).click();

    // Modal closes and source appears in the table
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText('E2E Pasted Decision Note')).toBeVisible();

    // 5. Click View on the source
    await page.getByRole('link', { name: 'View' }).first().click();

    // Navigates to SourceDetailPage
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/sources/`));
    await expect(page.getByRole('heading', { name: 'E2E Pasted Decision Note' })).toBeVisible();

    // 6. Verify SourceViewer and ChunkHighlighter
    await expect(page.getByText('Canonical Content')).toBeVisible();
    await expect(page.getByText('Extracted Chunks')).toBeVisible();
    await expect(
      page
        .locator('pre')
        .getByText('We decided to approve PostgreSQL for our core transaction ledger.')
    ).toBeVisible();

    // 7. Click Chunk to highlight
    const chunkCard = page.getByRole('button', { name: 'Chunk 0' });
    await expect(chunkCard).toBeVisible();
    await chunkCard.click();

    // Verify highlighted <mark> element is active
    const mark = page.locator('mark');
    await expect(mark).toBeVisible();
    await expect(mark).toContainText('We decided to approve PostgreSQL');
  });
});
