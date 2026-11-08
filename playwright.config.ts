import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Run E2E suites deterministically
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'npm run --workspace=@relay/api dev',
      url: 'http://localhost:4000/health/live',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        NODE_ENV: 'test',
        AI_PROVIDER: 'fake',
      },
    },
    {
      command: 'npm run --workspace=@relay/web dev -- --port 5173 --host 0.0.0.0',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
