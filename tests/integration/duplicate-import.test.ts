import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../apps/api/src/app.js';
import {
  createDbPool,
  closeDbPool,
  type DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
} from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
  getTestSupabaseConfig,
} from '@relay/test-fixtures';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('Duplicate Import Detection (Hackathon Addition 3)', () => {
  let pool: DbPool;
  let app: Express;
  let owner: TestUser;
  let contributorA: TestUser;
  let contributorB: TestUser;
  let projectId: string;
  let orgId: string;
  const duplicateContent =
    'Standard operating procedure for database backups: Daily full snapshot at midnight UTC.';

  beforeAll(async () => {
    const config = getTestSupabaseConfig();
    pool = createDbPool(config.databaseUrl);

    const env = serverEnvironmentSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      AI_PROVIDER: 'fake',
      AI_TIMEOUT_MS: 5000,
      AI_MAX_INPUT_TOKENS: 10000,
      AI_MAX_OUTPUT_TOKENS: 2000,
      AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
      WORKER_CONCURRENCY: 1,
      WORKER_POLL_INTERVAL_MS: 100,
      SUPABASE_URL: config.url,
      SUPABASE_ANON_KEY: config.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: config.serviceRoleKey,
      DATABASE_URL: config.databaseUrl,
    });

    app = createApp({ env, pool });

    const ts = Date.now();
    owner = await createRealTestUser(`dup-owner-${ts}@relay.local`, 'Password123!', 'Dup Owner');
    contributorA = await createRealTestUser(
      `dup-contribA-${ts}@relay.local`,
      'Password123!',
      'Dup Contributor A'
    );
    contributorB = await createRealTestUser(
      `dup-contribB-${ts}@relay.local`,
      'Password123!',
      'Dup Contributor B'
    );

    // Bootstrap Org and Project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Dup Org ${ts}`);
    await addOrgMember(pool, owner.userId, orgId, contributorA.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, contributorB.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `Dup Project ${ts}`,
      'Duplicate import detection testing project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, contributorA.userId, 'contributor');
    await addProjectMember(pool, owner.userId, projectId, contributorB.userId, 'contributor');
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (contributorA) await deleteRealTestUser(contributorA.userId);
    if (contributorB) await deleteRealTestUser(contributorB.userId);
    if (pool) await closeDbPool(pool);
  });

  it('initial import of content succeeds normally with 201', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${contributorA.accessToken}`)
      .send({
        title: 'Original SOP Backup Document',
        kind: 'text',
        content: duplicateContent,
        visibility: 'project',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sources[0].title).toBe('Original SOP Backup Document');
    expect(res.body.data.sources[0].id).toBeDefined();
  });

  it('importing identical content is rejected with 409 DUPLICATE_SOURCE returning existing id and title', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${contributorA.accessToken}`)
      .send({
        title: 'Duplicate Attempt',
        kind: 'text',
        content: duplicateContent,
        visibility: 'project',
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_SOURCE');
    expect(res.body.error.details).toBeDefined();
    expect(res.body.error.details.length).toBeGreaterThan(0);
    expect(res.body.error.details[0].existingSourceTitle).toBe('Original SOP Backup Document');
    expect(res.body.error.details[0].existingSourceId).toBeDefined();
  });

  it('allowDuplicate: true overrides duplicate rejection and succeeds with 201', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${contributorA.accessToken}`)
      .send({
        title: 'Duplicate Allowed Attempt',
        kind: 'text',
        content: duplicateContent,
        visibility: 'project',
        allowDuplicate: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.sources[0].title).toBe('Duplicate Allowed Attempt');
  });

  it('a duplicate of an unreadable source imports silently with no warning (201)', async () => {
    const secretContent = 'Confidential executive compensation plan for 2027 fiscal year.';

    // Owner imports secret content restricted only to owner
    const secretRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Confidential Executive Plan',
        kind: 'text',
        content: secretContent,
        visibility: 'restricted',
        grantUserIds: [], // only owner
      });
    expect(secretRes.status).toBe(201);

    // Contributor B (who has NO access to the secret source) attempts to import the same content
    const contribRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${contributorB.accessToken}`)
      .send({
        title: 'My Unaware Plan',
        kind: 'text',
        content: secretContent,
        visibility: 'project',
      });

    // Security invariant: duplicate check must never reveal restricted source existence.
    // Import must succeed silently (201) with no DUPLICATE_SOURCE error or hint.
    expect(contribRes.status).toBe(201);
    expect(contribRes.body.data.sources[0].title).toBe('My Unaware Plan');
  });

  it('revision imports (replacesSourceId) are exempt for their own lineage', async () => {
    // 1. Owner imports base version
    const baseContent = 'Architecture revision 1: Microservices deployment on Kubernetes.';
    const baseRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Architecture Blueprint v1',
        kind: 'text',
        content: baseContent,
        visibility: 'project',
      });
    expect(baseRes.status).toBe(201);
    const baseSourceId = baseRes.body.data.sources[0].id;

    // 2. Owner re-imports with replacesSourceId with identical content (e.g. metadata refresh)
    const revisionRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Architecture Blueprint v2',
        kind: 'text',
        content: baseContent,
        visibility: 'project',
        replacesSourceId: baseSourceId,
      });

    expect(revisionRes.status).toBe(201);
    expect(revisionRes.body.data.sources[0].title).toBe('Architecture Blueprint v2');
    expect(revisionRes.body.data.sources[0].revision).toBe(2);
  });
});
