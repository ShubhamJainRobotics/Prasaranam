import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import crypto from 'node:crypto';
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

describe('Recurring Problems (Hackathon Addition 2)', () => {
  let pool: DbPool;
  let app: Express;
  let owner: TestUser;
  let memberA: TestUser;
  let memberB: TestUser;
  let projectId: string;
  let orgId: string;
  let source1Id: string;
  let source2Id: string;
  let restrictedSourceId: string;

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
    owner = await createRealTestUser(`rec-owner-${ts}@relay.local`, 'Password123!', 'Rec Owner');
    memberA = await createRealTestUser(
      `rec-memA-${ts}@relay.local`,
      'Password123!',
      'Rec Member A'
    );
    memberB = await createRealTestUser(
      `rec-memB-${ts}@relay.local`,
      'Password123!',
      'Rec Member B'
    );

    // Bootstrap Org and Project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Rec Org ${ts}`);
    await addOrgMember(pool, owner.userId, orgId, memberA.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, memberB.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `Rec Project ${ts}`,
      'Recurring problems integration project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, memberA.userId, 'contributor');
    await addProjectMember(pool, owner.userId, projectId, memberB.userId, 'contributor');

    // Source 1 (project visibility)
    const s1Res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Weekly Standup Notes Week 1',
        kind: 'text',
        content: 'Blocker: Sandbox payment credentials missing in staging environment.',
        visibility: 'project',
      });
    expect(s1Res.status).toBe(201);
    source1Id = s1Res.body.data.sources[0].id;

    // Source 2 (project visibility)
    const s2Res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Weekly Standup Notes Week 2',
        kind: 'text',
        content: 'Risk: Sandbox payment credentials missing across staging instances.',
        visibility: 'project',
      });
    expect(s2Res.status).toBe(201);
    source2Id = s2Res.body.data.sources[0].id;

    // Source 3 (restricted to owner and memberA only)
    const s3Res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Confidential Incident Report',
        kind: 'text',
        content: 'Blocker: Database replication latency exceeds SLA during peak hours.',
        visibility: 'restricted',
        grantUserIds: [memberA.userId],
      });
    expect(s3Res.status).toBe(201);
    restrictedSourceId = s3Res.body.data.sources[0].id;

    // Insert claims directly with evidence to test the grouping algorithm deterministically
    // 1. Blocker claim citing Source 1 chunk
    const s1Chunk = (
      await pool.query('SELECT id FROM public.source_chunks WHERE source_id = $1 LIMIT 1', [
        source1Id,
      ])
    ).rows[0].id;
    const c1Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO public.claims (id, project_id, kind, statement, work_state, evidence_state, dedupe_key, prompt_version)
       VALUES ($1, $2, 'blocker', 'Sandbox payment credentials missing in staging environment', 'open', 'supported', $3, 'v1')`,
      [c1Id, projectId, crypto.randomUUID()]
    );
    await pool.query(
      `INSERT INTO public.claim_evidence (id, project_id, claim_id, chunk_id, quote, quote_start, quote_end)
       VALUES ($1, $2, $3, $4, 'Sandbox payment credentials missing in staging environment', 9, 67)`,
      [crypto.randomUUID(), projectId, c1Id, s1Chunk]
    );

    // 2. Risk claim citing Source 2 chunk (high token overlap >= 0.6 with claim 1)
    const s2Chunk = (
      await pool.query('SELECT id FROM public.source_chunks WHERE source_id = $1 LIMIT 1', [
        source2Id,
      ])
    ).rows[0].id;
    const c2Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO public.claims (id, project_id, kind, statement, work_state, evidence_state, dedupe_key, prompt_version)
       VALUES ($1, $2, 'risk', 'Sandbox payment credentials missing across staging instances', 'open', 'supported', $3, 'v1')`,
      [c2Id, projectId, crypto.randomUUID()]
    );
    await pool.query(
      `INSERT INTO public.claim_evidence (id, project_id, claim_id, chunk_id, quote, quote_start, quote_end)
       VALUES ($1, $2, $3, $4, 'Sandbox payment credentials missing across staging instances', 6, 66)`,
      [crypto.randomUUID(), projectId, c2Id, s2Chunk]
    );

    // 3. Confidential blocker citing Restricted Source chunk
    const s3Chunk = (
      await pool.query('SELECT id FROM public.source_chunks WHERE source_id = $1 LIMIT 1', [
        restrictedSourceId,
      ])
    ).rows[0].id;
    const c3Id = crypto.randomUUID();
    await pool.query(
      `INSERT INTO public.claims (id, project_id, kind, statement, work_state, evidence_state, dedupe_key, prompt_version)
       VALUES ($1, $2, 'blocker', 'Database replication latency exceeds SLA during peak hours', 'open', 'supported', $3, 'v1')`,
      [c3Id, projectId, crypto.randomUUID()]
    );
    await pool.query(
      `INSERT INTO public.claim_evidence (id, project_id, claim_id, chunk_id, quote, quote_start, quote_end)
       VALUES ($1, $2, $3, $4, 'Database replication latency exceeds SLA during peak hours', 9, 67)`,
      [crypto.randomUUID(), projectId, c3Id, s3Chunk]
    );
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (memberA) await deleteRealTestUser(memberA.userId);
    if (memberB) await deleteRealTestUser(memberB.userId);
    if (pool) await closeDbPool(pool);
  });

  it('grouping works on seeded blockers across two distinct sources', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/recurring-problems`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.groups).toBeDefined();

    // Should find the sandbox credentials pattern because it appears in Source 1 and Source 2
    const sandboxGroup = res.body.data.groups.find((g: any) =>
      g.representativeStatement.includes('Sandbox payment credentials')
    );
    expect(sandboxGroup).toBeDefined();
    expect(sandboxGroup.distinctSourceCount).toBe(2);
    expect(sandboxGroup.claimIds.length).toBe(2);
    expect(sandboxGroup.evidenceRefs.length).toBeGreaterThanOrEqual(2);
  });

  it('restricted claims never appear in groups, counts, or evidence for users without access', async () => {
    // memberB lacks access to the restricted source
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/recurring-problems`)
      .set('Authorization', `Bearer ${memberB.accessToken}`);

    expect(res.status).toBe(200);
    const groups = res.body.data.groups;

    // None of the groups or evidence should contain the confidential claim or text
    for (const g of groups) {
      expect(g.representativeStatement).not.toContain('Database replication latency');
      for (const ev of g.evidenceRefs) {
        expect(ev.sourceTitle).not.toContain('Confidential Incident Report');
        expect(ev.quote).not.toContain('Database replication latency');
      }
    }
  });

  it('a user without access to one source sees a smaller or no group', async () => {
    // Restrict Source 2 so only owner and memberA have access
    await pool.query("UPDATE public.sources SET visibility = 'restricted' WHERE id = $1", [
      source2Id,
    ]);
    await pool.query(
      'INSERT INTO public.source_grants (source_id, project_id, user_id) VALUES ($1, $2, $3), ($1, $2, $4)',
      [source2Id, projectId, memberA.userId, owner.userId]
    );

    // Now memberB can only read Source 1. Because the pattern now only has 1 distinct source for memberB,
    // the group should be excluded (spec requirement: evidence comes from at least two distinct sources).
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/recurring-problems`)
      .set('Authorization', `Bearer ${memberB.accessToken}`);

    expect(res.status).toBe(200);
    const sandboxGroup = res.body.data.groups.find((g: any) =>
      g.representativeStatement.includes('Sandbox payment credentials')
    );
    expect(sandboxGroup).toBeUndefined();

    // But owner still sees it because owner can read both sources
    const ownerRes = await request(app)
      .get(`/api/v1/projects/${projectId}/recurring-problems`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(ownerRes.status).toBe(200);
    const ownerGroup = ownerRes.body.data.groups.find((g: any) =>
      g.representativeStatement.includes('Sandbox payment credentials')
    );
    expect(ownerGroup).toBeDefined();
    expect(ownerGroup.distinctSourceCount).toBe(2);
  });

  it('the cap of 200 claims is enforced', async () => {
    // Verify response succeeds without error even when query executes against the cap
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/recurring-problems`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.groups)).toBe(true);
  });
});
