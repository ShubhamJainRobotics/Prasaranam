import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Security: Restricted and Archived Sources (11.2, 11.3, 22.3 items 3, 4, 21)', () => {
  let pool: DbPool;
  let orgOwner: TestUser;
  let grantedMember: TestUser;
  let ungrantedMember: TestUser;
  let orgId: string;
  let projectId: string;
  let sourceId: string;
  let chunkId: string;
  let claimId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    orgOwner = await createRealTestUser(
      `test-rst-owner-${Date.now()}@relay.local`,
      'Password123!',
      'Restricted Org Owner'
    );
    grantedMember = await createRealTestUser(
      `test-rst-granted-${Date.now()}@relay.local`,
      'Password123!',
      'Restricted Granted'
    );
    ungrantedMember = await createRealTestUser(
      `test-rst-ungranted-${Date.now()}@relay.local`,
      'Password123!',
      'Restricted Ungranted'
    );

    orgId = await bootstrapOrganisation(pool, orgOwner.userId, 'Restricted Test Org');
    projectId = await createProject(
      pool,
      orgOwner.userId,
      orgId,
      'Restricted Test Project',
      '',
      'software_engineering',
      'UTC'
    );

    // Add grantedMember and ungrantedMember to org and project
    await addOrgMember(pool, orgOwner.userId, orgId, grantedMember.userId, 'member');
    await addProjectMember(pool, orgOwner.userId, projectId, grantedMember.userId, 'contributor');

    await addOrgMember(pool, orgOwner.userId, orgId, ungrantedMember.userId, 'member');
    await addProjectMember(pool, orgOwner.userId, projectId, ungrantedMember.userId, 'contributor');

    // Create a RESTRICTED source (e.g. secret personnel note)
    const content = 'Confidential personnel note: performance and salary review';
    const srcRes = await pool.query(
      `INSERT INTO public.sources (
        project_id, title, kind, visibility, content, content_sha256, created_by
      ) VALUES ($1, $2, 'text', 'restricted', $3, 'dummy-sha', $4)
      RETURNING id;`,
      [projectId, 'Restricted Personnel Note', content, grantedMember.userId]
    );
    sourceId = srcRes.rows[0].id;

    // Create a chunk for the source
    const chunkRes = await pool.query(
      `INSERT INTO public.source_chunks (
        source_id, project_id, ordinal, start_offset, end_offset, content
      ) VALUES ($1, $2, 0, 0, $3, $4)
      RETURNING id;`,
      [sourceId, projectId, content.length, content]
    );
    chunkId = chunkRes.rows[0].id;

    // Create a derived claim
    const claimRes = await pool.query(
      `INSERT INTO public.claims (
        project_id, kind, statement, evidence_state, dedupe_key, prompt_version
      ) VALUES ($1, 'decision', 'Confidential note exists', 'supported', 'dedupe-rst-1', 'v1')
      RETURNING id;`,
      [projectId]
    );
    claimId = claimRes.rows[0].id;

    // Link chunk to claim as evidence
    await pool.query(
      `INSERT INTO public.claim_evidence (
        project_id, claim_id, chunk_id, quote, quote_start, quote_end
      ) VALUES ($1, $2, $3, $4, 0, $5);`,
      [projectId, claimId, chunkId, content, content.length]
    );
  });

  afterAll(async () => {
    if (orgOwner) await deleteRealTestUser(orgOwner.userId);
    if (grantedMember) await deleteRealTestUser(grantedMember.userId);
    if (ungrantedMember) await deleteRealTestUser(ungrantedMember.userId);
    await closeDbPool(pool);
  });

  it('restricted source is invisible to ungranted member and even to org owner', async () => {
    // Org owner has no explicit grant -> cannot see restricted source
    const { data: ownerSource } = await orgOwner.client
      .from('sources')
      .select('id, title, visibility, processing_status')
      .eq('id', sourceId);
    expect(ownerSource).toEqual([]);

    // Ungranted member cannot see restricted source
    const { data: ungrantedSource } = await ungrantedMember.client
      .from('sources')
      .select('id, title, visibility, processing_status')
      .eq('id', sourceId);
    expect(ungrantedSource).toEqual([]);

    // Chunks of restricted source are invisible
    const { data: ownerChunks } = await orgOwner.client
      .from('source_chunks')
      .select('id, content')
      .eq('id', chunkId);
    expect(ownerChunks).toEqual([]);

    // Derived claims backed by restricted source are invisible
    const { data: ownerClaims } = await orgOwner.client
      .from('claims')
      .select('id, statement')
      .eq('id', claimId);
    expect(ownerClaims).toEqual([]);
  });

  it('explicit source grant makes source, chunks, and claims visible to granted user', async () => {
    // Insert an explicit source_grant for grantedMember
    await pool.query(
      `INSERT INTO public.source_grants (source_id, project_id, user_id)
       VALUES ($1, $2, $3);`,
      [sourceId, projectId, grantedMember.userId]
    );

    // Granted member can now see the source
    const { data: srcData } = await grantedMember.client
      .from('sources')
      .select('id, title, visibility')
      .eq('id', sourceId);
    expect(srcData?.length).toBe(1);
    expect(srcData?.[0]?.title).toBe('Restricted Personnel Note');

    // Granted member can now see the chunk
    const { data: chunkData } = await grantedMember.client
      .from('source_chunks')
      .select('id, content')
      .eq('id', chunkId);
    expect(chunkData?.length).toBe(1);

    // Granted member can now see the derived claim
    const { data: claimData } = await grantedMember.client
      .from('claims')
      .select('id, statement')
      .eq('id', claimId);
    expect(claimData?.length).toBe(1);

    // Ungranted member STILL cannot see anything
    const { data: ungrantedData } = await ungrantedMember.client
      .from('sources')
      .select('id')
      .eq('id', sourceId);
    expect(ungrantedData).toEqual([]);
  });

  it('archiving a source makes it, its chunks, and its derived claims unreadable to everyone', async () => {
    // Archive the source
    await pool.query(
      `UPDATE public.sources
       SET archived_at = now(), archived_by = $1
       WHERE id = $2;`,
      [orgOwner.userId, sourceId]
    );

    // Granted member can no longer see the source
    const { data: srcData } = await grantedMember.client
      .from('sources')
      .select('id')
      .eq('id', sourceId);
    expect(srcData).toEqual([]);

    // Granted member can no longer see the chunk
    const { data: chunkData } = await grantedMember.client
      .from('source_chunks')
      .select('id')
      .eq('id', chunkId);
    expect(chunkData).toEqual([]);

    // Derived claims also become invisible under the all-evidence rule
    const { data: claimData } = await grantedMember.client
      .from('claims')
      .select('id')
      .eq('id', claimId);
    expect(claimData).toEqual([]);
  });
});
