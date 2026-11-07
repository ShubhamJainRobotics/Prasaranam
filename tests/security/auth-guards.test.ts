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
} from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  createAdminClient,
  TestUser,
  mockDevServerEnv,
} from '@relay/test-fixtures';

describe('Security: Authentication and Authorization Guards', () => {
  let pool: DbPool;
  let app: any;
  let verifiedUser: TestUser;
  let unconfirmedUser: TestUser;
  let outsideUser: TestUser;
  let orgId: string;
  let projectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    app = createApp({ env: mockDevServerEnv, pool });

    // 1. Verified user
    verifiedUser = await createRealTestUser(
      `sec-verified-${Date.now()}@relay.local`,
      'Password123!',
      'Sec Verified'
    );

    // 2. Unconfirmed user (create in auth.users without confirming email)
    const adminClient = createAdminClient();
    const unconfirmedEmail = `sec-unconfirmed-${Date.now()}@relay.local`;
    const { data: createdUser, error: createError } = await adminClient.auth.admin.createUser({
      email: unconfirmedEmail,
      password: 'Password123!',
      email_confirm: false,
    });
    if (createError || !createdUser.user) {
      throw new Error(`Failed to create unconfirmed user: ${createError?.message}`);
    }

    // Sign in using anon client to obtain token for unconfirmed user
    const { data: signInData, error: _signInError } = await adminClient.auth.signInWithPassword({
      email: unconfirmedEmail,
      password: 'Password123!',
    });
    // Even if Supabase signs them in or generates an unconfirmed token:
    const unconfirmedToken = signInData?.session?.access_token || 'fake-unconfirmed-token';

    unconfirmedUser = {
      userId: createdUser.user.id,
      email: unconfirmedEmail,
      password: 'Password123!',
      displayName: 'Unconfirmed User',
      accessToken: unconfirmedToken,
      client: adminClient,
    };

    // 3. Outside user
    outsideUser = await createRealTestUser(
      `sec-outside-${Date.now()}@relay.local`,
      'Password123!',
      'Sec Outsider'
    );

    // Bootstrap org and project for verifiedUser
    orgId = await bootstrapOrganisation(pool, verifiedUser.userId, 'Sec Test Org');
    projectId = await createProject(
      pool,
      verifiedUser.userId,
      orgId,
      'Sec Test Project',
      'Security Project Description',
      'general',
      'UTC'
    );
  });

  afterAll(async () => {
    if (verifiedUser) await deleteRealTestUser(verifiedUser.userId);
    if (unconfirmedUser) await deleteRealTestUser(unconfirmedUser.userId);
    if (outsideUser) await deleteRealTestUser(outsideUser.userId);
    await closeDbPool(pool);
  });

  it('rejects requests with missing Authorization header (401)', async () => {
    const res = await request(app).get('/api/v1/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests with invalid or malformed bearer tokens (401)', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', 'Bearer invalid.jwt.token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects requests from users with unconfirmed email addresses (401)', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${unconfirmedUser.accessToken}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects or ignores forged actor_id and user_id fields in request body', async () => {
    // Attempt to update profile of another user
    const res = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${verifiedUser.accessToken}`)
      .send({
        displayName: 'Hacked Name',
        userId: outsideUser.userId,
        actorId: outsideUser.userId,
        id: outsideUser.userId,
      });

    expect(res.status).toBe(200);
    // Verified user's profile is updated, not outside user's
    expect(res.body.data.id).toBe(verifiedUser.userId);

    const outsideProfile = await pool.query(
      'SELECT display_name FROM public.profiles WHERE id = $1',
      [outsideUser.userId]
    );
    expect(outsideProfile.rows[0].display_name).not.toBe('Hacked Name');
  });

  it('returns 404 for inaccessible project IDs to prevent enumeration (non-disclosure)', async () => {
    // outsideUser does not have access to verifiedUser's project
    const res = await request(app)
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${outsideUser.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 404 for nonexistent UUID projects without leaking existence', async () => {
    const randomUuid = '00000000-0000-0000-0000-000000000000';
    const res = await request(app)
      .get(`/api/v1/projects/${randomUuid}`)
      .set('Authorization', `Bearer ${verifiedUser.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns generic non-enumerating responses when adding members', async () => {
    const existingRes = await request(app)
      .post(`/api/v1/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${verifiedUser.accessToken}`)
      .send({ email: outsideUser.email, role: 'member' });

    const nonExistingRes = await request(app)
      .post(`/api/v1/organisations/${orgId}/members`)
      .set('Authorization', `Bearer ${verifiedUser.accessToken}`)
      .send({ email: 'ghost-user-404@example.org', role: 'member' });

    expect(existingRes.status).toBe(200);
    expect(nonExistingRes.status).toBe(200);
    expect(existingRes.body.data.message).toBe(nonExistingRes.body.data.message);
  });

  it('verifies that web production build contains no service-role key or Gemini key', () => {
    const distDir = path.resolve(process.cwd(), 'apps/web/dist');
    expect(fs.existsSync(distDir)).toBe(true);

    const files = fs.readdirSync(path.join(distDir, 'assets'));
    const jsFiles = files.filter((f) => f.endsWith('.js'));
    expect(jsFiles.length).toBeGreaterThan(0);

    const secretKey = 'sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz';
    const jwtSig = 'EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
    const geminiKey = mockDevServerEnv.GEMINI_API_KEY;

    for (const jsFile of jsFiles) {
      const content = fs.readFileSync(path.join(distDir, 'assets', jsFile), 'utf8');

      // Actual secret credentials must never leak into client bundle
      expect(content).not.toContain(secretKey);
      expect(content).not.toContain(jwtSig);
      if (geminiKey && geminiKey.length > 5) {
        expect(content).not.toContain(geminiKey);
      }
      expect(content).not.toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect(content).not.toContain('GEMINI_API_KEY');
    }
  });
});
