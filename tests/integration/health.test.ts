import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../../apps/api/src/app.js';
import { mockDevServerEnv } from '../../packages/test-fixtures/src/index.js';

describe('API Integration: Health and Core Middleware', () => {
  it('GET /health/live returns 200 with process status', async () => {
    const app = createApp({ env: mockDevServerEnv });
    const res = await request(app).get('/health/live');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /health/ready returns 503 when pool is unconfigured', async () => {
    const app = createApp({ env: mockDevServerEnv });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.message).toContain('Database connection pool not configured');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('GET /health/ready returns 200 when database query succeeds', async () => {
    const mockPool = {
      connect: async () => ({
        query: async () => ({ rows: [{ '?column?': 1 }] }),
        release: () => {},
      }),
    } as any;

    const app = createApp({ env: mockDevServerEnv, pool: mockPool });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  it('GET /health/ready returns 503 without leaking connection strings when database fails', async () => {
    const secretConnectionString =
      'postgresql://postgres:ultra-secret-password@db.example.com:5432/db';
    const mockPool = {
      connect: async () => {
        throw new Error(`Connection to ${secretConnectionString} failed`);
      },
    } as any;

    const app = createApp({ env: mockDevServerEnv, pool: mockPool });
    const res = await request(app).get('/health/ready');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.message).toBe('Database readiness check failed');
    // Invariant: Never leak secrets or connection strings
    const responseString = JSON.stringify(res.body);
    expect(responseString).not.toContain('ultra-secret-password');
    expect(responseString).not.toContain('postgresql://');
  });

  it('returns 404 in standard ErrorEnvelope for unknown routes', async () => {
    const app = createApp({ env: mockDevServerEnv });
    const res = await request(app).get('/non-existent-endpoint');

    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.requestId).toBeDefined();
  });

  it('sets security headers via Helmet', async () => {
    const app = createApp({ env: mockDevServerEnv });
    const res = await request(app).get('/health/live');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
  });
});
