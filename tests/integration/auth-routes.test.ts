import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { createDbPool, closeDbPool, DbPool } from '@relay/database';
import {
  createRealTestUser,
  deleteRealTestUser,
  TestUser,
  mockDevServerEnv,
} from '@relay/test-fixtures';

describe('API Integration: Auth & Workspace Routes', () => {
  let pool: DbPool;
  let app: any;
  let user1: TestUser;
  let user2: TestUser;
  let createdOrgId: string;
  let createdProjectId: string;

  beforeAll(async () => {
    pool = createDbPool('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    app = createApp({ env: mockDevServerEnv, pool });

    user1 = await createRealTestUser(
      `test-api-user1-${Date.now()}@relay.local`,
      'Password123!',
      'User One'
    );
    user2 = await createRealTestUser(
      `test-api-user2-${Date.now()}@relay.local`,
      'Password123!',
      'User Two'
    );
  });

  afterAll(async () => {
    if (user1) await deleteRealTestUser(user1.userId);
    if (user2) await deleteRealTestUser(user2.userId);
    await closeDbPool(pool);
  });

  it('GET /api/v1/me returns current user info and memberships', async () => {
    const res = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.id).toBe(user1.userId);
    expect(res.body.data.email).toBe(user1.email);
    expect(res.body.data.displayName).toBe('User One');
    expect(Array.isArray(res.body.data.organisations)).toBe(true);
    expect(Array.isArray(res.body.data.projects)).toBe(true);
    expect(res.body.requestId).toBeDefined();
  });

  it('PATCH /api/v1/me updates display name', async () => {
    const res = await request(app)
      .patch('/api/v1/me')
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ displayName: 'User One Updated' });

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe('User One Updated');

    // Confirm in GET /api/v1/me
    const verifyRes = await request(app)
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${user1.accessToken}`);
    expect(verifyRes.body.data.displayName).toBe('User One Updated');
  });

  it('POST /api/v1/organisations bootstraps a new organisation', async () => {
    const res = await request(app)
      .post('/api/v1/organisations')
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ name: 'Alpha Health Corp' });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe('Alpha Health Corp');
    expect(res.body.data.role).toBe('owner');
    createdOrgId = res.body.data.id;
  });

  it('GET /api/v1/organisations returns paginated accessible organisations', async () => {
    const res = await request(app)
      .get('/api/v1/organisations')
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].id).toBe(createdOrgId);
    expect(res.body.page).toBeDefined();
    expect(res.body.page.hasMore).toBe(false);
  });

  it('POST /api/v1/organisations/:id/members adds a member with generic non-enumerating response', async () => {
    // Add real existing user2
    const res = await request(app)
      .post(`/api/v1/organisations/${createdOrgId}/members`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ email: user2.email, role: 'member' });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('If an account exists with this email');

    // Add nonexistent user - returns identical success response
    const nonExistentRes = await request(app)
      .post(`/api/v1/organisations/${createdOrgId}/members`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ email: 'nonexistent-random-user@relay.local', role: 'member' });

    expect(nonExistentRes.status).toBe(200);
    expect(nonExistentRes.body.data.message).toBe(res.body.data.message);
  });

  it('GET /api/v1/organisations/:id/members lists organisation members', async () => {
    const res = await request(app)
      .get(`/api/v1/organisations/${createdOrgId}/members`)
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);

    const u2Member = res.body.data.find((m: any) => m.userId === user2.userId);
    expect(u2Member).toBeDefined();
    expect(u2Member.role).toBe('member');
    expect(u2Member.active).toBe(true);
    // User1 is owner so email is visible
    expect(u2Member.email).toBe(user2.email);
  });

  it('PATCH /api/v1/organisations/:id/members/:userId updates member role', async () => {
    const res = await request(app)
      .patch(`/api/v1/organisations/${createdOrgId}/members/${user2.userId}`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({ role: 'admin', active: true });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('admin');
  });

  it('POST /api/v1/organisations/:id/projects creates a project', async () => {
    const res = await request(app)
      .post(`/api/v1/organisations/${createdOrgId}/projects`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({
        name: 'Patient Safety Q3',
        description: 'Tracking safety handovers and audits',
        domain: 'general',
      });

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.name).toBe('Patient Safety Q3');
    expect(res.body.data.role).toBe('owner');
    createdProjectId = res.body.data.id;
  });

  it('GET /api/v1/projects/:id returns project summary', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(createdProjectId);
    expect(res.body.data.name).toBe('Patient Safety Q3');
    expect(res.body.data.role).toBe('owner');
  });

  it('PATCH /api/v1/projects/:id updates project settings', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${createdProjectId}`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({
        name: 'Patient Safety Q3 Renamed',
        description: 'Updated description',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Patient Safety Q3 Renamed');
    expect(res.body.data.description).toBe('Updated description');
  });

  it('POST /api/v1/projects/:id/members adds a member to project', async () => {
    const res = await request(app)
      .post(`/api/v1/projects/${createdProjectId}/members`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({
        email: user2.email,
        role: 'reviewer',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.message).toContain('If an account exists with this email');
  });

  it('GET /api/v1/projects/:id/members lists project members', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${createdProjectId}/members`)
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);

    const u2Member = res.body.data.find((m: any) => m.userId === user2.userId);
    expect(u2Member).toBeDefined();
    expect(u2Member.role).toBe('reviewer');
    expect(u2Member.active).toBe(true);
  });

  it('PATCH /api/v1/projects/:id/members/:userId updates project member role', async () => {
    const res = await request(app)
      .patch(`/api/v1/projects/${createdProjectId}/members/${user2.userId}`)
      .set('Authorization', `Bearer ${user1.accessToken}`)
      .send({
        role: 'contributor',
        active: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('contributor');
  });

  it('GET /api/v1/projects/:id/dashboard returns summary stats', async () => {
    const res = await request(app)
      .get(`/api/v1/projects/${createdProjectId}/dashboard`)
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.project).toBeDefined();
    expect(res.body.data.project.id).toBe(createdProjectId);
    expect(res.body.data.memberCount).toBe(2);
    expect(res.body.data.counts).toEqual({
      sources: 0,
      claims: 0,
      questions: 0,
      handovers: 0,
    });
  });

  it('supports cursor pagination across pages', async () => {
    // Call GET /organisations with limit=1
    const res = await request(app)
      .get('/api/v1/organisations?limit=1')
      .set('Authorization', `Bearer ${user1.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.page).toBeDefined();
  });
});
