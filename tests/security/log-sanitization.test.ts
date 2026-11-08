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
  persistClaims,
} from '@relay/database';
import {
  getTestSupabaseConfig,
  createRealTestUser,
  deleteRealTestUser,
  type TestUser,
} from '@relay/test-fixtures';
import { serverEnvironmentSchema } from '@relay/contracts';
import { setFakeAdversarialMode } from '../../apps/api/src/ai/providers/fake-provider.js';

describe('Phase 8: Security Hardening - Log Sanitization & Provenance Integrity', () => {
  let pool: DbPool;
  let app: Express;
  let owner: TestUser;
  let reviewer: TestUser;
  let recipient: TestUser;
  let projectId: string;
  let orgId: string;

  const SECRET_SOURCE_PHRASE = 'HIGHLY_CONFIDENTIAL_ACQUISITION_TARGET_CODENAME_ORION_9988';
  const SECRET_QUOTE_PHRASE =
    'Project Orion enterprise valuation is estimated at fifty million dollars';

  beforeAll(async () => {
    setFakeAdversarialMode('none');
    const config = getTestSupabaseConfig();
    pool = createDbPool(config.databaseUrl);

    const env = serverEnvironmentSchema.parse({
      ...process.env,
      NODE_ENV: 'test',
      AI_PROVIDER: 'fake',
    });

    const runSuffix = Date.now();
    owner = await createRealTestUser(
      `log-owner-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Log Owner'
    );
    reviewer = await createRealTestUser(
      `log-reviewer-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Log Reviewer'
    );
    recipient = await createRealTestUser(
      `log-recipient-${runSuffix}@relay.local`,
      'TestPassword123!',
      'Log Recipient'
    );

    orgId = await bootstrapOrganisation(pool, owner.userId, 'Log Audit Corp');

    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Log Audit Project',
      'Confidential Project',
      'general',
      'UTC'
    );

    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    app = createApp({ env, pool });
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    await closeDbPool(pool);
  });

  it('runs complete lifecycle journey and asserts zero tokens, source text, prompts, responses, or quotes in captured logs', async () => {
    // Intercept console.log and process.stdout
    const capturedLogs: string[] = [];
    const originalStdoutWrite = process.stdout.write;
    process.stdout.write = ((chunk: any) => {
      capturedLogs.push(String(chunk));
      return true;
    }) as any;

    try {
      // 1. Ingest source with sensitive text
      const importRes = await request(app)
        .post(`/api/v1/projects/${projectId}/sources/import`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .send({
          kind: 'text',
          title: 'Classified Memo',
          content: `${SECRET_SOURCE_PHRASE}\n\n${SECRET_QUOTE_PHRASE}. The decision was approved yesterday.`,
          visibility: 'project',
        });

      expect(importRes.status).toBe(201);
      const sourceId = importRes.body.data.sources[0].id;

      // 2. Fetch sources and chunks
      const sourcesRes = await request(app)
        .get(`/api/v1/projects/${projectId}/sources`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      expect(sourcesRes.status).toBe(200);

      const chunksRes = await request(app)
        .get(`/api/v1/sources/${sourceId}/chunks`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`);
      expect(chunksRes.status).toBe(200);
      const chunkId = chunksRes.body.data[0].id;
      const chunkText = chunksRes.body.data[0].content;
      const quoteStart = chunkText.indexOf(SECRET_QUOTE_PHRASE);
      const quoteEnd = quoteStart + SECRET_QUOTE_PHRASE.length;

      const epochRes = await pool.query<{ access_epoch: number }>(
        'SELECT access_epoch FROM public.projects WHERE id = $1',
        [projectId]
      );
      const currentEpoch = epochRes.rows[0].access_epoch;

      // 3. Persist claims directly
      const persistRes = await persistClaims(
        pool,
        reviewer.userId,
        projectId,
        '77777777-8888-9999-aaaa-bbbbccccdddd',
        [
          {
            kind: 'decision',
            statement: 'Project Orion approved with valuation fifty million dollars',
            workState: 'completed',
            evidenceState: 'supported',
            confidence: 0.95,
            ownerLabel: null,
            ownerUserId: null,
            observedAt: '2026-03-01T00:00:00Z',
            evidence: [
              {
                chunkId: chunkId,
                quote: SECRET_QUOTE_PHRASE,
                quoteStart,
                quoteEnd,
              },
            ],
          },
        ],
        currentEpoch
      );
      expect(persistRes.inserted).toBe(1);

      // 4. Generate & Review Handover Draft
      const draftRes = await request(app)
        .post(`/api/v1/projects/${projectId}/handovers`)
        .set('Authorization', `Bearer ${reviewer.accessToken}`)
        .set('Idempotency-Key', '88888888-9999-aaaa-bbbb-ccccddddeeee')
        .send({
          title: 'Orion Handover',
          recipientId: recipient.userId,
          departingUserId: reviewer.userId,
          includedSections: ['snapshot', 'decisions', 'next_actions'],
          detailLevel: 'standard',
          priorityFocus: 'Valuation and architecture',
          includeCompletedWork: true,
          includeProposedNextActions: true,
          tone: 'professional',
        });
      expect(draftRes.status).toBe(202);

      // 5. Ask Relay Q&A
      const convRes = await request(app)
        .post(`/api/v1/projects/${projectId}/conversations`)
        .set('Authorization', `Bearer ${recipient.accessToken}`);
      expect(convRes.status).toBe(201);
      const convId = convRes.body.data.id;

      const askRes = await request(app)
        .post(`/api/v1/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${recipient.accessToken}`)
        .send({ question: 'What is the valuation of Orion?' });
      expect(askRes.status).toBe(200);

      // Restore stdout write
      process.stdout.write = originalStdoutWrite;

      const fullLogOutput = capturedLogs.join('\n');

      // Assert zero secret tokens leaked in logs
      expect(fullLogOutput).not.toContain(reviewer.accessToken);
      expect(fullLogOutput).not.toContain(recipient.accessToken);
      expect(fullLogOutput).not.toContain(`Bearer ${reviewer.accessToken}`);

      // Assert zero raw source body phrases leaked in logs
      expect(fullLogOutput).not.toContain(SECRET_SOURCE_PHRASE);

      // Assert zero system prompt templates leaked in logs
      expect(fullLogOutput).not.toContain(
        'You are an expert AI system analyzing project knowledge'
      );
      expect(fullLogOutput).not.toContain('STRICT JSON OUTPUT ONLY');

      // Assert zero exact source quotes leaked in server logs
      expect(fullLogOutput).not.toContain(SECRET_QUOTE_PHRASE);

      // Headers like authorization must be explicitly redacted
      if (fullLogOutput.includes('authorization')) {
        expect(fullLogOutput).toContain('[REDACTED]');
      }
    } finally {
      process.stdout.write = originalStdoutWrite;
    }
  });

  it('verifies audit metadata is free of restricted source content and claims text', async () => {
    const auditRows = await pool.query<{ metadata: any; action: string }>(
      'SELECT action, metadata FROM public.audit_events WHERE project_id = $1',
      [projectId]
    );

    for (const row of auditRows.rows) {
      const metaStr = JSON.stringify(row.metadata || {});
      // Audit events must never store raw source bodies or quotations
      expect(metaStr).not.toContain(SECRET_SOURCE_PHRASE);
      expect(metaStr).not.toContain(SECRET_QUOTE_PHRASE);
    }
  });
});
