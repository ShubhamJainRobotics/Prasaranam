import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import request from 'supertest';
import { createDbPool, closeDbPool, type DbPool } from '@relay/database';
import { serverEnvironmentSchema, type ServerEnvironment } from '@relay/contracts';
import { getTestSupabaseConfig } from '@relay/test-fixtures';
import { createApp } from '../apps/api/src/app.js';
import { RelayWorker } from '../apps/worker/src/worker.js';
import { getFeatureInventory } from './feature-inventory.js';
import {
  assertLocalEnvironment,
  resetScenarioData,
  createScenarioContext,
  createScenarioUser,
} from '../packages/test-fixtures/scenarios/context.js';
import {
  allScenarios,
  type StepExecutionResult,
} from '../packages/test-fixtures/scenarios/index.js';

interface ScenarioRunStepReport {
  id: string;
  name: string;
  feature: string;
  action: string;
  expectedResult: string;
  status: 'passed' | 'broken' | 'not built';
  durationMs?: number;
  request?: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  responseStatus?: number;
  expected?: string;
  actual?: unknown;
  likelySourceFile?: string;
  errorDetails?: string;
}

interface ScenarioRunReport {
  scenarioNumber: number;
  scenarioId: string;
  scenarioName: string;
  passedCount: number;
  brokenCount: number;
  notBuiltCount: number;
  steps: ScenarioRunStepReport[];
}

interface ScenarioHealthReport {
  generatedAt: string;
  summary: {
    totalScenarios: number;
    totalSteps: number;
    passedSteps: number;
    brokenSteps: number;
    notBuiltSteps: number;
  };
  commands: {
    typecheck: { passed: boolean; output: string };
    lint: { passed: boolean; output: string };
    test: { passed: boolean; output: string };
  };
  scenarios: ScenarioRunReport[];
}

function runCommand(cmd: string): { passed: boolean; output: string } {
  try {
    const stdout = execSync(cmd, {
      cwd: process.cwd(),
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120000,
    });
    return { passed: true, output: stdout.trim() };
  } catch (err: any) {
    const out = (err.stdout || '') + '\n' + (err.stderr || '') + '\n' + (err.message || '');
    return { passed: false, output: out.trim() };
  }
}

async function handleResetOnly(pool: DbPool): Promise<void> {
  console.log('[Scenario Reset] Purging all scn-* test data and @example.test users...');
  const res = await resetScenarioData(pool);
  console.log(
    `[Scenario Reset] Done. Deleted ${res.deletedOrgs} organisations, ${res.deletedProjects} projects, ${res.deletedUsers} Supabase auth users.`
  );
}

