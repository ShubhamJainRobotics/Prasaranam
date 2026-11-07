import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import https from 'node:https';
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

describe('Security Invariants: Source Ingestion & Evidence Isolation', () => {
  let pool: DbPool;
  let app: any;
  let owner: TestUser;
  let grantedMember: TestUser;
  let ungrantedMember: TestUser;
  let recipient: TestUser;
  let outsider: TestUser;
  let projectId: string;
  let orgId: string;
  let outsiderProjectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    app = createApp({ env: mockDevServerEnv, pool });

    const ts = Date.now();
    owner = await createRealTestUser(`sec-owner-${ts}@relay.local`, 'Password123!', 'Owner');
    grantedMember = await createRealTestUser(
      `sec-granted-${ts}@relay.local`,
      'Password123!',
      'Granted'
    );
    ungrantedMember = await createRealTestUser(
      `sec-ungranted-${ts}@relay.local`,
      'Password123!',
      'Ungranted'
    );
    recipient = await createRealTestUser(
      `sec-recip-${ts}@relay.local`,
      'Password123!',
      'Recipient'
    );
    outsider = await createRealTestUser(
      `sec-outsider-${ts}@othercorp.local`,
      'Password123!',
      'Outsider'
    );

    // Primary project
    orgId = await bootstrapOrganisation(pool, owner.userId, `Sec Org ${ts}`);
    projectId = await createProject(
      pool,
      owner.userId,
      orgId,
      'Sec Payments Project',
      'Security test project',
      'software_engineering',
      'UTC'
    );

    await addOrgMember(pool, owner.userId, orgId, grantedMember.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, grantedMember.userId, 'reviewer');

    await addOrgMember(pool, owner.userId, orgId, ungrantedMember.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, ungrantedMember.userId, 'contributor');

    await addOrgMember(pool, owner.userId, orgId, recipient.userId, 'member');
    await addProjectMember(pool, owner.userId, projectId, recipient.userId, 'recipient');

    // Outsider project in separate org
    const outsiderOrgId = await bootstrapOrganisation(pool, outsider.userId, `Outsider Org ${ts}`);
    outsiderProjectId = await createProject(
      pool,
      outsider.userId,
      outsiderOrgId,
      'Outsider Project',
      'Isolated',
      'software_engineering',
      'UTC'
    );
  });

  afterAll(async () => {
    if (owner) await deleteRealTestUser(owner.userId);
    if (grantedMember) await deleteRealTestUser(grantedMember.userId);
    if (ungrantedMember) await deleteRealTestUser(ungrantedMember.userId);
    if (recipient) await deleteRealTestUser(recipient.userId);
    if (outsider) await deleteRealTestUser(outsider.userId);
    await closeDbPool(pool);
  });

  it('Restricted source non-disclosure: ungranted project member cannot read source, chunks, or see in listing', async () => {
    // Owner imports a restricted source granting ONLY grantedMember
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Top Secret Budget Document',
        kind: 'text',
        content: 'Confidential bonus: $50,000 for executive leadership.',
        visibility: 'restricted',
        grantUserIds: [grantedMember.userId],
      });

    expect(importRes.status).toBe(201);
    const restrictedSourceId = importRes.body.data.source.id;

    // 1. Granted member can read source and chunks
    const grantedRes = await request(app)
      .get(`/api/v1/sources/${restrictedSourceId}`)
      .set('Authorization', `Bearer ${grantedMember.accessToken}`);
    expect(grantedRes.status).toBe(200);
    expect(grantedRes.body.data.title).toBe('Top Secret Budget Document');

    const grantedChunksRes = await request(app)
      .get(`/api/v1/sources/${restrictedSourceId}/chunks`)
      .set('Authorization', `Bearer ${grantedMember.accessToken}`);
    expect(grantedChunksRes.status).toBe(200);
    expect(grantedChunksRes.body.data.length).toBe(1);

    // 2. Ungranted member gets 404 (non-disclosure of existence)
    const ungrantedRes = await request(app)
      .get(`/api/v1/sources/${restrictedSourceId}`)
      .set('Authorization', `Bearer ${ungrantedMember.accessToken}`);
    expect(ungrantedRes.status).toBe(404);
    expect(ungrantedRes.body.error.code).toBe('NOT_FOUND');
    expect(ungrantedRes.body.error.message).toBe('Source not found.');

    const ungrantedChunksRes = await request(app)
      .get(`/api/v1/sources/${restrictedSourceId}/chunks`)
      .set('Authorization', `Bearer ${ungrantedMember.accessToken}`);
    expect(ungrantedChunksRes.status).toBe(404);

    // 3. Ungranted member listing excludes restricted source completely
    const listRes = await request(app)
      .get(`/api/v1/projects/${projectId}/sources`)
      .set('Authorization', `Bearer ${ungrantedMember.accessToken}`);
    expect(listRes.status).toBe(200);
    const titles = listRes.body.data.map((s: any) => s.title);
    expect(titles).not.toContain('Top Secret Budget Document');
  });

  it('Guessed or cross-project source ID returns standard 404 (non-enumeration)', async () => {
    // Guessed non-existent UUID
    const randomUuid = '00000000-0000-0000-0000-000000000000';
    const guessedRes = await request(app)
      .get(`/api/v1/sources/${randomUuid}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(guessedRes.status).toBe(404);
    expect(guessedRes.body.error.code).toBe('NOT_FOUND');

    // Outsider importing a source in their own project
    const outsiderImport = await request(app)
      .post(`/api/v1/projects/${outsiderProjectId}/sources/import`)
      .set('Authorization', `Bearer ${outsider.accessToken}`)
      .send({
        title: 'Outsider Private Source',
        kind: 'text',
        content: 'Outsider private data.',
        visibility: 'project',
      });
    const outsiderSourceId = outsiderImport.body.data.source.id;

    // Primary project owner attempting to read outsider's source gets 404 with identical error
    const crossRes = await request(app)
      .get(`/api/v1/sources/${outsiderSourceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(crossRes.status).toBe(404);
    expect(crossRes.body.error).toEqual(guessedRes.body.error);
  });

  it('No outbound network requests for supplied URLs (asserted with spy)', async () => {
    // Spy on node http and https request functions and global fetch
    const httpSpy = vi.spyOn(http, 'request');
    const httpsSpy = vi.spyOn(https, 'request');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const externalUrl = 'https://malicious.phishing.attacker.test/webhook';

    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Untrusted URL Source',
        kind: 'text',
        content: 'Content with an external url.',
        visibility: 'project',
        originalUrl: externalUrl,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.source.originalUrl).toBe(externalUrl);

    // Verify ZERO external outbound network requests were attempted for the originalUrl
    expect(httpsSpy).not.toHaveBeenCalled();

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0]);
      expect(url).not.toContain('malicious.phishing.attacker.test');
    }

    for (const call of httpSpy.mock.calls) {
      const target =
        typeof call[0] === 'string'
          ? call[0]
          : (call[0] as any)?.host || (call[0] as any)?.hostname;
      expect(target).not.toContain('malicious.phishing.attacker.test');
    }

    httpSpy.mockRestore();
    httpsSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  it('Role enforcement: non-owner cannot modify source access or archive sources', async () => {
    // Create source
    const importRes = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Policy Enforcement Test',
        kind: 'text',
        content: 'Test content.',
        visibility: 'project',
      });
    const sourceId = importRes.body.data.source.id;

    // Reviewer (grantedMember) attempts to modify access -> 403 FORBIDDEN
    const patchRes = await request(app)
      .patch(`/api/v1/sources/${sourceId}/access`)
      .set('Authorization', `Bearer ${grantedMember.accessToken}`)
      .send({ visibility: 'restricted', grantUserIds: [] });
    expect(patchRes.status).toBe(403);
    expect(patchRes.body.error.code).toBe('FORBIDDEN');

    // Reviewer attempts to archive source -> 403 FORBIDDEN
    const archiveRes = await request(app)
      .post(`/api/v1/sources/${sourceId}/archive`)
      .set('Authorization', `Bearer ${grantedMember.accessToken}`);
    expect(archiveRes.status).toBe(403);
    expect(archiveRes.body.error.code).toBe('FORBIDDEN');

    // Recipient attempts to import sources -> 403 FORBIDDEN (SPEC 2A.2 line 80)
    const recipientImport = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${recipient.accessToken}`)
      .send({
        title: 'Recipient Import Attempt',
        kind: 'text',
        content: 'Should be rejected.',
        visibility: 'project',
      });
    expect(recipientImport.status).toBe(403);
    expect(recipientImport.body.error.code).toBe('FORBIDDEN');
  });

  it('HTML/script injection resistance: hostile payload preserved as inert text', async () => {
    const maliciousScript = '<script>alert("XSS Attack!");</script>';
    const res = await request(app)
      .post(`/api/v1/projects/${projectId}/sources/import`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        title: 'Script Injection Test',
        kind: 'text',
        content: maliciousScript,
        visibility: 'project',
      });

    expect(res.status).toBe(201);
    const sourceId = res.body.data.source.id;

    const getRes = await request(app)
      .get(`/api/v1/sources/${sourceId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(getRes.status).toBe(200);
    expect(getRes.body.data.content).toBe(maliciousScript);
  });
});
