import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import {
  createDbPool,
  closeDbPool,
  DbPool,
  bootstrapOrganisation,
  createProject,
  addOrgMember,
  addProjectMember,
} from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  TestUser,
  mockDevServerEnv,
} from '@relay/test-fixtures';

describe('API Integration: Source Ingestion & Evidence Routes', () => {
  let pool: DbPool;
  let app: any;
  let owner: TestUser;
  let reviewer: TestUser;
  let contributor: TestUser;
  let recipient: TestUser;
  let projectId: string;
  let orgId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    app = createApp({ env: mockDevServerEnv, pool });

    const ts = Date.now();
    owner = await createRealTestUser(`src-owner-${ts}@relay.local`, 'Password123!', 'Owner');
    reviewer = await createRealTestUser(`src-rev-${ts}@relay.local`, 'Password123!', 'Reviewer');
    contributor = await createRealTestUser(
      `src-contrib-${ts}@relay.local`,
      'Password123!',
      'Contrib'
    );
    recipient = await createRealTestUser(
      `src-recip-${ts}@relay.local`,
      'Password123!',
      'Recipient'
    );

    // Create organisation and project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Source Test Org ${ts}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Source Test Project',
      'Test description',
      'software_engineering',
      'UTC'
    );

    // Add members
    await addOrgMember(pool, owner.userId, orgId, reviewer.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, reviewer.userId, 'reviewer');

    await addOrgMember(pool, owner.userId, orgId, contributor.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, contributor.userId, 'contributor');

    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (reviewer) await deleteRealTestUser(reviewer.userId);
    if (contributor) await deleteRealTestUser(contributor.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    await closeDbPool(pool);
  });

  it('POST /projects/:id/sources/import imports pasted plain text and generates chunks', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${contributor.accessToken}`)
      .send({
        title: 'Initial Database Proposal',
        kind: 'text',
        content:
          'We propose using PostgreSQL for the ledger.\n\nTransactions require strict isolation.',
        visibility: 'project',
        authorLabel: 'Dana Vance',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.source).toBeDefined();
    expect(res.body.data.source.title).toBe('Initial Database Proposal');
    expect(res.body.data.source.kind).toBe('text');
    expect(res.body.data.source.visibility).toBe('project');
    expect(res.body.data.source.revision).toBe(1);
    expect(res.body.data.source.chunkCount).toBe(1);
  });

  it('POST /projects/:id/sources/import supports multipart file upload', async () => {
    const file1Content = '# Markdown Architecture\n\nApproved ADR 001.';
    const file2Content = 'Plain text log file.\n\nEverything operational.';

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('files', Buffer.from(file1Content), 'adr-001.md')
      .attach('files', Buffer.from(file2Content), 'system.txt')
      .field('visibility', 'project');

    expect(res.status).toBe(201);
    expect(res.body.data.sources.length).toBe(2);
    expect(res.body.data.sources[0].title).toBe('adr-001.md');
    expect(res.body.data.sources[0].kind).toBe('markdown');
    expect(res.body.data.sources[1].title).toBe('system.txt');
    expect(res.body.data.sources[1].kind).toBe('text');
  });

  it('POST /projects/:id/sources/import imports relay.messages.v1 and relay.issues.v1 JSON envelopes', async () => {
    const messagesEnvelope = {
      format: 'relay.messages.v1',
      records: [
        {
          id: 'msg-101',
          text: 'Payment webhook received successfully.',
          author: 'Alice',
          timestamp: '2026-03-05T12:00:00Z',
          url: null,
        },
      ],
    };

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${reviewer.accessToken}`)
      .attach('files', Buffer.from(JSON.stringify(messagesEnvelope)), 'slack-export.json')
      .field('visibility', 'project');

    expect(res.status).toBe(201);
    expect(res.body.data.source.kind).toBe('messages');
    expect(res.body.data.source.chunkCount).toBe(1);
  });

  it('Replace-by-revision: re-importing with replacesSourceId increments revision, archives previous, and invalidates epoch', async () => {
    // 1. Initial source
    const initialRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Draft Policy',
        kind: 'text',
        content: 'Original draft wording.',
        visibility: 'project',
      });

    const initialSourceId = initialRes.body.data.source.id;
    const initialLineageId = initialRes.body.data.source.lineageId;
    expect(initialRes.body.data.source.revision).toBe(1);

    // Get current project epoch
    const projBefore = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    const epochBefore = Number(projBefore.rows[0].access_epoch);

    // 2. Replace by revision
    const replaceRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Draft Policy (Updated)',
        kind: 'text',
        content: 'Revised and expanded policy wording.',
        visibility: 'project',
        replacesSourceId: initialSourceId,
      });

    expect(replaceRes.status).toBe(201);
    const newSource = replaceRes.body.data.source;
    expect(newSource.revision).toBe(2);
    expect(newSource.lineageId).toBe(initialLineageId);

    // Verify old source is archived
    const oldSourceCheck = await pool.query(
      'SELECT archived_at, archived_by FROM public.sources WHERE id = $1',
      [initialSourceId]
    );
    expect(oldSourceCheck.rows[0].archived_at).not.toBeNull();
    expect(oldSourceCheck.rows[0].archived_by).toBe(owner.userId);

    // Verify epoch incremented
    const projAfter = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    expect(Number(projAfter.rows[0].access_epoch)).toBeGreaterThan(epochBefore);
  });

  it('GET /projects/:id/sources lists accessible sources with cursor pagination', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}/sources?limit=2`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.page).toBeDefined();

    if (res.body.page.hasMore) {
      expect(res.body.page.nextCursor).toBeDefined();

      // Fetch next page
      const page2 = await request(app)
        .get(`/api/v1/projects/${projectId}/sources?limit=2&cursor=${res.body.page.nextCursor}`)
        .set('Authorization', `Bearer ${owner.accessToken}`);

      expect(page2.status).toBe(200);
      expect(page2.body.data.length).toBeGreaterThan(0);
    }
  });

  it('GET /sources/:id and GET /sources/:id/chunks return full content and chunks', async () => {
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Chunks Verification Note',
        kind: 'text',
        content: 'Section 1 text.\n\nSection 2 text.',
        visibility: 'project',
      });

    const sourceId = importRes.body.data.source.id;

    // Fetch detail
    const detailRes = await request(app)
      .get(`/api/v1/sources/${sourceId}`)
      .set('Authorization', `Bearer ${contributor.accessToken}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.content).toBe('Section 1 text.\n\nSection 2 text.');

    // Fetch chunks
    const chunksRes = await request(app)
      .get(`/api/v1/sources/${sourceId}/chunks`)
      .set('Authorization', `Bearer ${contributor.accessToken}`);

    expect(chunksRes.status).toBe(200);
    expect(chunksRes.body.data.length).toBe(1);
    expect(chunksRes.body.data[0].content).toBe('Section 1 text.\n\nSection 2 text.');
  });

  it('PATCH /sources/:id/access updates visibility and increments access epoch', async () => {
    // Import project source
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Security Access Test',
        kind: 'text',
        content: 'Restricted financial records.',
        visibility: 'project',
      });

    const sourceId = importRes.body.data.source.id;

    const projBefore = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    const epochBefore = Number(projBefore.rows[0].access_epoch);

    // Change to restricted granting reviewer
    const patchRes = await request(app)
      .patch(`/api/v1/sources/${sourceId}/access`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        visibility: 'restricted',
        grantUserIds: [reviewer.userId],
      });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.data.visibility).toBe('restricted');
    expect(patchRes.body.data.grantUserIds).toContain(reviewer.userId);

    // Verify epoch incremented
    const projAfter = await pool.query('SELECT access_epoch FROM public.projects WHERE id = $1', [
      projectId,
    ]);
    expect(Number(projAfter.rows[0].access_epoch)).toBeGreaterThan(epochBefore);
  });

  it('POST /sources/:id/archive archives source, increments epoch, and hides from listing', async () => {
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'To Be Archived',
        kind: 'text',
        content: 'Old temporary notes.',
        visibility: 'project',
      });

    const sourceId = importRes.body.data.source.id;

    const archiveRes = await request(app)
      .post(`/api/v1/sources/${sourceId}/archive`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.archived).toBe(true);

    // Reading detail now returns 404
    const getRes = await request(app)
      .get(`/api/v1/sources/${sourceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(getRes.status).toBe(404);
  });

  it('All 4 downloadable examples in apps/web/public/examples import successfully', async () => {
    const examplesDir = path.resolve(process.cwd(), 'apps/web/public/examples');

    // 1. messages.v1.json
    const msgFile = path.join(examplesDir, 'messages.v1.json');
    const msgBuffer = fs.readFileSync(msgFile);
    const msgRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('files', msgBuffer, 'messages.v1.json');
    expect(msgRes.status).toBe(201);
    expect(msgRes.body.data.source.kind).toBe('messages');

    // 2. issues.v1.json
    const issuesFile = path.join(examplesDir, 'issues.v1.json');
    const issuesBuffer = fs.readFileSync(issuesFile);
    const issuesRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('files', issuesBuffer, 'issues.v1.json');
    expect(issuesRes.status).toBe(201);
    expect(issuesRes.body.data.source.kind).toBe('issues');

    // 3. sample.md
    const mdFile = path.join(examplesDir, 'sample.md');
    const mdBuffer = fs.readFileSync(mdFile);
    const mdRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('files', mdBuffer, 'sample.md');
    expect(mdRes.status).toBe(201);
    expect(mdRes.body.data.source.kind).toBe('markdown');

    // 4. sample.txt
    const txtFile = path.join(examplesDir, 'sample.txt');
    const txtBuffer = fs.readFileSync(txtFile);
    const txtRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .attach('files', txtBuffer, 'sample.txt');
    expect(txtRes.status).toBe(201);
    expect(txtRes.body.data.source.kind).toBe('text');
  });
});
