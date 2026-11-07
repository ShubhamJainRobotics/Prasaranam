import { test, expect } from '@playwright/test';

test.describe('Landing Page E2E', () => {
  test('loads product landing page with accessible headings and branding', async ({ page }) => {
    await page.goto('/');

    // 1. Verify page title
    await expect(page).toHaveTitle(/Relay/);

    // 2. Verify main heading
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('Evidence-backed knowledge handovers');

    // 3. Verify core navigation / call-to-action
    const getStartedLink = page.getByRole('link', { name: 'Get Started' });
    await expect(getStartedLink).toBeVisible();

    const signInLink = page.getByRole('link', { name: 'Sign In' }).first();
    await expect(signInLink).toBeVisible();

    // 4. Verify three capability columns exist
    await expect(page.getByText('1. Authorised Activity')).toBeVisible();
    await expect(page.getByText('2. Evidence Grounding')).toBeVisible();
    await expect(page.getByText('3. Recipient Scope')).toBeVisible();
  });
});
