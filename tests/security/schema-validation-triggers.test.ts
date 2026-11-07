import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
} from '@relay/database';
import { createRealTestUser, deleteRealTestUser, TestUser } from '@relay/test-fixtures';

describe('Security: Schema Validation Triggers (Safeguards 2, 3, 5, 15, 16)', () => {
  let pool: DbPool;
  let user: TestUser;
  let projectId: string;
  let sourceId: string;
  let chunkId: string;
  let claim1Id: string;
  let claim2Id: string;

  // Multi-byte Unicode string: "Hello 🚀 world! 日本語"
  // Code points: "Hello" (5) + " " (1) + "🚀" (1) + " " (1) + "world!" (6) + " " (1) + "日本語" (3) = 18 code points
  // Notice in JS: [...unicodeSourceContent].length is 18 (code points), while unicodeSourceContent.length is 19 (UTF-16 code units).
  const unicodeSourceContent = 'Hello 🚀 world! 日本語';
  const codePointLength = [...unicodeSourceContent].length; // 18

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    user = await createRealTestUser(
      `test-trig-${Date.now()}@relay.local`,
      'Password123!',
      'Triggers User'
    );
    const orgId = await bootstrapOrganisation(pool, user.userId, 'Triggers Org');
    projectId = await createProject(
      pool,
      user.userId,
      orgId,
      'Triggers Project',
      '',
      'general',
      'UTC'
    );

    // Create source
    const srcRes = await pool.query(
      `INSERT INTO public.sources (
        project_id, title, kind, visibility, content, content_sha256, created_by
      ) VALUES ($1, 'Unicode Source', 'text', 'project', $2, 'dummy-sha', $3)
      RETURNING id;`,
      [projectId, unicodeSourceContent, user.userId]
    );
    sourceId = srcRes.rows[0].id;

    // Create valid chunk spanning the whole content [0, 18)
    const chunkRes = await pool.query(
      `INSERT INTO public.source_chunks (
        source_id, project_id, ordinal, start_offset, end_offset, content
      ) VALUES ($1, $2, 0, 0, $3, $4)
      RETURNING id;`,
      [sourceId, projectId, codePointLength, unicodeSourceContent]
    );
    chunkId = chunkRes.rows[0].id;

    // Create two claims for relation testing
    const c1 = await pool.query(
      `INSERT INTO public.claims (
        project_id, kind, statement, evidence_state, dedupe_key, prompt_version
      ) VALUES ($1, 'decision', 'Decision 1', 'supported', 'dedupe-trig-1', 'v1')
      RETURNING id;`,
      [projectId]
    );
    claim1Id = c1.rows[0].id;

    const c2 = await pool.query(
      `INSERT INTO public.claims (
        project_id, kind, statement, evidence_state, dedupe_key, prompt_version
      ) VALUES ($1, 'decision', 'Decision 2', 'supported', 'dedupe-trig-2', 'v1')
      RETURNING id;`,
      [projectId]
    );
    claim2Id = c2.rows[0].id;
  });

  afterAll(async () => {
    if (user) await deleteRealTestUser(user.userId);
    await closeDbPool(pool);
  });

  describe('Chunk Validation Trigger (Safeguard 3)', () => {
    it('rejects chunk when content does not match source content at offsets', async () => {
      await expect(
        pool.query(
          `INSERT INTO public.source_chunks (
            source_id, project_id, ordinal, start_offset, end_offset, content
          ) VALUES ($1, $2, 1, 0, 5, 'Wrong');`,
          [sourceId, projectId]
        )
      ).rejects.toThrow(/chunk content does not match/);
    });

    it('rejects chunk when end_offset <= start_offset', async () => {
      await expect(
        pool.query(
          `INSERT INTO public.source_chunks (
            source_id, project_id, ordinal, start_offset, end_offset, content
          ) VALUES ($1, $2, 1, 5, 5, '');`,
          [sourceId, projectId]
        )
      ).rejects.toThrow(/end_offset.*must be > start_offset/);
    });

    it('accepts chunk matching exact unicode slice', async () => {
      // "日本語" is at offsets [15, 18)
      const slice = '日本語';
      await expect(
        pool.query(
          `INSERT INTO public.source_chunks (
            source_id, project_id, ordinal, start_offset, end_offset, content
          ) VALUES ($1, $2, 1, 15, 18, $3);`,
          [sourceId, projectId, slice]
        )
      ).resolves.not.toThrow();

      // Clean up chunk 1
      await pool.query('DELETE FROM public.source_chunks WHERE source_id = $1 AND ordinal = 1', [
        sourceId,
      ]);
    });
  });

  describe('Quote Validation Trigger (Safeguard 2)', () => {
    it('accepts exact Unicode quote with emoji', async () => {
      // Chunk content: "Hello 🚀 world! 日本語"
      // "🚀" is at quote_start = 6, quote_end = 7 (in Postgres character length)
      const quote = '🚀';
      await expect(
        pool.query(
          `INSERT INTO public.claim_evidence (
            project_id, claim_id, chunk_id, quote, quote_start, quote_end
          ) VALUES ($1, $2, $3, $4, 6, 7);`,
          [projectId, claim1Id, chunkId, quote]
        )
      ).resolves.not.toThrow();
    });

    it('rejects quote when text does not match substring at given offsets', async () => {
      await expect(
        pool.query(
          `INSERT INTO public.claim_evidence (
            project_id, claim_id, chunk_id, quote, quote_start, quote_end
          ) VALUES ($1, $2, $3, 'Fabricated Quote', 0, 16);`,
          [projectId, claim1Id, chunkId]
        )
      ).rejects.toThrow(/quote text does not match chunk content/);
    });

    it('rejects quote when quote_end exceeds chunk length', async () => {
      await expect(
        pool.query(
          `INSERT INTO public.claim_evidence (
            project_id, claim_id, chunk_id, quote, quote_start, quote_end
          ) VALUES ($1, $2, $3, 'overflow', 0, 9999);`,
          [projectId, claim1Id, chunkId]
        )
      ).rejects.toThrow(/quote_end.*exceeds chunk length/);
    });
  });

  describe('Symmetric Relations Ordering (Safeguard 15)', () => {
    it('automatically ensures from_claim_id < to_claim_id for symmetric relations', async () => {
      // Determine the larger and smaller UUID
      const [smallerId, largerId] =
        claim1Id < claim2Id ? [claim1Id, claim2Id] : [claim2Id, claim1Id];

      // Deliberately insert with largerId as from_claim_id
      await pool.query(
        `INSERT INTO public.claim_relationships (
          project_id, from_claim_id, to_claim_id, relation, explanation
        ) VALUES ($1, $2, $3, 'contradicts', 'Direct conflict');`,
        [projectId, largerId, smallerId]
      );

      // Verify the trigger swapped them so from_claim_id is smallerId
      const relRes = await pool.query(
        `SELECT from_claim_id, to_claim_id
         FROM public.claim_relationships
         WHERE project_id = $1 AND relation = 'contradicts';`,
        [projectId]
      );
      expect(relRes.rows[0].from_claim_id).toBe(smallerId);
      expect(relRes.rows[0].to_claim_id).toBe(largerId);
    });
  });

  describe('Approved and Shared Handover Immutability (Safeguards 5 & 16)', () => {
    let handoverId: string;
    let itemId: string;

    beforeAll(async () => {
      // Create a draft handover
      const hoRes = await pool.query(
        `INSERT INTO public.handovers (
          project_id, root_id, version, title, recipient_id, created_by,
          status, configuration, generated_access_epoch, model_name, prompt_version
        ) VALUES (
          $1, gen_random_uuid(), 1, 'Draft Handover', $2, $2,
          'draft', '{"template": "eng"}'::jsonb, 1, 'fake-model', 'v1'
        ) RETURNING id;`,
        [projectId, user.userId]
      );
      handoverId = hoRes.rows[0].id;
      // Set root_id = id
      await pool.query('UPDATE public.handovers SET root_id = id WHERE id = $1', [handoverId]);

      // Add a handover item
      const itemRes = await pool.query(
        `INSERT INTO public.handover_items (
          handover_id, project_id, section, ordinal, text, item_kind, evidence_state
        ) VALUES ($1, $2, 'snapshot', 0, 'System is ready', 'fact', 'supported')
        RETURNING id;`,
        [handoverId, projectId]
      );
      itemId = itemRes.rows[0].id;

      // Add item-claim link
      await pool.query(
        `INSERT INTO public.handover_item_claims (item_id, project_id, claim_id)
         VALUES ($1, $2, $3);`,
        [itemId, projectId, claim1Id]
      );

      // Now approve the handover
      await pool.query(
        `UPDATE public.handovers
         SET status = 'approved', approved_by = $1, approved_at = now(), approved_access_epoch = 1
         WHERE id = $2;`,
        [user.userId, handoverId]
      );
    });

    it('rejects modifications to title or configuration on approved handover', async () => {
      await expect(
        pool.query(`UPDATE public.handovers SET title = 'Hacked Title' WHERE id = $1;`, [
          handoverId,
        ])
      ).rejects.toThrow(/cannot be modified/);

      await expect(
        pool.query(
          `UPDATE public.handovers SET configuration = '{"tampered": true}'::jsonb WHERE id = $1;`,
          [handoverId]
        )
      ).rejects.toThrow(/cannot be modified/);
    });

    it('rejects modifications to items belonging to approved handover', async () => {
      await expect(
        pool.query(`UPDATE public.handover_items SET text = 'Altered text' WHERE id = $1;`, [
          itemId,
        ])
      ).rejects.toThrow(/parent handover is approved/);

      await expect(
        pool.query(`DELETE FROM public.handover_items WHERE id = $1;`, [itemId])
      ).rejects.toThrow(/parent handover is approved/);
    });

    it('rejects modifying item-claim links on approved handover', async () => {
      await expect(
        pool.query(
          `DELETE FROM public.handover_item_claims WHERE item_id = $1 AND claim_id = $2;`,
          [itemId, claim1Id]
        )
      ).rejects.toThrow(/parent handover is approved/);
    });

    it('allows valid status transition to shared', async () => {
      await expect(
        pool.query(
          `UPDATE public.handovers
           SET status = 'shared', shared_by = $1, shared_at = now()
           WHERE id = $2;`,
          [user.userId, handoverId]
        )
      ).resolves.not.toThrow();
    });
  });
});
