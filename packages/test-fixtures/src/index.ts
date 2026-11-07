import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createUserClient } from '@relay/database';
import type { ServerEnvironment, WebEnvironment } from '@relay/contracts';

// Try loading root .env if environment variables are not already set
function loadEnvIfNeeded() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    let dir = process.cwd();
    for (let i = 0; i < 5; i++) {
      const candidate = path.join(dir, '.env');
      if (fs.existsSync(candidate)) {
        dotenv.config({ path: candidate });
        break;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
}

loadEnvIfNeeded();

export const mockDevServerEnv: ServerEnvironment = {
  NODE_ENV: 'development',
  PORT: 4000,
  APP_ORIGIN: 'http://localhost:5173',
  CORS_ALLOWED_ORIGINS: ['http://localhost:5173'],
  SUPABASE_URL: process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || 'test-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key',
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres',
  GEMINI_API_KEY: 'test-gemini-key',
  GEMINI_MODEL: 'gemini-2.5-flash',
  AI_PROVIDER: 'gemini',
  AI_TIMEOUT_MS: 45000,
  AI_MAX_INPUT_TOKENS: 24000,
  AI_MAX_OUTPUT_TOKENS: 6000,
  AI_PROJECT_DAILY_TOKEN_BUDGET: 500000,
  AI_MAX_CONCURRENT_CALLS: 2,
  UPLOAD_MAX_BYTES: 5242880,
  UPLOAD_MAX_FILES: 10,
  IMPORT_MAX_TOTAL_CHARACTERS: 2000000,
  IMPORT_MAX_RECORD_CHARACTERS: 100000,
  IMPORT_MAX_JSON_RECORDS: 10000,
  CHUNK_MAX_CHARACTERS: 1500,
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX_REQUESTS: 120,
  AI_RATE_LIMIT_PER_USER_PER_HOUR: 20,
  WORKER_POLL_INTERVAL_MS: 1500,
  WORKER_CONCURRENCY: 2,
  JOB_MAX_ATTEMPTS: 3,
  JOB_LEASE_SECONDS: 120,
  JOB_HEARTBEAT_SECONDS: 30,
  JOB_RETRY_BASE_SECONDS: 5,
  LOG_LEVEL: 'silent',
  DEMO_MODE: false,
};

export const mockProdServerEnv: ServerEnvironment = {
  ...mockDevServerEnv,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://relay.example.com',
  CORS_ALLOWED_ORIGINS: ['https://relay.example.com'],
  SUPABASE_URL: 'https://xyz.supabase.co',
  DATABASE_URL: 'postgresql://postgres:secret@db.example.com:5432/postgres',
};

export const mockWebEnv: WebEnvironment = {
  VITE_API_BASE_URL: 'http://localhost:4000/api/v1',
  VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
  VITE_SUPABASE_ANON_KEY: 'test-anon-key',
  VITE_DEMO_MODE: false,
};

// ─── Real Supabase Auth Helpers for Integration & Security Tests ─────────────

export interface TestUser {
  userId: string;
  email: string;
  password: string;
  displayName: string;
  accessToken: string;
  client: SupabaseClient;
}

export function getTestSupabaseConfig() {
  loadEnvIfNeeded();
  const url = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const anonKey = process.env.SUPABASE_ANON_KEY || '';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const databaseUrl =
    process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
  return { url, anonKey, serviceRoleKey, databaseUrl };
}

export function createAdminClient(): SupabaseClient {
  const { url, serviceRoleKey } = getTestSupabaseConfig();
  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function createAnonClient(): SupabaseClient {
  const { url, anonKey } = getTestSupabaseConfig();
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Creates a real Supabase Auth user through the admin API with confirmed email,
 * signs in via the anon client to obtain a real access token, and returns a user-scoped client.
 * Never uses fake tokens.
 */
export async function createRealTestUser(
  email: string,
  password = 'TestPassword123!',
  displayName = 'Test User'
): Promise<TestUser> {
  const adminClient = createAdminClient();
  const anonClient = createAnonClient();
  const { url, anonKey } = getTestSupabaseConfig();

  // Try to create the user via admin API
  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  let userId: string;
  if (createError) {
    // If user already exists, sign in directly
    if (
      createError.message.includes('already registered') ||
      createError.message.includes('unique')
    ) {
      const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError || !signInData.session) {
        throw new Error(`Failed to sign in existing test user ${email}: ${signInError?.message}`);
      }
      userId = signInData.user.id;
      const accessToken = signInData.session.access_token;
      const client = createUserClient(url, anonKey, accessToken);
      return { userId, email, password, displayName, accessToken, client };
    }
    throw new Error(`Failed to create test user ${email}: ${createError.message}`);
  }

  userId = created.user.id;

  // Sign in with the credentials to get a real access token
  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError || !signInData.session) {
    throw new Error(`Failed to sign in created test user ${email}: ${signInError?.message}`);
  }

  const accessToken = signInData.session.access_token;
  const client = createUserClient(url, anonKey, accessToken);

  return {
    userId,
    email,
    password,
    displayName,
    accessToken,
    client,
  };
}

/**
 * Deletes a test user using the admin API.
 */
export async function deleteRealTestUser(userId: string): Promise<void> {
  const adminClient = createAdminClient();
  await adminClient.auth.admin.deleteUser(userId);
}
