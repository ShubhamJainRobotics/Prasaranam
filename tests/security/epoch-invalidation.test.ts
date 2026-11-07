import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
  updateProjectMember,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Security: Access Epoch Invalidation (2A.9 & 7.4)', () => {
  let pool: DbPool;
  let owner: TestUser;
  let member: TestUser;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    owner = await createRealTestUser(
      `test-epoch-owner-${Date.now()}@relay.local`,
      'Password123!',
      'Epoch Owner'
    );
    member = await createRealTestUser(
      `test-epoch-mem-${Date.now()}@relay.local`,
      'Password123!',
      'Epoch Member'
    );

    orgId = await bootstrapOrganisation(pool, owner.userId, 'Epoch Org');
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Epoch Project',
      '',
      'general',
      'UTC'
    );
    await addOrgMember(pool, owner.userId, orgId, member.userId, 'member');
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (member) await deleteRealTestUser(member.userId);
    await closeDbPool(pool);
  });

  async function getEpoch(): Promise<number> {
    const res = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    return Number(res.rows[0].access_epoch);
  }

  it('fresh project starts at access_epoch = 1', async () => {
    const epoch = await getEpoch();
    expect(epoch).toBe(1);
  });

  it('adding a project member increments access_epoch', async () => {
    const before = await getEpoch();
    await addProjectMember(pool, owner.userId, projectId, member.userId, 'contributor');
    const after = await getEpoch();
    expect(after).toBe(before + 1);
  });

  it('updating a project member increments access_epoch', async () => {
    const before = await getEpoch();
    await updateProjectMember(pool, owner.userId, projectId, member.userId, 'reviewer', true);
    const after = await getEpoch();
    expect(after).toBe(before + 1);
  });

  it('inserting a new source does NOT increment access_epoch', async () => {
    const before = await getEpoch();
    const content = 'Plain source content';
    const srcRes = await pool.query(
      `INSERT INTO public.sources (
        project_id, title, kind, visibility, content, content_sha256, created_by
      ) VALUES ($1, 'Source 1', 'text', 'project', $2, 'dummy-sha', $3)
      RETURNING id;`,
      [projectId, content, owner.userId]
    );
    const after = await getEpoch();
    expect(after).toBe(before); // Crucial per 2A.9: "Imports of new sources do not increment it."

    const sourceId = srcRes.rows[0].id;

    // Grant addition increments epoch
    await pool.query(
      `INSERT INTO public.source_grants (source_id, project_id, user_id)
       VALUES ($1, $2, $3);`,
      [sourceId, projectId, member.userId]
    );
    const afterGrant = await getEpoch();
    expect(afterGrant).toBe(after + 1);

    // Grant deletion increments epoch
    await pool.query(`DELETE FROM public.source_grants WHERE source_id = $1 AND user_id = $2;`, [
      sourceId,
      member.userId,
    ]);
    const afterGrantDel = await getEpoch();
    expect(afterGrantDel).toBe(afterGrant + 1);

    // Visibility change increments epoch
    await pool.query(`UPDATE public.sources SET visibility = 'restricted' WHERE id = $1;`, [
      sourceId,
    ]);
    const afterVis = await getEpoch();
    expect(afterVis).toBe(afterGrantDel + 1);

    // Archiving source increments epoch
    await pool.query(`UPDATE public.sources SET archived_at = now() WHERE id = $1;`, [sourceId]);
    const afterArch = await getEpoch();
    expect(afterArch).toBe(afterVis + 1);
  });
});
