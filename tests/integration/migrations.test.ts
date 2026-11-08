import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDbPool, closeDbPool, DbPool } from '@relay/database';
import { getTestSupabaseConfig } from '@relay/test-fixtures';

describe('Database Migrations and Schema', () => {
  let pool: DbPool;

  beforeAll(() => {
    const config = getTestSupabaseConfig();
    pool = createDbPool(config.databaseUrl);
  });

  afterAll(async () => {
    await closeDbPool(pool);
  });

  it('records all migrations in schema_migrations', async () => {
    const res = await pool.query(
      'SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version ASC;'
    );
    expect(res.rows.length).toBe(24);
    const names = res.rows.map((r) => r.name);
    expect(names).toContain('baseline_schema');
    expect(names).toContain('app_private_schema');
    expect(names).toContain('access_helpers');
    expect(names).toContain('table_grants');
    expect(names).toContain('rls_policies');
    expect(names).toContain('triggers_timestamps');
    expect(names).toContain('triggers_quote_validation');
    expect(names).toContain('triggers_chunk_validation');
    expect(names).toContain('triggers_review_item_consistency');
    expect(names).toContain('triggers_immutability');
    expect(names).toContain('triggers_epoch_invalidation');
    expect(names).toContain('triggers_symmetric_relations');
    expect(names).toContain('trigger_auth_profile');
    expect(names).toContain('mutation_functions');
    expect(names).toContain('trigger_active_org_membership');
    expect(names).toContain('last_owner_protection');
    expect(names).toContain('source_ingestion_functions');
    expect(names).toContain('fix_source_ingestion_audit_calls');
    expect(names).toContain('phase5_ai_persistence_and_mutations');
    expect(names).toContain('lease_job_requested_by');
    expect(names).toContain('fix_flag_claim_project_id');
    expect(names).toContain('phase6_handover_workflow');
    expect(names).toContain('phase7_qa_and_conversations');
  });

  it('creates all expected public application tables', async () => {
    const res = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    const tables = res.rows.map((r) => r.table_name);
    const expected = [
      'organisations',
      'organisation_members',
      'projects',
      'project_members',
      'sources',
      'source_grants',
      'source_chunks',
      'claims',
      'claim_evidence',
      'claim_relationships',
      'clarification_questions',
      'question_claims',
      'handovers',
      'handover_items',
      'handover_item_claims',
      'reviews',
      'jobs',
      'conversations',
      'conversation_messages',
      'audit_events',
      'profiles',
      'claim_flags',
      'ai_usage',
    ];
    for (const t of expected) {
      expect(tables).toContain(t);
    }
  });

  it('has RLS enabled on all public application tables', async () => {
    const res = await pool.query(`
      SELECT relname, relrowsecurity
      FROM pg_class
      JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
      WHERE pg_namespace.nspname = 'public'
        AND relkind = 'r'
        AND relname != 'schema_migrations';
    `);
    for (const row of res.rows) {
      expect(row.relrowsecurity).toBe(true);
    }
  });

  it('defines app_private schema with access helpers and mutation functions', async () => {
    const res = await pool.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'app_private'
      ORDER BY routine_name;
    `);
    const routines = res.rows.map((r) => r.routine_name);
    const expectedHelpers = [
      'is_org_member',
      'is_org_admin',
      'is_project_member',
      'has_project_role',
      'can_read_source',
      'can_read_claim',
      'can_read_question',
      'can_read_handover',
      'can_read_handover_item',
    ];
    const expectedMutations = [
      'bootstrap_organisation',
      'create_project',
      'add_org_member',
      'update_org_member',
      'add_project_member',
      'update_project_member',
      'enqueue_job',
      'lease_job',
      'heartbeat_job',
      'complete_job',
      'fail_job',
      'requeue_expired_jobs',
      'request_cancel_job',
      'create_handover_draft_from_generation',
      'update_item',
      'add_item_from_claims',
      'attach_claims',
      'flag_item',
      'add_reviewer_context',
      'create_revision',
      'approve_handover',
      'share_handover',
    ];

    for (const h of expectedHelpers) {
      expect(routines).toContain(h);
    }
    for (const m of expectedMutations) {
      expect(routines).toContain(m);
    }
  });
});