async function handleSeedOnly(pool: DbPool, app: any, env: ServerEnvironment): Promise<void> {
  console.log('[Scenario Seed] Purging prior scenario data...');
  await resetScenarioData(pool);

  console.log('[Scenario Seed] Creating seed users for manual walkthrough...');
  const ts = Date.now();
  const ownerPass = `SeedOwner-${crypto.randomBytes(6).toString('hex')}!`;
  const reviewerPass = `SeedReviewer-${crypto.randomBytes(6).toString('hex')}!`;
  const recipientPass = `SeedRecipient-${crypto.randomBytes(6).toString('hex')}!`;
  const contributorPass = `SeedContrib-${crypto.randomBytes(6).toString('hex')}!`;

  const owner = await createScenarioUser(
    `scn-seed-owner-${ts}@example.test`,
    'Seed Owner',
    ownerPass
  );
  const reviewer = await createScenarioUser(
    `scn-seed-reviewer-${ts}@example.test`,
    'Seed Reviewer (Dana Vance)',
    reviewerPass
  );
  const recipient = await createScenarioUser(
    `scn-seed-recipient-${ts}@example.test`,
    'Seed Recipient (Samira Patel)',
    recipientPass
  );
  const contributor = await createScenarioUser(
    `scn-seed-contrib-${ts}@example.test`,
    'Seed Contributor (Alex Chen)',
    contributorPass
  );

  console.log('[Scenario Seed] Bootstrapping workspace and project...');
  const orgRes = await request(app)
    .post('/api/v1/organisations')
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ name: `scn-org-seed-${ts}` });
  const orgId = orgRes.body.data.id;

  await request(app)
    .post(`/api/v1/organisations/${orgId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: reviewer.email, role: 'member' });
  await request(app)
    .post(`/api/v1/organisations/${orgId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: recipient.email, role: 'member' });
  await request(app)
    .post(`/api/v1/organisations/${orgId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: contributor.email, role: 'member' });

  const projRes = await request(app)
    .post(`/api/v1/organisations/${orgId}/projects`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ name: `scn-proj-seed-payments-${ts}`, domain: 'software_engineering' });
  const projectId = projRes.body.data.id;

  await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: reviewer.email, role: 'reviewer' });
  await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: recipient.email, role: 'recipient' });
  await request(app)
    .post(`/api/v1/projects/${projectId}/members`)
    .set('Authorization', `Bearer ${owner.accessToken}`)
    .send({ email: contributor.email, role: 'contributor' });

  console.log('[Scenario Seed] Importing sample project sources...');
  // 1. Architecture Decisions (Project visible)
  await request(app)
    .post(`/api/v1/projects/${projectId}/sources/import`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .field('sourceType', 'text')
    .field('visibility', 'project')
    .field('title', 'Architecture Decisions (ADR-001)')
    .field(
      'content',
      'We decided to use PostgreSQL 16 for all transactional data.\n\nWe propose Redis 7 for caching.'
    );

  // 2. Launch Timeline Conflict
  await request(app)
    .post(`/api/v1/projects/${projectId}/sources/import`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .field('sourceType', 'text')
    .field('visibility', 'project')
    .field('title', 'Release Coordination')
    .field(
      'content',
      'We plan to launch payments integration on Friday.\n\nWe will launch payments integration on Monday.'
    );

  // 3. Blocker & Tasks
  await request(app)
    .post(`/api/v1/projects/${projectId}/sources/import`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .field('sourceType', 'text')
    .field('visibility', 'project')
    .field('title', 'Sprint Status')
    .field(
      'content',
      'We cannot deploy because sandbox credentials are missing.\n\nWe need to build the audit log service.'
    );

  // 4. Restricted Source (Reviewer only)
  await request(app)
    .post(`/api/v1/projects/${projectId}/sources/import`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .field('sourceType', 'text')
    .field('visibility', 'restricted')
    .field('title', 'Confidential Personnel & Bonus Notes')
    .field(
      'content',
      'Executive transition bonus allocated: $25,000 upon successful knowledge transfer.'
    );

  // Run extraction job
  console.log('[Scenario Seed] Running extraction job...');
  const worker = new RelayWorker(pool, env);
  worker.start();

  const extractRes = await request(app)
    .post(`/api/v1/projects/${projectId}/extractions`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({});
  const jobId = extractRes.body.data.jobId;

  const start = Date.now();
  while (Date.now() - start < 15000) {
    const jRes = await request(app)
      .get(`/api/v1/jobs/${jobId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    if (jRes.body?.data?.status === 'succeeded') {
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  // Generate, approve, and share handover
  console.log('[Scenario Seed] Generating, approving, and sharing seed handover...');
  const hoGenRes = await request(app)
    .post(`/api/v1/projects/${projectId}/handovers`)
    .set('Authorization', `Bearer ${reviewer.accessToken}`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      title: 'Payments Engineering Handover',
      recipientId: recipient.id,
      departingUserId: reviewer.id,
      includedSections: ['snapshot', 'decisions', 'risks_dependencies', 'next_actions'],
      detailLevel: 'standard',
      includeCompletedWork: true,
      includeProposedNextActions: true,
      tone: 'professional',
    });

  const hoJobId = hoGenRes.body.data.jobId;
  let hoId: string | undefined;
  const hoStart = Date.now();
  while (Date.now() - hoStart < 15000) {
    const jRes = await request(app)
      .get(`/api/v1/jobs/${hoJobId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    if (jRes.body?.data?.status === 'succeeded') {
      hoId = jRes.body.data.resultRef || jRes.body.data.result?.handoverId;
      break;
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  if (hoId) {
    // Approve all items
    const hoDetail = await request(app)
      .get(`/api/v1/handovers/${hoId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);
    for (const item of hoDetail.body?.data?.items || []) {
      await request(app)
        .patch(`/api/v1/handovers/${hoId}/items/${item.id}`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('If-Match', String(item.rowVersion))
        .send({ reviewState: 'approved' });
    }
    await request(app)
      .post(`/api/v1/handovers/${hoId}/approve`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({ confirmReviewedForRecipient: true });
    await request(app)
      .post(`/api/v1/handovers/${hoId}/share`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({});
  }

  await worker.stop();

  console.log('\n======================================================');
  console.log('  SCENARIO SEED COMPLETE - LOCAL CREDENTIALS');
  console.log('======================================================');
  console.log(`Organisation ID: ${orgId}`);
  console.log(`Project ID:      ${projectId}`);
  console.log(`Shared Handover: ${hoId || 'none'}\n`);
  console.log('User Accounts:');
  console.log(`  1. Owner:        ${owner.email}`);
  console.log(`     Password:     ${ownerPass}`);
  console.log(`  2. Reviewer:     ${reviewer.email}`);
  console.log(`     Password:     ${reviewerPass}`);
  console.log(`  3. Recipient:    ${recipient.email}`);
  console.log(`     Password:     ${recipientPass}`);
  console.log(`  4. Contributor:  ${contributor.email}`);
  console.log(`     Password:     ${contributorPass}`);
  console.log('======================================================');
  console.log('NOTE: Credentials printed once. Not saved to disk.\n');
}

async function handleRun(pool: DbPool, app: any, env: ServerEnvironment): Promise<void> {
  console.log('[Scenario Run] Initializing Feature Inventory & Environment...');
  const inventory = getFeatureInventory();
  const unbuiltRoutes = new Set([
    ...inventory.apiRoutes
      .filter((r) => r.status === 'not built')
      .map((r) => `${r.method} ${r.path}`),
    ...inventory.webRoutes.filter((r) => r.status === 'not built').map((r) => r.path),
  ]);

  console.log(
    `[Scenario Run] Identified ${unbuiltRoutes.size} unbuilt route(s): ${Array.from(unbuiltRoutes).join(', ')}`
  );

  console.log('[Scenario Run] Resetting prior scenario state...');
  await resetScenarioData(pool);

  // Start background worker for async jobs
  const worker = new RelayWorker(pool, env);
  worker.start();

  const scenarioReports: ScenarioRunReport[] = [];
  let totalStepsCount = 0;
  let totalPassedCount = 0;
  let totalBrokenCount = 0;
  let totalNotBuiltCount = 0;

  console.log('\n-------------------------------------------------------------');
  console.log('  EXECUTING SYNTHETIC TEST SCENARIO PACK (SCENARIOS 1 - 9)');
  console.log('-------------------------------------------------------------\n');

  try {
    for (const scenario of allScenarios) {
      console.log(`\n▶ Scenario ${scenario.number}: ${scenario.name}`);
      const ctx = createScenarioContext(pool, app, env);
      const stepReports: ScenarioRunStepReport[] = [];
      let scnPassed = 0;
      let scnBroken = 0;
      let scnNotBuilt = 0;

      for (const step of scenario.steps) {
        totalStepsCount++;
        const startTime = Date.now();

        // Check if feature is unbuilt in feature inventory
        const isUnbuilt =
          unbuiltRoutes.has(step.feature) ||
          Array.from(unbuiltRoutes).some((ur) => step.feature.includes(ur));

        if (isUnbuilt) {
          totalNotBuiltCount++;
          scnNotBuilt++;
          console.log(`  [NOT BUILT] ${step.id}: ${step.name} (Feature: ${step.feature})`);
          stepReports.push({
            id: step.id,
            name: step.name,
            feature: step.feature,
            action: step.action,
            expectedResult: step.expectedResult,
            status: 'not built',
            durationMs: Date.now() - startTime,
            expected: 'Not built in current release',
            actual: 'Feature not registered in application router',
          });
          continue;
        }

        try {
          const result: StepExecutionResult = await step.run(ctx);
          const durationMs = Date.now() - startTime;

          if (result.status === 'not built') {
            totalNotBuiltCount++;
            scnNotBuilt++;
            console.log(`  [NOT BUILT] ${step.id}: ${step.name}`);
          } else if (result.status === 'passed') {
            totalPassedCount++;
            scnPassed++;
            console.log(`  ✓ [PASSED]  ${step.id}: ${step.name} (${durationMs}ms)`);
          } else {
            totalBrokenCount++;
            scnBroken++;
            console.log(`  ✗ [BROKEN]  ${step.id}: ${step.name} (${durationMs}ms)`);
            if (result.errorDetails) {
              console.log(`     Error: ${result.errorDetails}`);
            }
          }

          stepReports.push({
            id: step.id,
            name: step.name,
            feature: step.feature,
            action: step.action,
            expectedResult: step.expectedResult,
            status: result.status,
            durationMs,
            request: result.request,
            responseStatus: result.responseStatus,
            expected: result.expected,
            actual: result.actual,
            likelySourceFile: result.likelySourceFile,
            errorDetails: result.errorDetails,
          });
        } catch (stepErr: any) {
          const durationMs = Date.now() - startTime;
          totalBrokenCount++;
          scnBroken++;
          console.log(`  ✗ [BROKEN]  ${step.id}: ${step.name} - Exception thrown`);
          console.log(`     Exception: ${stepErr.message}`);

          stepReports.push({
            id: step.id,
            name: step.name,
            feature: step.feature,
            action: step.action,
            expectedResult: step.expectedResult,
            status: 'broken',
            durationMs,
            expected: step.expectedResult,
            actual: stepErr.message,
            errorDetails: stepErr.stack,
          });
        }
      }

      scenarioReports.push({
        scenarioNumber: scenario.number,
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        passedCount: scnPassed,
        brokenCount: scnBroken,
        notBuiltCount: scnNotBuilt,
        steps: stepReports,
      });
    }
  } finally {
    console.log('\n[Scenario Run] Stopping background worker...');
    await worker.stop();
  }

  // Run Static & Unit Check Commands
  console.log('\n[Scenario Run] Running repository validation checks (typecheck, lint, test)...');
  console.log('  Running npm run typecheck...');
  const typecheckRes = runCommand('npm run typecheck');
  console.log(`  npm run typecheck: ${typecheckRes.passed ? 'PASSED' : 'FAILED'}`);

  console.log('  Running npm run lint...');
  const lintRes = runCommand('npm run lint');
  console.log(`  npm run lint: ${lintRes.passed ? 'PASSED' : 'FAILED'}`);

  console.log('  Running npm run test...');
  const testRes = runCommand('npm run test');
  console.log(`  npm run test: ${testRes.passed ? 'PASSED' : 'FAILED'}`);

  const healthReport: ScenarioHealthReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      totalScenarios: scenarioReports.length,
      totalSteps: totalStepsCount,
      passedSteps: totalPassedCount,
      brokenSteps: totalBrokenCount,
      notBuiltSteps: totalNotBuiltCount,
    },
    commands: {
      typecheck: typecheckRes,
      lint: lintRes,
      test: testRes,
    },
    scenarios: scenarioReports,
  };

  // Write JSON report
  const jsonReportPath = path.resolve(process.cwd(), 'docs/scenario-report.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(healthReport, null, 2), 'utf-8');
  console.log(`\n[Scenario Run] Generated ${jsonReportPath}`);

  // Write Markdown report
  const mdReport = generateMarkdownScenarioReport(healthReport, inventory);
  const mdReportPath = path.resolve(process.cwd(), 'docs/scenario-report.md');
  fs.writeFileSync(mdReportPath, mdReport, 'utf-8');
  console.log(`[Scenario Run] Generated ${mdReportPath}`);

  console.log('\n=============================================================');
  console.log('  SCENARIO RUN SUMMARY');
  console.log('=============================================================');
  console.log(`Total Scenarios: ${scenarioReports.length}`);
  console.log(`Total Steps:     ${totalStepsCount}`);
  console.log(`Passed:          ${totalPassedCount}`);
  console.log(`Broken:          ${totalBrokenCount}`);
  console.log(`Not Built:       ${totalNotBuiltCount}`);
  console.log('=============================================================\n');

  if (totalBrokenCount > 0) {
    console.error(
      `ERROR: ${totalBrokenCount} step(s) failed for built features. Exiting non-zero.`
    );
    process.exit(1);
  }
}

function generateMarkdownScenarioReport(
  rep: ScenarioHealthReport,
  inventory: ReturnType<typeof getFeatureInventory>
): string {
  let md = `# Synthetic Scenario Pack & Feature Health Report\n\n`;
  md += `**Generated At**: \`${rep.generatedAt}\`  \n`;
  md += `**Environment**: Local Supabase (\`127.0.0.1\`), Fake AI Provider  \n\n`;

  md += `## 1. Executive Summary\n\n`;
  md += `| Metric | Count |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Total Scenarios** | ${rep.summary.totalScenarios} |\n`;
  md += `| **Total Steps** | ${rep.summary.totalSteps} |\n`;
  md += `| **Passed Steps** | **${rep.summary.passedSteps}** |\n`;
  md += `| **Broken Steps** | **${rep.summary.brokenSteps}** |\n`;
  md += `| **Not Built Steps** | **${rep.summary.notBuiltSteps}** |\n\n`;

  md += `## 2. Scenario Results Breakdown\n\n`;
  md += `| # | Scenario | Passed | Broken | Not Built | Total |\n`;
  md += `| :-: | :--- | :-: | :-: | :-: | :-: |\n`;

  for (const s of rep.scenarios) {
    const total = s.steps.length;
    md += `| ${s.scenarioNumber} | **${s.scenarioName}** | ${s.passedCount} | ${s.brokenCount} | ${s.notBuiltCount} | ${total} |\n`;
  }
  md += `\n`;

  md += `## 3. Broken Steps\n\n`;
  const brokenSteps: Array<ScenarioRunStepReport & { scenarioName: string }> = [];
  for (const s of rep.scenarios) {
    for (const st of s.steps) {
      if (st.status === 'broken') {
        brokenSteps.push({ ...st, scenarioName: s.scenarioName });
      }
    }
  }

  if (brokenSteps.length === 0) {
    md += `*None. All steps exercising built features passed successfully without defects.*\n\n`;
  } else {
    for (const b of brokenSteps) {
      md += `### \`${b.id}\`: ${b.name}\n`;
      md += `- **Feature**: \`${b.feature}\`\n`;
      md += `- **Scenario**: ${b.scenarioName}\n`;
      md += `- **Action**: ${b.action}\n`;
      if (b.request) {
        md += `- **Request**: \`${b.request.method} ${b.request.path}\`\n`;
      }
      if (b.responseStatus) {
        md += `- **Response Status**: \`${b.responseStatus}\`\n`;
      }
      md += `- **Expected**: ${b.expected || b.expectedResult}\n`;
      md += `- **Actual**: \`${typeof b.actual === 'object' ? JSON.stringify(b.actual) : String(b.actual)}\`\n`;
      if (b.likelySourceFile) {
        md += `- **Likely Source File**: [\`${b.likelySourceFile}\`](file:///${path.resolve(process.cwd(), b.likelySourceFile)})\n`;
      }
      if (b.errorDetails) {
        md += `- **Error Details**:\n\`\`\`\n${b.errorDetails}\n\`\`\`\n`;
      }
      md += `\n`;
    }
  }

  md += `## 4. Not Built Yet Features\n\n`;
  const notBuiltApi = inventory.apiRoutes.filter((r) => r.status === 'not built');
  const notBuiltWeb = inventory.webRoutes.filter((r) => r.status === 'not built');

  if (notBuiltApi.length === 0 && notBuiltWeb.length === 0) {
    md += `*None. All routes in the specification are fully implemented.*\n\n`;
  } else {
    if (notBuiltApi.length > 0) {
      md += `### API Routes Not Built:\n`;
      for (const r of notBuiltApi) {
        md += `- \`${r.method} ${r.path}\`: ${r.purpose} (SPEC Section ${r.specSection})\n`;
      }
      md += `\n`;
    }
    if (notBuiltWeb.length > 0) {
      md += `### Web Routes Not Built:\n`;
      for (const r of notBuiltWeb) {
        md += `- \`${r.path}\`: ${r.purpose} (SPEC Section ${r.specSection})\n`;
      }
      md += `\n`;
    }
  }

  md += `### Skipped Scenario Steps (Targeting Unbuilt Features):\n`;
  const notBuiltSteps: ScenarioRunStepReport[] = [];
  for (const s of rep.scenarios) {
    for (const st of s.steps) {
      if (st.status === 'not built') {
        notBuiltSteps.push(st);
      }
    }
  }

  if (notBuiltSteps.length === 0) {
    md += `*None.*\n\n`;
  } else {
    for (const nb of notBuiltSteps) {
      md += `- **\`${nb.id}\`**: ${nb.name} (Feature: \`${nb.feature}\`) — *${nb.actual}*\n`;
    }
    md += `\n`;
  }

  md += `## 5. Command Health Checks\n\n`;
  md += `### \`npm run typecheck\`\n`;
  md += `**Result**: ${rep.commands.typecheck.passed ? 'PASSED (0 errors)' : 'FAILED'}\n`;
  md += `\`\`\`\n${rep.commands.typecheck.output.slice(-1000)}\n\`\`\`\n\n`;

  md += `### \`npm run lint\`\n`;
  md += `**Result**: ${rep.commands.lint.passed ? 'PASSED (0 errors)' : 'FAILED'}\n`;
  md += `\`\`\`\n${rep.commands.lint.output.slice(-1000)}\n\`\`\`\n\n`;

  md += `### \`npm run test\`\n`;
  md += `**Result**: ${rep.commands.test.passed ? 'PASSED' : 'FAILED'}\n`;
  md += `\`\`\`\n${rep.commands.test.output.slice(-1000)}\n\`\`\`\n`;

  return md;
}

async function main(): Promise<void> {
  assertLocalEnvironment();

  const config = getTestSupabaseConfig();
  const pool = createDbPool(config.databaseUrl);
  const env = serverEnvironmentSchema.parse({
    ...process.env,
    NODE_ENV: 'test',
    AI_PROVIDER: 'fake',
    WORKER_POLL_INTERVAL_MS: 150,
    RATE_LIMIT_MAX_REQUESTS: 2000,
  });

  const app = createApp({ env, pool });

  const args = process.argv.slice(2);
  const isResetOnly = args.includes('--reset-only');
  const isSeedOnly = args.includes('--seed-only');
  const isRun = args.includes('--run');

  try {
    if (isResetOnly) {
      await handleResetOnly(pool);
    } else if (isSeedOnly) {
      await handleSeedOnly(pool, app, env);
    } else if (isRun) {
      await handleRun(pool, app, env);
    } else {
      console.log('Usage:');
      console.log('  npx tsx scripts/run-scenarios.ts --reset-only');
      console.log('  npx tsx scripts/run-scenarios.ts --seed-only');
      console.log('  npx tsx scripts/run-scenarios.ts --run');
      process.exit(1);
    }
  } finally {
    await closeDbPool(pool);
  }
}

main().catch((err) => {
  console.error('Fatal error running scenarios:', err);
  process.exit(1);
});
