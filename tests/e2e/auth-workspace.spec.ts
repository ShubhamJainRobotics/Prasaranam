import { test, expect } from '@playwright/test';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

async function getMailpitMessage(
  recipientEmail: string,
  subjectFilter?: string,
  timeoutMs = 15000
) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch('http://127.0.0.1:54324/api/v1/messages');
      if (res.ok) {
        const data = await res.json();
        const msg = data.messages?.find((m: any) => {
          const toMatch = m.To?.some(
            (t: any) => t.Address?.toLowerCase() === recipientEmail.toLowerCase()
          );
          if (!toMatch) return false;
          if (subjectFilter && !m.Subject?.toLowerCase().includes(subjectFilter.toLowerCase())) {
            return false;
          }
          return true;
        });
        if (msg) {
          const fullRes = await fetch(`http://127.0.0.1:54324/api/v1/message/${msg.ID}`);
          if (fullRes.ok) {
            return await fullRes.json();
          }
        }
      }
    } catch {
      // Retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timeout waiting for email to ${recipientEmail}`);
}

function extractLinkFromEmail(htmlOrText: string): string {
  const match = htmlOrText.match(/href="([^"]+)"/) || htmlOrText.match(/(https?:\/\/[^\s"']+)/);
  if (!match || !match[1]) {
    throw new Error('Could not find link in email body');
  }
  return match[1].replace(/&amp;/g, '&');
}

