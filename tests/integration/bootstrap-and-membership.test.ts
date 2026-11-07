import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  updateOrgMember,
  addProjectMember,
  updateProjectMember,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Bootstrap and Membership Mutation Functions', () => {
  let pool: DbPool;
  let ownerUser: TestUser;
  let memberUser: TestUser;
  let outsiderUser: TestUser;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    ownerUser = await createRealTestUser(
      `test-bm-owner-${Date.now()}@relay.local`,
      'Password123!',
      'Bootstrap Owner'
    );
    memberUser = await createRealTestUser(
      `test-bm-member-${Date.now()}@relay.local`,
      'Password123!',
      'Bootstrap Member'
    );
    outsiderUser = await createRealTestUser(
      `test-bm-outsider-${Date.now()}@relay.local`,
      'Password123!',
      'Bootstrap Outsider'
    );
  });

  afterAll(async () => {
    if (ownerUser) await deleteRealTestUser(ownerUser.userId);
    if (memberUser) await deleteRealTestUser(memberUser.userId);
    if (outsiderUser) await deleteRealTestUser(outsiderUser.userId);
    await closeDbPool(pool);
  });

  it('bootstrap_organisation creates organisation, owner membership, and audit event', async () => {
    const orgId = await bootstrapOrganisation(pool, ownerUser.userId, 'Acme Handover Corp');
    expect(orgId).toBeDefined();

    // Verify organisation row
    const orgRes = await pool.query(
      'SELECT id, name, created_by FROM public.organisations WHERE id = $1',
      [orgId]
    );
    expect(orgRes.rows.length).toBe(1);
    expect(orgRes.rows[0].name).toBe('Acme Handover Corp');
    expect(orgRes.rows[0].created_by).toBe(ownerUser.userId);

    // Verify organisation_members row
    const memRes = await pool.query(
      'SELECT role, active FROM public.organisation_members WHERE organisation_id = $1 AND user_id = $2',
      [orgId, ownerUser.userId]
    );
    expect(memRes.rows.length).toBe(1);
    expect(memRes.rows[0].role).toBe('owner');
    expect(memRes.rows[0].active).toBe(true);

    // Verify audit event
    const auditRes = await pool.query(
      'SELECT action, entity_type, entity_id FROM public.audit_events WHERE organisation_id = $1',
      [orgId]
    );
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].action).toBe('bootstrap_organisation');
  });

  it('create_project creates project, owner membership, and audit event', async () => {
    const orgId = await bootstrapOrganisation(pool, ownerUser.userId, 'Project Test Org');

    const projId = await createProject(
      pool,
      ownerUser.userId,
      orgId,
      'Core Payments',
      'Payment service handover',
      'software_engineering',
      'UTC'
    );
    expect(projId).toBeDefined();

    // Verify project row
    const pRes = await pool.query(
      'SELECT id, name, domain, access_epoch FROM public.projects WHERE id = $1',
      [projId]
    );
    expect(pRes.rows.length).toBe(1);
    expect(pRes.rows[0].name).toBe('Core Payments');
    expect(pRes.rows[0].domain).toBe('software_engineering');
    expect(Number(pRes.rows[0].access_epoch)).toBe(1);

    // Verify project_members row
    const pmRes = await pool.query(
      'SELECT role, active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
      [projId, ownerUser.userId]
    );
    expect(pmRes.rows.length).toBe(1);
    expect(pmRes.rows[0].role).toBe('owner');
    expect(pmRes.rows[0].active).toBe(true);

    // Non-org admin cannot create a project
    await expect(
      createProject(pool, outsiderUser.userId, orgId, 'Unauthorized Project', '', 'general', 'UTC')
    ).rejects.toThrow(/FORBIDDEN/);
  });

  it('add_org_member and update_org_member work and enforce permissions', async () => {
    const orgId = await bootstrapOrganisation(pool, ownerUser.userId, 'Membership Org');

    // Non-admin cannot add member
    await expect(
      addOrgMember(pool, outsiderUser.userId, orgId, memberUser.userId, 'member')
    ).rejects.toThrow(/FORBIDDEN/);

    // Owner adds member
    await addOrgMember(pool, ownerUser.userId, orgId, memberUser.userId, 'member');
    let mRes = await pool.query(
      'SELECT role, active FROM public.organisation_members WHERE organisation_id = $1 AND user_id = $2',
      [orgId, memberUser.userId]
    );
    expect(mRes.rows[0].role).toBe('member');
    expect(mRes.rows[0].active).toBe(true);

    // Update member role
    await updateOrgMember(pool, ownerUser.userId, orgId, memberUser.userId, 'admin', true);
    mRes = await pool.query(
      'SELECT role, active FROM public.organisation_members WHERE organisation_id = $1 AND user_id = $2',
      [orgId, memberUser.userId]
    );
    expect(mRes.rows[0].role).toBe('admin');
  });

  it('add_project_member requires active org membership and enforces project owner check', async () => {
    const orgId = await bootstrapOrganisation(pool, ownerUser.userId, 'Project Mem Org');
    const projId = await createProject(
      pool,
      ownerUser.userId,
      orgId,
      'Test Project',
      '',
      'general',
      'UTC'
    );

    // Outsider is NOT an org member -> adding to project must fail
    await expect(
      addProjectMember(pool, ownerUser.userId, projId, outsiderUser.userId, 'reviewer')
    ).rejects.toThrow(/VALIDATION_ERROR/);

    // Add member to org first, then adding to project succeeds
    await addOrgMember(pool, ownerUser.userId, orgId, memberUser.userId, 'member');
    await addProjectMember(pool, ownerUser.userId, projId, memberUser.userId, 'reviewer');

    const pmRes = await pool.query(
      'SELECT role, active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
      [projId, memberUser.userId]
    );
    expect(pmRes.rows[0].role).toBe('reviewer');
    expect(pmRes.rows[0].active).toBe(true);

    // Update project member
    await updateProjectMember(
      pool,
      ownerUser.userId,
      projId,
      memberUser.userId,
      'contributor',
      true
    );
    const pmRes2 = await pool.query(
      'SELECT role FROM public.project_members WHERE project_id = $1 AND user_id = $2',
      [projId, memberUser.userId]
    );
    expect(pmRes2.rows[0].role).toBe('contributor');
  });

  it('deactivating an org member cascades deactivation to project memberships', async () => {
    const orgId = await bootstrapOrganisation(pool, ownerUser.userId, 'Cascade Deactivation Org');
    const projId = await createProject(
      pool,
      ownerUser.userId,
      orgId,
      'Cascade Project',
      '',
      'general',
      'UTC'
    );

    await addOrgMember(pool, ownerUser.userId, orgId, memberUser.userId, 'member');
    await addProjectMember(pool, ownerUser.userId, projId, memberUser.userId, 'reviewer');

    // Confirm member is active in project
    let pm = await pool.query(
      'SELECT active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
      [projId, memberUser.userId]
    );
    expect(pm.rows[0].active).toBe(true);

    // Deactivate org member
    await updateOrgMember(pool, ownerUser.userId, orgId, memberUser.userId, 'member', false);

    // Verify project membership was automatically deactivated
    pm = await pool.query(
      'SELECT active FROM public.project_members WHERE project_id = $1 AND user_id = $2',
      [projId, memberUser.userId]
    );
    expect(pm.rows[0].active).toBe(false);
  });
});
