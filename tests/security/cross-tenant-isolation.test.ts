import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  enqueueJob,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Security: Cross-Tenant Data Isolation (22.3 items 1 & 2)', () => {
  let pool: DbPool;
  let userA: TestUser;
  let userB: TestUser;
  let orgAId: string;
  let orgBId: string;
  let projBId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    userA = await createRealTestUser(
      `test-tenant-a-${Date.now()}@relay.local`,
      'Password123!',
      'Tenant User A'
    );
    userB = await createRealTestUser(
      `test-tenant-b-${Date.now()}@relay.local`,
      'Password123!',
      'Tenant User B'
    );

    // Bootstrap Org A & Project A for User A
    orgAId = await bootstrapOrganisation(pool, userA.userId, 'Tenant Org A');
    await createProject(
      pool,
      userA.userId,
      orgAId,
      'Project Alpha',
      'Confidential A',
      'software_engineering',
      'UTC'
    );

    // Bootstrap Org B & Project B for User B
    orgBId = await bootstrapOrganisation(pool, userB.userId, 'Tenant Org B');
    projBId = await createProject(
      pool,
      userB.userId,
      orgBId,
      'Project Beta',
      'Confidential B',
      'software_engineering',
      'UTC'
    );

    // Seed some data in Project B directly via service_role pool for testing read isolation
    const contentB = 'Super secret Project B content';
    // 1. Source in Project B
    const srcRes = await pool.query(
      `INSERT INTO public.sources (
        project_id, title, kind, visibility, content, content_sha256, created_by
      ) VALUES ($1, $2, 'text', 'project', $3, 'dummy-hash', $4)
      RETURNING id;`,
      [projBId, 'Secret B Source', contentB, userB.userId]
    );
    const srcBId = srcRes.rows[0].id;

    // 2. Source chunk in Project B
    const chunkRes = await pool.query(
      `INSERT INTO public.source_chunks (
        source_id, project_id, ordinal, start_offset, end_offset, content
      ) VALUES ($1, $2, 0, 0, $3, $4)
      RETURNING id;`,
      [srcBId, projBId, contentB.length, contentB]
    );
    const chunkBId = chunkRes.rows[0].id;

    // 3. Claim in Project B
    const claimRes = await pool.query(
      `INSERT INTO public.claims (
        project_id, kind, statement, evidence_state, dedupe_key, prompt_version
      ) VALUES ($1, 'decision', 'Use Rust for security in Project B', 'supported', 'dedupe-b-1', 'v1')
      RETURNING id;`,
      [projBId]
    );
    const claimBId = claimRes.rows[0].id;

    // 4. Claim evidence linking chunk to claim
    await pool.query(
      `INSERT INTO public.claim_evidence (
        project_id, claim_id, chunk_id, quote, quote_start, quote_end
      ) VALUES ($1, $2, $3, $4, 0, $5);`,
      [projBId, claimBId, chunkBId, contentB, contentB.length]
    );

    // 5. Job in Project B
    await enqueueJob(pool, userB.userId, projBId, 'extract', `job-b-${Date.now()}`, {
      secret: true,
    });
  });

  afterAll(async () => {
    if (userA) await deleteRealTestUser(userA.userId);
    if (userB) await deleteRealTestUser(userB.userId);
    await closeDbPool(pool);
  });

  it('User A cannot read Organisation B', async () => {
    const { data } = await userA.client.from('organisations').select('id, name').eq('id', orgBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read Project B', async () => {
    const { data } = await userA.client.from('projects').select('id, name').eq('id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read project members of Project B', async () => {
    const { data } = await userA.client
      .from('project_members')
      .select('*')
      .eq('project_id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read sources belonging to Project B', async () => {
    const { data } = await userA.client.from('sources').select('*').eq('project_id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read source chunks belonging to Project B', async () => {
    const { data } = await userA.client.from('source_chunks').select('*').eq('project_id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read claims belonging to Project B', async () => {
    const { data } = await userA.client.from('claims').select('*').eq('project_id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read jobs belonging to Project B', async () => {
    const { data } = await userA.client.from('jobs').select('*').eq('project_id', projBId);
    expect(data).toEqual([]);
  });

  it('User A cannot read audit events of Org B or Project B', async () => {
    const { data } = await userA.client
      .from('audit_events')
      .select('*')
      .eq('organisation_id', orgBId);
    expect(data).toEqual([]);
  });
});
