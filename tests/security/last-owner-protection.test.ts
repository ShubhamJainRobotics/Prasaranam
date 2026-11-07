import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  updateOrgMember,
  updateProjectMember,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Security: Last-Owner Protection (10.10, 2A.2 & 22.3 item 20)', () => {
  let pool: DbPool;
  let owner1: TestUser;
  let owner2: TestUser;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    owner1 = await createRealTestUser(
      `test-lo-owner1-${Date.now()}@relay.local`,
      'Password123!',
      'Last Owner 1'
    );
    owner2 = await createRealTestUser(
      `test-lo-owner2-${Date.now()}@relay.local`,
      'Password123!',
      'Last Owner 2'
    );

    orgId = await bootstrapOrganisation(pool, owner1.userId, 'Last Owner Org');
    projectId = await createProject(
      pool,
      owner1.userId,
      orgId,
      'Last Owner Project',
      '',
      'general',
      'UTC'
    );
  });

  afterAll(async () => {
    if (owner1) await deleteRealTestUser(owner1.userId);
    if (owner2) await deleteRealTestUser(owner2.userId);
    await closeDbPool(pool);
  });

  it('cannot demote or deactivate the last active owner of an organisation', async () => {
    // Attempt to demote sole owner to admin
    await expect(
      updateOrgMember(pool, owner1.userId, orgId, owner1.userId, 'admin', true)
    ).rejects.toThrow(/LAST_OWNER/);

    // Attempt to deactivate sole owner
    await expect(
      updateOrgMember(pool, owner1.userId, orgId, owner1.userId, 'owner', false)
    ).rejects.toThrow(/LAST_OWNER/);

    // Direct SQL DELETE is also blocked by database trigger
    await expect(
      pool.query(
        'DELETE FROM public.organisation_members WHERE organisation_id = $1 AND user_id = $2',
        [orgId, owner1.userId]
      )
    ).rejects.toThrow(/LAST_OWNER/);
  });

  it('cannot demote or deactivate the last active owner of a project', async () => {
    // Attempt to demote sole project owner to reviewer
    await expect(
      updateProjectMember(pool, owner1.userId, projectId, owner1.userId, 'reviewer', true)
    ).rejects.toThrow(/LAST_OWNER/);

    // Attempt to deactivate sole project owner
    await expect(
      updateProjectMember(pool, owner1.userId, projectId, owner1.userId, 'owner', false)
    ).rejects.toThrow(/LAST_OWNER/);

    // Direct SQL DELETE is also blocked by database trigger
    await expect(
      pool.query('DELETE FROM public.project_members WHERE project_id = $1 AND user_id = $2', [
        projectId,
        owner1.userId,
      ])
    ).rejects.toThrow(/LAST_OWNER/);
  });

  it('allows demoting an owner if another active owner exists', async () => {
    // Add second owner to org
    await addOrgMember(pool, owner1.userId, orgId, owner2.userId, 'owner');

    // Now owner1 can be demoted to admin because owner2 remains
    await expect(
      updateOrgMember(pool, owner2.userId, orgId, owner1.userId, 'admin', true)
    ).resolves.not.toThrow();

    // Now owner2 is the sole owner; trying to demote owner2 must fail
    await expect(
      updateOrgMember(pool, owner2.userId, orgId, owner2.userId, 'admin', true)
    ).rejects.toThrow(/LAST_OWNER/);

    // Restore owner1 as owner
    await updateOrgMember(pool, owner2.userId, orgId, owner1.userId, 'owner', true);
  });

  it('concurrent deactivations cannot both succeed when only two owners exist', async () => {
    // Both owner1 and owner2 are active owners in orgId
    // Attempt concurrent deactivation of both owners
    const results = await Promise.allSettled([
      updateOrgMember(pool, owner1.userId, orgId, owner1.userId, 'member', false),
      updateOrgMember(pool, owner2.userId, orgId, owner2.userId, 'member', false),
    ]);

    // At least one of the attempts MUST have failed with LAST_OWNER
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    // Confirm that at least one active owner remains in the database
    const countRes = await pool.query(
      "SELECT count(*) FROM public.organisation_members WHERE organisation_id = $1 AND role = 'owner' AND active = true",
      [orgId]
    );
    expect(Number(countRes.rows[0].count)).toBeGreaterThanOrEqual(1);
  });
});
