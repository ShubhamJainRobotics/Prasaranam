import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
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
  approveHandover,
} from '@relay/database';
import {
  getTestSupabaseConfig,
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
} from '@relay/test-fixtures';
import { serverEnvironmentSchema } from '@relay/contracts';
import { setFakeAdversarialMode } from '../../apps/api/src/ai/providers/fake-provider.js';

describe('Phase 7: Q&A and Export Security Invariants', () => {
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
  let reviewerConvId: string;
  let recipientConvId: string;

  beforeAll(async () => {
    setFakeAdversarialMode('none');
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
    owner = await createRealTestUser(
      `qa-sec-owner-${ts}@relay.local`,
      'Password123!',
      'QA Sec Owner'
    );
    reviewer = await createRealTestUser(
      `qa-sec-rev-${ts}@relay.local`,
      'Password123!',
      'QA Sec Reviewer'
    );
    recipient = await createRealTestUser(
      `qa-sec-rec-${ts}@relay.local`,
      'Password123!',
      'QA Sec Recipient'
    );
    outsider = await createRealTestUser(
      `qa-sec-out-${ts}@relay.local`,
      'Password123!',
      'QA Sec Outsider'
    );

    orgId = await bootstrapOrganisation(pool, owner.userId, `QA Sec Org ${ts}`);
    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      `QA Sec Project ${ts}`,
      'QA security test project',
      'software_engineering',
      'UTC'
    );

    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // 1. Ingest Public Source
    const pubText = 'Decision: The core platform adopts TypeScript 5 for strict type safety.';
    const pubHash = crypto.createHash('sha256').update(pubText).digest('hex');
    const pubSourceId = await importSource(pool, {
      actorId: reviewer.userId,
      projectId,
      title: 'Public Architecture Spec',
      kind: 'text',
      visibility: 'project',
      content: pubText,
      contentSha256: pubHash,
      chunks: [
        {
          ordinal: 0,
          content: pubText,
          startOffset: 0,
          endOffset: pubText.length,
          sha256: pubHash,
          byteLength: pubText.length,
          codePointLength: pubText.length,
        },
      ],
    });

    // 2. Ingest Restricted Source (granted to reviewer only)
    const privText = 'Confidential: Transition executive retention compensation is 85000 USD.';
    const privHash = crypto.createHash('sha256').update(privText).digest('hex');
    const privSourceId = await importSource(pool, {
      actorId: reviewer.userId,
      projectId,
      title: 'Confidential Compensation Memo',
      kind: 'text',
      visibility: 'restricted',
      content: privText,
      contentSha256: privHash,
      grantUserIds: [reviewer.userId],
      chunks: [
        {
          ordinal: 0,
          content: privText,
          startOffset: 0,
          endOffset: privText.length,
          sha256: privHash,
          byteLength: privText.length,
          codePointLength: privText.length,
        },
      ],
    });

    const pubChunks = await pool.query(
      'SELECT id FROM public.source_chunks WHERE source_id = $1 LIMIT 1',
      [pubSourceId]
    );
    const pubChunkId = pubChunks.rows[0].id;

    const privChunks = await pool.query(
      'SELECT id FROM public.source_chunks WHERE source_id = $1 LIMIT 1',
      [privSourceId]
    );
    const privChunkId = privChunks.rows[0].id;

    // 3. Persist claims directly
    const epochRes = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    const currentEpoch = epochRes.rows[0].access_epoch;

    const pubPersist = await persistClaims(
      pool,
      reviewer.userId,
      projectId,
      crypto.randomUUID(),
      [
        {
          kind: 'decision',
          statement: 'Decision: The core platform adopts TypeScript 5 for strict type safety.',
          workState: 'completed',
          evidenceState: 'supported',
          ownerLabel: null,
          observedAt: null,
          evidence: [
            {
              chunkId: pubChunkId,
              quote: 'Decision: The core platform adopts TypeScript 5 for strict type safety.',
              quoteStart: 0,
              quoteEnd: pubText.length,
            },
          ],
        },
      ],
      currentEpoch
    );
    expect(pubPersist.inserted).toBe(1);

    const privPersist = await persistClaims(
      pool,
      reviewer.userId,
      projectId,
      crypto.randomUUID(),
      [
        {
          kind: 'decision',
          statement: 'Confidential: Transition executive retention compensation is 85000 USD.',
          workState: 'completed',
          evidenceState: 'supported',
          ownerLabel: null,
          observedAt: null,
          evidence: [
            {
              chunkId: privChunkId,
              quote: 'Confidential: Transition executive retention compensation is 85000 USD.',
              quoteStart: 0,
              quoteEnd: privText.length,
            },
          ],
        },
      ],
      currentEpoch
    );
    expect(privPersist.inserted).toBe(1);

    const pubClaimRow = await pool.query(
      'SELECT id FROM public.claims WHERE project_id = $1 AND statement LIKE $2',
      [projectId, '%TypeScript%']
    );
    publicClaimId = pubClaimRow.rows[0].id;

    const privClaimRow = await pool.query(
      'SELECT id FROM public.claims WHERE project_id = $1 AND statement LIKE $2',
      [projectId, '%85000%']
    );
    restrictedClaimId = privClaimRow.rows[0].id;
  }, 45000);

  afterAll(async () => {
    setFakeAdversarialMode('none');
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (outsider) await deleteRealTestUser(outsider.userId);
    if (pool) await closeDbPool(pool);
  });

  describe('1. Restricted Claim Isolation in Q&A (SPEC 2A.2 & 2A.9)', () => {
    it('creates a conversation for recipient and reviewer', async () => {
      const recRes = await request(app)
        .post(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send();
      expect(recRes.status).toBe(201);
      recipientConvId = recRes.body.data.id;

      const revRes = await request(app)
        .post(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send();
      expect(revRes.status).toBe(201);
      reviewerConvId = revRes.body.data.id;
    });

    it('recipient asking about confidential compensation gets insufficient_evidence without leaking restricted content', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What is the confidential retention compensation bonus?' });

      expect(res.status).toBe(200);
      const answer = res.body.data.body;
      expect(answer.status).toBe('insufficient_evidence');
      expect(answer.statements).toHaveLength(0);

      // Verify no leak of 85000, compensation, or restrictedClaimId
      const fullResponseText = JSON.stringify(res.body);
      expect(fullResponseText).not.toContain('85000');
      expect(fullResponseText).not.toContain(restrictedClaimId);
      expect(fullResponseText).not.toContain('Confidential Compensation Memo');
    });

    it('reviewer who has grant to restricted source can query confidential compensation', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${reviewerConvId}/messages`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ question: 'What is the confidential retention compensation bonus?' });

      expect(res.status).toBe(200);
      const answer = res.body.data.body;
      expect(answer.status).toBe('answered');
      expect(answer.statements.length).toBeGreaterThan(0);
      expect(answer.statements[0].text).toContain('85000 USD');
      expect(answer.statements[0].citations[0].sourceTitle).toBe('Confidential Compensation Memo');
    });

    it('recipient asking general question receives only public TypeScript claim', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What platform decisions were made regarding type safety?' });

      expect(res.status).toBe(200);
      const answer = res.body.data.body;
      expect(answer.status).toBe('answered');
      expect(answer.statements.length).toBeGreaterThan(0);
      expect(answer.statements[0].text).toContain('TypeScript 5');

      const fullResponseText = JSON.stringify(res.body);
      expect(fullResponseText).not.toContain('85000');
      expect(fullResponseText).not.toContain(restrictedClaimId);
    });
  });

  describe('2. Cross-User Conversation Isolation & Non-Enumeration (SPEC 2A.2)', () => {
    it('recipient cannot view reviewer conversation (returns 404, not 403)', async () => {
      const res = await request(app)
        .get(`/api/v1/conversations/${reviewerConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('recipient cannot post message to reviewer conversation (returns 404, not 403)', async () => {
      const res = await request(app)
        .post(`/api/v1/conversations/${reviewerConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'Attempting to inject into reviewer conversation' });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('outsider cannot create conversation in project (returns 404)', async () => {
      const res = await request(app)
        .post(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .send();

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('listing conversations returns only caller own conversations', async () => {
      const res = await request(app)
        .get(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      const convs = res.body.data;
      expect(convs.every((c: any) => c.userId === recipient.userId)).toBe(true);
      expect(convs.some((c: any) => c.id === reviewerConvId)).toBe(false);
    });
  });

  describe('3. Adversarial Model Citation Rejection (SPEC 2A.9 item 5)', () => {
    it('rejects answer citing unsupplied claim ID with 422 SEMANTIC_VALIDATION_FAILED', async () => {
      setFakeAdversarialMode('unsupplied_claim');

      const res = await request(app)
        .post(`/api/v1/conversations/${reviewerConvId}/messages`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ question: 'What platform decisions were made?' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEMANTIC_VALIDATION_FAILED');
      const details = res.body.error.details || [];
      expect(
        details.some((d: any) =>
          typeof d === 'string'
            ? d.includes('unsupplied claim ID')
            : d.message?.includes('unsupplied claim ID')
        )
      ).toBe(true);

      // Verify ai_usage recorded as validation_failed
      const usageRes = await pool.query(
        "SELECT * FROM public.ai_usage WHERE project_id = $1 AND purpose = 'answer' AND outcome = 'validation_failed' ORDER BY created_at DESC LIMIT 1",
        [projectId]
      );
      expect(usageRes.rows.length).toBe(1);

      setFakeAdversarialMode('none');
    });

    it('rejects answer citing fabricated claim ID with 422 SEMANTIC_VALIDATION_FAILED', async () => {
      setFakeAdversarialMode('fabricated_claim_id');

      const res = await request(app)
        .post(`/api/v1/conversations/${reviewerConvId}/messages`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({ question: 'What platform decisions were made?' });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('SEMANTIC_VALIDATION_FAILED');

      setFakeAdversarialMode('none');
    });
  });

  describe('4. Stale Conversation History Notice (SPEC 2A.9 item 4)', () => {
    it('hides messages and returns generic unavailable notice when epoch advances', async () => {
      // User has existing messages
      const beforeRes = await request(app)
        .get(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);
      expect(beforeRes.status).toBe(200);
      expect(beforeRes.body.data.messages.length).toBeGreaterThan(0);
      expect(beforeRes.body.data.hasStaleHistory).toBe(false);

      // Advance project epoch
      await pool.query('UPDATE public.projects SET access_epoch = access_epoch + 1 WHERE id = $1', [
        projectId,
      ]);

      // Query again: prior messages hidden, notice present
      const afterRes = await request(app)
        .get(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(afterRes.status).toBe(200);
      expect(afterRes.body.data.hasStaleHistory).toBe(true);
      expect(afterRes.body.data.historyUnavailableNotice).toBe(
        'Conversation history before the last access change is unavailable.'
      );
      expect(afterRes.body.data.messages).toHaveLength(0);
    });
  });

  describe('5. Hostile Content Escaping in Export (SPEC 2A.14)', () => {
    let hostileHandoverId: string;

    beforeAll(async () => {
      const curEpochRes = await pool.query(
        'SELECT access_epoch FROM public.projects WHERE id = $1',
        [projectId]
      );
      const curEpoch = BigInt(curEpochRes.rows[0].access_epoch);

      // Create draft handover
      const hoRes = await pool.query(
        `INSERT INTO public.handovers (
           project_id, root_id, version, title, recipient_id, created_by,
           status, generated_access_epoch, configuration, model_name, prompt_version
         ) VALUES ($1, gen_random_uuid(), 1, $2, $3, $4, 'draft', $5, $6, 'fake-deterministic', 'handover-v1')
         RETURNING id`,
        [
          projectId,
          'Hostile Payload Verification Handover <script>alert("xss")</script>',
          recipient.userId,
          reviewer.userId,
          curEpoch.toString(),
          JSON.stringify({
            title: 'Hostile Payload Verification Handover <script>alert("xss")</script>',
            recipientId: recipient.userId,
            includedSections: ['decisions'],
          }),
        ]
      );
      hostileHandoverId = hoRes.rows[0].id;

      // Hostile items: script tag, iframe, markdown link injection, unicode cyrillic
      const hostileStatement =
        'Decision: Platform config <script>document.cookie="stolen"</script> <iframe src="javascript:alert(1)"></iframe> [Steal Tokens](https://evil.local/steal) Архитектура 🚀';

      const itemInsert = await pool.query(
        `INSERT INTO public.handover_items (
           handover_id, project_id, section, ordinal, text, item_kind, evidence_state, review_state
         ) VALUES ($1, $2, 'decisions', 1, $3, 'fact', 'supported', 'approved')
         RETURNING id`,
        [hostileHandoverId, projectId, hostileStatement]
      );
      const itemId = itemInsert.rows[0].id;

      await pool.query(
        'INSERT INTO public.handover_item_claims (item_id, project_id, claim_id) VALUES ($1, $2, $3)',
        [itemId, projectId, publicClaimId]
      );

      // Approve handover
      await approveHandover(pool, {
        actorId: reviewer.userId,
        handoverId: hostileHandoverId,
        confirmReviewedForRecipient: true,
        comment: 'Approved hostile payload test handover',
      });
    });

    it('escapes HTML and defangs markdown links in Markdown export', async () => {
      const res = await request(app)
        .get(`/api/v1/handovers/${hostileHandoverId}/export?format=md`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);

      expect(res.status).toBe(200);
      const md = res.text;

      // Defanged / escaped: no raw <script> or <iframe> tags
      expect(md).not.toContain('<script>');
      expect(md).not.toContain('<iframe');
      expect(md).toContain('&lt;script&gt;');
      expect(md).toContain('&lt;iframe');

      // Markdown links must NOT be clickable [Link](url); should print as inert text
      expect(md).not.toMatch(/\[Steal Tokens\]\(https:\/\/evil\.local\/steal\)/);
      expect(md).toContain('evil');
      expect(md).toContain('steal');

      // Non-Latin text preserved
      expect(md).toContain('Архитектура');
    });

    it('PDF export renders hostile and non-Latin content safely', async () => {
      const res = await request(app)
        .get(`/api/v1/handovers/${hostileHandoverId}/export?format=pdf`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .responseType('blob');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/pdf');

      const buffer = Buffer.from(res.body);
      const parsedText = execSync('pdftotext - -', {
        input: buffer,
        encoding: 'utf-8',
      });

      // Renders hostile text inertly in PDF document without execution
      expect(parsedText).toContain('alert("xss")');
      // Unicode cyrillic text extracted from PDF
      expect(parsedText).toContain('Архитектура');
    });
  });

  describe('6. Invariance: Q&A Never Mutates Core Data (SPEC 2A.9 item 7)', () => {
    it('running Q&A queries never alters claims, handovers, reviews, or project memberships', async () => {
      const claimsBefore = await pool.query('SELECT count(*)::int as c FROM public.claims');
      const handoversBefore = await pool.query(
        'SELECT count(*)::int as c, sum(row_version)::int as rv FROM public.handovers'
      );
      const itemsBefore = await pool.query(
        'SELECT count(*)::int as c, sum(row_version)::int as rv FROM public.handover_items'
      );
      const reviewsBefore = await pool.query('SELECT count(*)::int as c FROM public.reviews');
      const membersBefore = await pool.query(
        'SELECT count(*)::int as c FROM public.project_members'
      );

      // Run multiple Q&A messages
      await request(app)
        .post(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What database did we decide to adopt?' });

      await request(app)
        .post(`/api/v1/conversations/${recipientConvId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'Are there any unknown requirements?' });

      const claimsAfter = await pool.query('SELECT count(*)::int as c FROM public.claims');
      const handoversAfter = await pool.query(
        'SELECT count(*)::int as c, sum(row_version)::int as rv FROM public.handovers'
      );
      const itemsAfter = await pool.query(
        'SELECT count(*)::int as c, sum(row_version)::int as rv FROM public.handover_items'
      );
      const reviewsAfter = await pool.query('SELECT count(*)::int as c FROM public.reviews');
      const membersAfter = await pool.query(
        'SELECT count(*)::int as c FROM public.project_members'
      );

      expect(claimsAfter.rows[0]).toEqual(claimsBefore.rows[0]);
      expect(handoversAfter.rows[0]).toEqual(handoversBefore.rows[0]);
      expect(itemsAfter.rows[0]).toEqual(itemsBefore.rows[0]);
      expect(reviewsAfter.rows[0]).toEqual(reviewsBefore.rows[0]);
      expect(membersAfter.rows[0]).toEqual(membersBefore.rows[0]);
    });
  });
});
