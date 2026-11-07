import { describe, it, expect } from 'vitest';
import { serverEnvironmentSchema } from '../../packages/contracts/src/env.js';
import { mockProdServerEnv, mockDevServerEnv } from '../../packages/test-fixtures/src/index.js';

describe('Security Invariants: Environment Guards', () => {
  it('Requirement 27: Fake AI provider rejected in production', () => {
    const invalidProd = {
      ...mockProdServerEnv,
      AI_PROVIDER: 'fake',
    };
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages.some((m) => m.includes('AI_PROVIDER must be "gemini" in production'))).toBe(
        true
      );
    }
  });

  it('Section 2A.12 Item 5: Fake AI rejected in development when DEMO_MODE=false', () => {
    const invalidDev = {
      ...mockDevServerEnv,
      NODE_ENV: 'development',
      AI_PROVIDER: 'fake',
      DEMO_MODE: false,
    };
    const result = serverEnvironmentSchema.safeParse(invalidDev);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(
        messages.some((m) =>
          m.includes('Fake AI provider is permitted only when NODE_ENV=test or when DEMO_MODE=true')
        )
      ).toBe(true);
    }
  });

  it('Production invariant: Missing SUPABASE_SERVICE_ROLE_KEY rejected', () => {
    const invalidProd = { ...mockProdServerEnv };
    delete (invalidProd as any).SUPABASE_SERVICE_ROLE_KEY;
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('SUPABASE_SERVICE_ROLE_KEY'))).toBe(
        true
      );
    }
  });

  it('Production invariant: Missing DATABASE_URL rejected', () => {
    const invalidProd = { ...mockProdServerEnv };
    delete (invalidProd as any).DATABASE_URL;
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('DATABASE_URL'))).toBe(true);
    }
  });

  it('Production invariant: Missing GEMINI_API_KEY rejected', () => {
    const invalidProd = { ...mockProdServerEnv };
    delete (invalidProd as any).GEMINI_API_KEY;
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('GEMINI_API_KEY'))).toBe(true);
    }
  });

  it('Production invariant: DEMO_MODE=true rejected', () => {
    const invalidProd = {
      ...mockProdServerEnv,
      DEMO_MODE: true,
    };
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('DEMO_MODE'))).toBe(true);
    }
  });

  it('Production invariant: Insecure http APP_ORIGIN rejected', () => {
    const invalidProd = {
      ...mockProdServerEnv,
      APP_ORIGIN: 'http://relay.example.com',
    };
    const result = serverEnvironmentSchema.safeParse(invalidProd);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes('APP_ORIGIN'))).toBe(true);
    }
  });
});