test.describe('Landing Page Navigation', () => {
  test('Get started and Sign in buttons navigate to register and login without showing not-found page', async ({
    page,
  }) => {
    await page.goto('/');

    // 1. Click Get Started
    await page.getByRole('link', { name: 'Get Started' }).click();
    await expect(page).toHaveURL(/\/register$/);
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await expect(page.getByText('Page Not Found')).not.toBeVisible();

    // 2. Go back and click Sign In
    await page.goto('/');
    await page.getByRole('link', { name: 'Sign In' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
    await expect(page.getByText('Page Not Found')).not.toBeVisible();
  });
});

test.describe('Auth and Workspace Lifecycle E2E', () => {
  let memberUser: TestUser;
  const timestamp = Date.now();
  const ownerEmail = `e2e-owner-${timestamp}@relay.local`;
  const ownerPassword = 'OwnerPassword123!';
  const updatedOwnerPassword = 'NewOwnerPassword456!';
  const orgName = `E2E Org ${timestamp}`;
  const projectName = `E2E Project ${timestamp}`;

  test.beforeAll(async () => {
    // Create member user ahead of time
    memberUser = await createRealTestUser(
      `e2e-member-${timestamp}@relay.local`,
      'MemberPass123!',
      'E2E Member User'
    );
  });

  test.afterAll(async () => {
    if (memberUser) {
      await deleteRealTestUser(memberUser.userId);
    }
  });

  test('complete registration, email confirmation, organisation & project creation, member access and removal, logout, and password reset', async ({
    page,
    browser,
  }) => {
    test.setTimeout(60000);
    // 1. Register a new user
    await page.goto('/register');
    await page.getByLabel('Full Display Name').fill('E2E Owner');
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByLabel('Password').fill(ownerPassword);
    await page.getByRole('button', { name: 'Create account' }).click();

    // Verify confirmation notice is shown
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    await expect(page.getByText(ownerEmail)).toBeVisible();

    // 2. Receive confirmation email via Mailpit API
    const emailMsg = await getMailpitMessage(ownerEmail, 'confirm');
    expect(emailMsg).toBeDefined();

    const emailContent = emailMsg.HTML || emailMsg.Text || '';
    const confirmLink = extractLinkFromEmail(emailContent);
    expect(confirmLink).toContain('token');

    // 3. Confirm email by visiting the confirmation link
    await page.goto(confirmLink);

    // Should complete auth callback and land on /app
    await page.waitForURL(/\/app/, { timeout: 15000 });

    // 4. Create Organisation
    // If onboarding empty state appears, click Create Organisation
    const createOrgBtn = page.getByRole('button', { name: 'Create Organisation' });
    await expect(createOrgBtn).toBeVisible();
    await createOrgBtn.click();

    // Fill Create Organisation modal
    await page.getByLabel('Organisation Name').fill(orgName);
    await page.getByRole('dialog').getByRole('button', { name: 'Create Organisation' }).click();

    // Land on organisation overview
    await page.waitForURL(/\/app\/organisations\//);
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible();

    // 5. Add second user to Organisation
    await page.getByRole('link', { name: 'Manage Members' }).click();
    await page.waitForURL(/\/app\/organisations\/.*\/members/);

    await page.getByRole('button', { name: '+ Add Member' }).click();
    await page.getByLabel('Email Address').fill(memberUser.email);
    await page.getByRole('dialog').getByRole('button', { name: 'Add Member' }).click();
    await expect(
      page.getByText('If an account exists with this email, the member has been added')
    ).toBeVisible();

    // 6. Create Project in Organisation
    await page.goto(page.url().replace('/members', ''));
    await page.getByRole('button', { name: '+ New Project' }).click();
    await page.getByLabel('Project Name').fill(projectName);
    await page.getByLabel('Domain').selectOption('software_engineering');
    await page.getByRole('dialog').getByRole('button', { name: 'Create Project' }).click();

    // Land on Project Dashboard
    await page.waitForURL(/\/app\/projects\//);
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible();
    const projectUrl = page.url();

    // 7. Add second user as Project Member
    await page
      .getByRole('main')
      .getByRole('link', { name: /Members/ })
      .click();
    await page.waitForURL(/\/app\/projects\/.*\/members/);
    await expect(page.getByRole('heading', { name: `${projectName} Members` })).toBeVisible();

    await page.getByRole('button', { name: '+ Add Member' }).click();
    await page.getByLabel('Email Address').fill(memberUser.email);
    await page.getByLabel('Project Role').selectOption('contributor');
    await page.getByRole('dialog').getByRole('button', { name: 'Add Member' }).click();
    await expect(
      page.getByText('If an account exists with this email, the member has been added')
    ).toBeVisible();

    // Verify member appears in members table
    await expect(page.getByText('E2E Member User')).toBeVisible();

    // 8. Verify Member Access in a second browser session
    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    await memberPage.goto('/login');
    await memberPage.getByLabel('Email address').fill(memberUser.email);
    await memberPage.getByLabel('Password').fill('MemberPass123!');
    await memberPage.getByRole('button', { name: 'Sign in' }).click();
    await memberPage.waitForURL(/\/app/);

    // Member visits project
    await memberPage.goto(projectUrl);
    await expect(memberPage.getByRole('heading', { name: projectName })).toBeVisible();

    // 9. Owner removes Member from Project
    await page.bringToFront();
    // In Project Members Table, click Remove for memberUser
    const memberRow = page.locator('tr', { hasText: 'E2E Member User' });
    await memberRow.getByRole('button', { name: 'Remove' }).click();

    // Confirm removal in dialog
    const confirmBtn = page.getByRole('button', { name: 'Remove Member' });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    await expect(page.getByText('Member removed from project')).toBeVisible();

    // 10. Member immediately loses access: API returns 404, UI shows Not Found
    await memberPage.bringToFront();
    await memberPage.reload();
    await expect(memberPage.getByRole('heading', { name: 'Page not found' })).toBeVisible();
    await expect(memberPage.getByText('The page you are looking for does not exist')).toBeVisible();
    await memberContext.close();

    // 11. Sign Out Owner
    await page.bringToFront();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();

    // 12. Password Reset
    await page.goto('/forgot-password');
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByRole('button', { name: 'Send reset instructions' }).click();
    await expect(page.getByText('Check your inbox for a password reset email')).toBeVisible();

    // Poll Mailpit for reset email
    const resetMsg = await getMailpitMessage(ownerEmail, 'reset');
    const resetContent = resetMsg.HTML || resetMsg.Text || '';
    const resetLink = extractLinkFromEmail(resetContent);
    expect(resetLink).toBeDefined();

    // Follow reset link
    await page.goto(resetLink);
    await page.waitForURL(/\/reset-password/);
    await page.getByLabel('New Password').fill(updatedOwnerPassword);
    await page.getByRole('button', { name: 'Update Password' }).click();

    // Redirected to login
    await page.waitForURL(/\/login$/);
    await expect(page.getByText('Password updated successfully')).toBeVisible();

    // Sign in with updated password
    await page.getByLabel('Email address').fill(ownerEmail);
    await page.getByLabel('Password').fill(updatedOwnerPassword);
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Reaches workspace
    await page.waitForURL(/\/app/);
    await expect(page.getByRole('heading', { name: orgName })).toBeVisible();
  });
});
