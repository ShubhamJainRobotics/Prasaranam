import crypto from 'node:crypto';
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
  importSource,
  persistClaims,
  createHandoverDraftFromGeneration,
  approveHandover,
  shareHandover,
} from '@relay/database';
import {
  getTestSupabaseConfig,
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
} from '@relay/test-fixtures';
import { serverEnvironmentSchema } from '@relay/contracts';

describe('Handover Security Invariants', () => {
  let pool: DbPool;
  let app: Express;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let orgId: string;
  let publicClaimId: string;
  let restrictedClaimId: string;

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
    owner = await createRealTestUser(`sec-owner-${ts}@relay.local`, 'Password123!', 'Sec Owner');
    reviewer = await createRealTestUser(
      `sec-reviewer-${ts}@relay.local`,
      'Password123!',
      'Sec Reviewer'
    );
    recipient = await createRealTestUser(
      `sec-recipient-${ts}@relay.local`,
      'Password123!',
      'Sec Recipient'
    );
    outsider = await createRealTestUser(
      `sec-outsider-${ts}@relay.local`,
      'Password123!',
      'Sec Outsider'
    );

    // Bootstrap Org and Project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Sec Handover Org ${ts}`);

    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `Sec Handover Project ${ts}`,
      'Handover security test project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // 1. Import Public Source
    const pubText = 'Public technical architecture: PostgreSQL 16 selected.';
    const pubSourceHash = crypto.createHash('sha256').update(pubText).digest('hex');
    const pubSourceId = await importSource(pool, {
      actorId: reviewer.userId,
      projectId,
      title: 'Public Architecture',
      kind: 'text',
      visibility: 'project',
      content: pubText,
      contentSha256: pubSourceHash,
      chunks: [
        {
          ordinal: 0,
          content: pubText,
          startOffset: 0,
          endOffset: pubText.length,
          sha256: pubSourceHash,
          byteLength: pubText.length,
          codePointLength: pubText.length,
        },
      ],
    });

    // 2. Import Restricted Source (granted to reviewer only)
    const privText = 'Confidential: Personnel compensation adjustment for transition period.';
    const privSourceHash = crypto.createHash('sha256').update(privText).digest('hex');
    const privSourceId = await importSource(pool, {
      actorId: reviewer.userId,
      projectId,
      title: 'Personnel Note',
      kind: 'text',
      visibility: 'restricted',
      content: privText,
      contentSha256: privSourceHash,
      grantUserIds: [reviewer.userId],
      chunks: [
        {
          ordinal: 0,
          content: privText,
          startOffset: 0,
          endOffset: privText.length,
          sha256: privSourceHash,
          byteLength: privText.length,
          codePointLength: privText.length,
        },
      ],
    });

    // Query chunk IDs
    const pubChunks = await pool.query(
      'SELECT id FROM public.source_chunks WHERE source_id = $1 ORDER BY ordinal',
      [pubSourceId]
    );
    const pubChunkId = pubChunks.rows[0].id;

    const privChunks = await pool.query(
      'SELECT id FROM public.source_chunks WHERE source_id = $1 ORDER BY ordinal',
      [privSourceId]
    );
    const privChunkId = privChunks.rows[0].id;

    // 3. Persist claims directly
    const projCheck = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    const currentEpoch = projCheck.rows[0].access_epoch;

    const dummyJobId = crypto.randomUUID();
    await persistClaims(
      pool,
      reviewer.userId,
      projectId,
      dummyJobId,
      [
        {
          kind: 'decision',
          statement: 'PostgreSQL 16 selected as core database.',
          workState: 'open',
          evidenceState: 'supported',
          evidence: [
            {
              chunkId: pubChunkId,
              quote: 'PostgreSQL 16 selected',
              quoteStart: 31,
              quoteEnd: 53,
            },
          ],
        },
      ],
      currentEpoch
    );

    const pubClaimRows = await pool.query(
      `SELECT id FROM public.claims WHERE project_id = $1 AND statement LIKE '%PostgreSQL 16%'`,
      [projectId]
    );
    publicClaimId = pubClaimRows.rows[0].id;

    await persistClaims(
      pool,
      reviewer.userId,
      projectId,
      dummyJobId,
      [
        {
          kind: 'decision',
          statement: 'Personnel compensation adjustment approved for transition.',
          workState: 'open',
          evidenceState: 'supported',
          evidence: [
            {
              chunkId: privChunkId,
              quote: 'Personnel compensation adjustment',
              quoteStart: 14,
              quoteEnd: 47,
            },
          ],
        },
      ],
      currentEpoch
    );

    const privClaimRows = await pool.query(
      `SELECT id FROM public.claims WHERE project_id = $1 AND statement LIKE '%Personnel compensation%'`,
      [projectId]
    );
    restrictedClaimId = privClaimRows.rows[0].id;
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (outsider) await deleteRealTestUser(outsider.userId);
    if (pool) await closeDbPool(pool);
  });

  it('proves dual-reader scoping: reviewer cannot create draft containing claims inaccessible to recipient', async () => {
    const epoch = (
      await pool.query(`SELECT access_epoch FROM public.projects WHERE id = $1`, [projectId])
    ).rows[0].access_epoch;

    // Attempt to persist a handover draft containing the restricted claim for recipient
    // create_handover_draft_from_generation validates that recipient can read all cited claims!
    await expect(
      createHandoverDraftFromGeneration(pool, {
        actorId: reviewer.userId,
        projectId,
        recipientId: recipient.userId,
        departingUserId: reviewer.userId,
        title: 'Security Leak Test Handover',
        configuration: {
          title: 'Security Leak Test Handover',
          recipientId: recipient.userId,
          includedSections: ['snapshot'],
          detailLevel: 'standard',
          includeCompletedWork: false,
          includeProposedNextActions: false,
          tone: 'professional',
        },
        modelName: 'fake-deterministic',
        promptVersion: 'handover-v1',
        expectedAccessEpoch: epoch,
        items: [
          {
            section: 'snapshot',
            ordinal: 0,
            text: 'Leak attempt text',
            itemKind: 'fact',
            evidenceState: 'supported',
            claimIds: [restrictedClaimId], // RECIPIENT CANNOT READ THIS!
          },
        ],
      })
    ).rejects.toThrow(); // Aborts with error because recipient cannot read restricted claim
  });

  it('rejects adding or attaching claims inaccessible to recipient via API', async () => {
    const epoch = (
      await pool.query(`SELECT access_epoch FROM public.projects WHERE id = $1`, [projectId])
    ).rows[0].access_epoch;

    // Create valid draft with public claim
    const draftRes = await createHandoverDraftFromGeneration(pool, {
      actorId: reviewer.userId,
      projectId,
      recipientId: recipient.userId,
      departingUserId: reviewer.userId,
      title: 'Valid Draft',
      configuration: {
        title: 'Valid Draft',
        recipientId: recipient.userId,
        includedSections: ['snapshot'],
        detailLevel: 'standard',
        includeCompletedWork: false,
        includeProposedNextActions: false,
        tone: 'professional',
      },
      modelName: 'fake-deterministic',
      promptVersion: 'handover-v1',
      expectedAccessEpoch: epoch,
      items: [
        {
          section: 'snapshot',
          ordinal: 0,
          text: 'Valid public fact',
          itemKind: 'fact',
          evidenceState: 'supported',
          claimIds: [publicClaimId],
        },
      ],
    });

    // Try adding an item citing the restricted claim via API
    const addItemRes = await request(app)
      .post(`/api/v1/handovers/${draftRes.handoverId}/items`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .send({
        section: 'snapshot',
        text: 'Adding restricted claim maliciously',
        itemKind: 'fact',
        claimIds: [restrictedClaimId],
      });

    expect(addItemRes.status).toBe(409);
    expect(addItemRes.body.error.code).toBe('ACCESS_VALIDATION_FAILED');
  });

  it('enforces trigger-level immutability on approved and shared handovers', async () => {
    const epoch = (
      await pool.query(`SELECT access_epoch FROM public.projects WHERE id = $1`, [projectId])
    ).rows[0].access_epoch;

    // 1. Create and approve a handover
    const draft = await createHandoverDraftFromGeneration(pool, {
      actorId: reviewer.userId,
      projectId,
      recipientId: recipient.userId,
      departingUserId: reviewer.userId,
      title: 'Immutability Handover',
      configuration: {
        title: 'Immutability Handover',
        recipientId: recipient.userId,
        includedSections: ['snapshot'],
        detailLevel: 'standard',
        includeCompletedWork: false,
        includeProposedNextActions: false,
        tone: 'professional',
      },
      modelName: 'fake-deterministic',
      promptVersion: 'handover-v1',
      expectedAccessEpoch: epoch,
      items: [
        {
          section: 'snapshot',
          ordinal: 0,
          text: 'Immutable fact',
          itemKind: 'fact',
          evidenceState: 'supported',
          claimIds: [publicClaimId],
        },
      ],
    });

    // Mark item approved
    await pool.query(
      `UPDATE public.handover_items SET review_state = 'approved' WHERE handover_id = $1`,
      [draft.handoverId]
    );

    // Approve handover
    await approveHandover(pool, {
      actorId: reviewer.userId,
      handoverId: draft.handoverId,
      confirmReviewedForRecipient: true,
      comment: 'Approved for immutability test',
    });

    // 2. Direct SQL UPDATE on handover row must be BLOCKED by trigger handovers_immutability
    await expect(
      pool.query(`UPDATE public.handovers SET title = 'Tampered Title' WHERE id = $1`, [
        draft.handoverId,
      ])
    ).rejects.toThrow();

    // 3. Direct SQL DELETE on handover row must be BLOCKED by trigger handovers_immutability
    await expect(
      pool.query(`DELETE FROM public.handovers WHERE id = $1`, [draft.handoverId])
    ).rejects.toThrow();

    // 4. Direct SQL UPDATE on handover_items must be BLOCKED by trigger handover_items_immutability
    await expect(
      pool.query(
        `UPDATE public.handover_items SET text = 'Tampered Item Text' WHERE handover_id = $1`,
        [draft.handoverId]
      )
    ).rejects.toThrow();

    // 5. Direct SQL INSERT into handover_items must be BLOCKED by trigger handover_items_immutability
    await expect(
      pool.query(
        `INSERT INTO public.handover_items (id, handover_id, project_id, section, ordinal, text, item_kind, evidence_state, review_state, row_version, claim_ids)
         VALUES ($1, $2, $3, 'snapshot', 99, 'Tampered Injected Item', 'fact', 'supported', 'approved', 1, ARRAY[$4]::uuid[])`,
        [crypto.randomUUID(), draft.handoverId, projectId, publicClaimId]
      )
    ).rejects.toThrow();
  });

  it('returns 409 REGENERATION_REQUIRED to recipient when project access epoch advances', async () => {
    const epoch = (
      await pool.query(`SELECT access_epoch FROM public.projects WHERE id = $1`, [projectId])
    ).rows[0].access_epoch;

    // 1. Create, approve, and share a handover
    const draft = await createHandoverDraftFromGeneration(pool, {
      actorId: reviewer.userId,
      projectId,
      recipientId: recipient.userId,
      departingUserId: reviewer.userId,
      title: 'Epoch Test Handover',
      configuration: {
        title: 'Epoch Test Handover',
        recipientId: recipient.userId,
        includedSections: ['snapshot'],
        detailLevel: 'standard',
        includeCompletedWork: false,
        includeProposedNextActions: false,
        tone: 'professional',
      },
      modelName: 'fake-deterministic',
      promptVersion: 'handover-v1',
      expectedAccessEpoch: epoch,
      items: [
        {
          section: 'snapshot',
          ordinal: 0,
          text: 'Epoch testing fact',
          itemKind: 'fact',
          evidenceState: 'supported',
          claimIds: [publicClaimId],
        },
      ],
    });

    await pool.query(
      `UPDATE public.handover_items SET review_state = 'approved' WHERE handover_id = $1`,
      [draft.handoverId]
    );
    await approveHandover(pool, {
      actorId: reviewer.userId,
      handoverId: draft.handoverId,
      confirmReviewedForRecipient: true,
    });
    await shareHandover(pool, reviewer.userId, draft.handoverId);

    // Initial check: recipient can view shared handover
    const viewRes = await request(app)
      .get(`/api/v1/handovers/${draft.handoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);
    expect(viewRes.status).toBe(200);
    expect(viewRes.body.data.items.length).toBe(1);

    // 2. Advance project access epoch (simulate source permission change or revocation)
    await pool.query(`UPDATE public.projects SET access_epoch = access_epoch + 1 WHERE id = $1`, [
      projectId,
    ]);

    // 3. Recipient requests handover now that epoch changed
    const staleRecipientRes = await request(app)
      .get(`/api/v1/handovers/${draft.handoverId}`)
      .set('Authorization', `Bearer ${recipient.accessToken}`);

    expect(staleRecipientRes.status).toBe(409);
    expect(staleRecipientRes.body.error.code).toBe('REGENERATION_REQUIRED');

    // 4. Reviewer requests handover: receives metadata only with isStale: true and empty items
    const reviewerStaleRes = await request(app)
      .get(`/api/v1/handovers/${draft.handoverId}`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`);

    expect(reviewerStaleRes.status).toBe(200);
    expect(reviewerStaleRes.body.data.isStale).toBe(true);
    expect(reviewerStaleRes.body.data.items.length).toBe(0); // Zero items exposed
  });

  it('returns identical 404 NOT_FOUND for outsiders or non-existent handover IDs', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000099';
    const fakeRes = await request(app)
      .get(`/api/v1/handovers/${fakeId}`)
      .set('Authorization', `Bearer ${outsider.accessToken}`);

    expect(fakeRes.status).toBe(404);
    expect(fakeRes.body.error.code).toBe('NOT_FOUND');
  });
});
