import { describe, it, expect } from 'vitest';
import { serverEnvironmentSchema, webEnvironmentSchema } from '../src/env.js';

describe('serverEnvironmentSchema', () => {
  const baseValidDev = {
    NODE_ENV: 'development',
    PORT: '4000',
    APP_ORIGIN: 'http://localhost:5173',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  };

  const baseValidProd = {
    NODE_ENV: 'production',
    PORT: '4000',
    APP_ORIGIN: 'https://relay.example.com',
    CORS_ALLOWED_ORIGINS: 'https://relay.example.com,https://app.relay.example.com',
    SUPABASE_URL: 'https://xyz.supabase.co',
    SUPABASE_ANON_KEY: 'valid-anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'valid-service-role-key',
    DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
    GEMINI_API_KEY: 'test-gemini-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
    AI_PROVIDER: 'gemini',
    DEMO_MODE: 'false',
  };

  it('accepts a valid development environment with defaults', () => {
    const result = serverEnvironmentSchema.safeParse(baseValidDev);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.PORT).toBe(4000);
    expect(result.data.AI_PROVIDER).toBe('gemini');
    expect(result.data.DEMO_MODE).toBe(false);
    expect(result.data.CORS_ALLOWED_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('accepts a valid production environment', () => {
    const result = serverEnvironmentSchema.safeParse(baseValidProd);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.NODE_ENV).toBe('production');
    expect(result.data.CORS_ALLOWED_ORIGINS).toEqual([
      'https://relay.example.com',
      'https://app.relay.example.com',
    ]);
  });

  it('rejects missing production credentials', () => {
    const missingKeys = [
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'SUPABASE_SERVICE_ROLE_KEY',
      'DATABASE_URL',
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
    ] as const;

    for (const key of missingKeys) {
      const invalid = { ...baseValidProd };
      delete invalid[key];
      const result = serverEnvironmentSchema.safeParse(invalid);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes(key))).toBe(true);
      }
    }
  });

  it('rejects fake AI provider in production', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidProd,
      AI_PROVIDER: 'fake',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('AI_PROVIDER'))).toBe(true);
    }
  });

  it('rejects DEMO_MODE=true in production', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidProd,
      DEMO_MODE: 'true',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('DEMO_MODE'))).toBe(true);
    }
  });

  it('rejects http APP_ORIGIN in production', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidProd,
      APP_ORIGIN: 'http://insecure.example.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('APP_ORIGIN'))).toBe(true);
    }
  });

  it('rejects http CORS_ALLOWED_ORIGINS in production', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidProd,
      CORS_ALLOWED_ORIGINS: 'https://safe.example.com,http://insecure.example.com',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('CORS_ALLOWED_ORIGINS'))).toBe(true);
    }
  });

  it('allows fake AI provider when NODE_ENV is test', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidDev,
      NODE_ENV: 'test',
      AI_PROVIDER: 'fake',
    });
    expect(result.success).toBe(true);
  });

  it('allows fake AI provider when DEMO_MODE is true in development', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidDev,
      NODE_ENV: 'development',
      AI_PROVIDER: 'fake',
      DEMO_MODE: 'true',
    });
    expect(result.success).toBe(true);
  });

  it('rejects fake AI provider in development when DEMO_MODE is false', () => {
    const result = serverEnvironmentSchema.safeParse({
      ...baseValidDev,
      NODE_ENV: 'development',
      AI_PROVIDER: 'fake',
      DEMO_MODE: 'false',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('AI_PROVIDER'))).toBe(true);
    }
  });

  it('enforces numeric ranges for ports and limits', () => {
    expect(serverEnvironmentSchema.safeParse({ ...baseValidDev, PORT: '0' }).success).toBe(false);
    expect(serverEnvironmentSchema.safeParse({ ...baseValidDev, PORT: '70000' }).success).toBe(
      false
    );
    expect(
      serverEnvironmentSchema.safeParse({ ...baseValidDev, UPLOAD_MAX_BYTES: '500' }).success
    ).toBe(false);
    expect(
      serverEnvironmentSchema.safeParse({ ...baseValidDev, WORKER_CONCURRENCY: '0' }).success
    ).toBe(false);
    expect(
      serverEnvironmentSchema.safeParse({ ...baseValidDev, JOB_MAX_ATTEMPTS: '0' }).success
    ).toBe(false);
  });
});

describe('webEnvironmentSchema', () => {
  it('parses valid web environment with defaults', () => {
    const result = webEnvironmentSchema.safeParse({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.VITE_API_BASE_URL).toBe('http://localhost:4000/api/v1');
    expect(result.data.VITE_DEMO_MODE).toBe(false);
  });

  it('parses explicit web environment values', () => {
    const result = webEnvironmentSchema.safeParse({
      VITE_API_BASE_URL: 'https://api.example.com/api/v1',
      VITE_SUPABASE_URL: 'https://xyz.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_DEMO_MODE: 'true',
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.VITE_DEMO_MODE).toBe(true);
  });

  it('rejects malformed URL', () => {
    const result = webEnvironmentSchema.safeParse({
      VITE_API_BASE_URL: 'not-a-url',
    });
    expect(result.success).toBe(false);
  });
});
