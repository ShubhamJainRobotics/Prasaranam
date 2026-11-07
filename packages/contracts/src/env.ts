import { z } from 'zod';
import { AiProviderSchema } from './enums.js';

const booleanCoerce = z.union([z.boolean(), z.string()]).transform((val) => {
  if (typeof val === 'boolean') return val;
  return val.toLowerCase() === 'true' || val === '1';
});

export const serverEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_ORIGIN: z.string().default('http://localhost:5173'),
    CORS_ALLOWED_ORIGINS: z
      .union([z.string(), z.array(z.string())])
      .transform((val) => {
        if (Array.isArray(val)) return val;
        return val
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      })
      .default('http://localhost:5173'),

    SUPABASE_URL: z.string().optional(),
    SUPABASE_ANON_KEY: z.string().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
    DATABASE_URL: z.string().optional(),

    GEMINI_API_KEY: z.string().optional(),
    GEMINI_MODEL: z.string().optional(),
    AI_PROVIDER: AiProviderSchema.default('gemini'),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(45000),
    AI_MAX_INPUT_TOKENS: z.coerce.number().int().min(100).max(1000000).default(24000),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(10).max(100000).default(6000),
    AI_PROJECT_DAILY_TOKEN_BUDGET: z.coerce.number().int().min(1000).default(500000),
    AI_MAX_CONCURRENT_CALLS: z.coerce.number().int().min(1).max(100).default(2),

    UPLOAD_MAX_BYTES: z.coerce.number().int().min(1024).max(52428800).default(5242880),
    UPLOAD_MAX_FILES: z.coerce.number().int().min(1).max(50).default(10),
    IMPORT_MAX_TOTAL_CHARACTERS: z.coerce.number().int().min(1000).default(2000000),
    IMPORT_MAX_RECORD_CHARACTERS: z.coerce.number().int().min(100).default(100000),
    IMPORT_MAX_JSON_RECORDS: z.coerce.number().int().min(1).default(10000),
    CHUNK_MAX_CHARACTERS: z.coerce.number().int().min(100).max(10000).default(1500),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(120),
    AI_RATE_LIMIT_PER_USER_PER_HOUR: z.coerce.number().int().min(1).default(20),

    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1500),
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
    JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
    JOB_LEASE_SECONDS: z.coerce.number().int().min(10).max(3600).default(120),
    JOB_HEARTBEAT_SECONDS: z.coerce.number().int().min(5).max(300).default(30),
    JOB_RETRY_BASE_SECONDS: z.coerce.number().int().min(1).max(60).default(5),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DEMO_MODE: booleanCoerce.default(false),
  })
  .superRefine((data, ctx) => {
    // 1. APP_ORIGIN validation
    try {
      const appUrl = new URL(data.APP_ORIGIN);
      if (data.NODE_ENV === 'production' && appUrl.protocol !== 'https:') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['APP_ORIGIN'],
          message: 'APP_ORIGIN must use https in production',
        });
      }
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['APP_ORIGIN'],
        message: 'APP_ORIGIN must be a valid URL',
      });
    }

    // 2. CORS_ALLOWED_ORIGINS validation
    for (let i = 0; i < data.CORS_ALLOWED_ORIGINS.length; i++) {
      const origin = data.CORS_ALLOWED_ORIGINS[i];
      if (!origin) continue;
      try {
        const corsUrl = new URL(origin);
        if (data.NODE_ENV === 'production' && corsUrl.protocol !== 'https:') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['CORS_ALLOWED_ORIGINS', i],
            message: `CORS origin "${origin}" must use https in production`,
          });
        }
      } catch {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['CORS_ALLOWED_ORIGINS', i],
          message: `CORS origin "${origin}" must be a valid URL`,
        });
      }
    }

    // 3. Production mandatory secrets and settings
    if (data.NODE_ENV === 'production') {
      if (!data.SUPABASE_URL || !data.SUPABASE_URL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_URL'],
          message: 'SUPABASE_URL is required in production',
        });
      } else {
        try {
          new URL(data.SUPABASE_URL);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['SUPABASE_URL'],
            message: 'SUPABASE_URL must be a valid URL',
          });
        }
      }

      if (!data.SUPABASE_ANON_KEY || !data.SUPABASE_ANON_KEY.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_ANON_KEY'],
          message: 'SUPABASE_ANON_KEY is required in production',
        });
      }

      if (!data.SUPABASE_SERVICE_ROLE_KEY || !data.SUPABASE_SERVICE_ROLE_KEY.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['SUPABASE_SERVICE_ROLE_KEY'],
          message: 'SUPABASE_SERVICE_ROLE_KEY is required in production',
        });
      }

      if (!data.DATABASE_URL || !data.DATABASE_URL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DATABASE_URL'],
          message: 'DATABASE_URL is required in production',
        });
      }

      if (!data.GEMINI_API_KEY || !data.GEMINI_API_KEY.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GEMINI_API_KEY'],
          message: 'GEMINI_API_KEY is required in production',
        });
      }

      if (!data.GEMINI_MODEL || !data.GEMINI_MODEL.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['GEMINI_MODEL'],
          message: 'GEMINI_MODEL is required in production',
        });
      }

      if (data.AI_PROVIDER !== 'gemini') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_PROVIDER'],
          message: 'AI_PROVIDER must be "gemini" in production',
        });
      }

      if (data.DEMO_MODE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEMO_MODE'],
          message: 'DEMO_MODE must be false in production',
        });
      }
    }

    // 4. Fake AI provider restriction (Section 2A.12 Item 5)
    // The fake provider is deterministic, labelled fake-deterministic, and allowed only
    // when NODE_ENV=test, or when DEMO_MODE=true and NODE_ENV is not production.
    if (data.AI_PROVIDER === 'fake') {
      const allowed =
        data.NODE_ENV === 'test' || (data.DEMO_MODE && data.NODE_ENV !== 'production');
      if (!allowed) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['AI_PROVIDER'],
          message:
            'Fake AI provider is permitted only when NODE_ENV=test or when DEMO_MODE=true in non-production environments',
        });
      }
    }
  });

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export const webEnvironmentSchema = z.object({
  VITE_API_BASE_URL: z.string().url().default('http://localhost:4000/api/v1'),
  VITE_SUPABASE_URL: z.string().url().optional(),
  VITE_SUPABASE_ANON_KEY: z.string().optional(),
  VITE_DEMO_MODE: booleanCoerce.optional().default(false),
});

export type WebEnvironment = z.infer<typeof webEnvironmentSchema>;
