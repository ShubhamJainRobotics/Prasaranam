# Phase 2 Report: Database and Authorisation

## 1. Implemented

- **Supabase Migrations**: Created and applied 17 versioned migrations with unique timestamp prefixes covering the complete PostgreSQL 17 relational foundation from Section 10 and all 22 migration-level safeguards:
  - `20261107100001_baseline_schema.sql`: Core schema defining all 18 tables, pgcrypto, check constraints, foreign keys, and indexes.
  - `20261107100002_app_private_schema.sql`: Hardened `app_private` schema with usage granted to `authenticated` for RLS helper evaluation; default privileges locked down so future objects are never world-accessible.
  - `20261107100003_access_helpers.sql`: All 9 SQL access helpers in `app_private` (`is_org_member`, `is_org_admin`, `is_project_member`, `has_project_role`, `can_read_source`, `can_read_claim`, `can_read_question`, `can_read_handover`, `can_read_handover_item`) with empty `search_path`, schema-qualified references, no dynamic SQL, and trust boundaries documented.
  - `20261107100004_table_grants.sql`: Privilege lockdown per Section 2A.1 (all table privileges revoked from `anon`; `insert`, `update`, `delete`, `truncate` revoked from `authenticated` on every table; `select` granted to `authenticated` only on user-facing tables).
  - `20261107100005_rls_policies.sql`: RLS enabled on all application tables with `(select auth.uid())` wrappers and explicit SELECT policies.
  - `20261107100006_triggers_timestamps.sql`: `updated_at` maintenance triggers on `projects`, `handovers`, `profiles`, and `jobs` (safeguard 1).
  - `20261107100007_triggers_quote_validation.sql`: Zero-based Unicode code-point offset and exact substring equality validation trigger on `claim_evidence` (safeguard 2).
  - `20261107100008_triggers_chunk_validation.sql`: Source content matching and offset validation trigger on `source_chunks` (safeguard 3).
  - `20261107100009_triggers_review_item_consistency.sql`: Validates that `reviews.item_id` belongs to `reviews.handover_id` (safeguard 4).
  - `20261107100010_triggers_immutability.sql`: Approved and shared version immutability triggers for `handovers`, `handover_items`, and `handover_item_claims` (safeguards 5 & 16).
  - `20261107100011_triggers_epoch_invalidation.sql`: Triggers on `project_members`, `source_grants`, and `sources` (visibility change and archival) that increment `access_epoch` with project locked (safeguards 6 & 13).
  - `20261107100012_triggers_symmetric_relations.sql`: Enforces `from_claim_id < to_claim_id` ordering on symmetric relations (`contradicts`, `related_to`) via trigger (safeguard 15).
  - `20261107100013_trigger_auth_profile.sql`: `auth.users` insert trigger inserting display name from metadata into `public.profiles` (falling back to "Unnamed user", no email stored).
  - `20261107100014_mutation_functions.sql`: All 13 transactional mutation functions in `app_private` (`bootstrap_organisation`, `create_project`, `add_org_member`, `update_org_member`, `add_project_member`, `update_project_member`, `enqueue_job`, `lease_job`, `heartbeat_job`, `complete_job`, `fail_job`, `requeue_expired_jobs`, `request_cancel_job`), each writing an audit event in the same transaction, executable only by `service_role`.
  - `20261107100015_trigger_active_org_membership.sql`: Enforces that active project members must be active organisation members, and cascades org member deactivation to project memberships (safeguard 14).
  - `20261107100016_last_owner_protection.sql`: Database triggers enforcing that an organisation and project always retain at least one active owner (safeguard 10).
  - `20261107100017_fix_enqueue_job_and_initial_epoch.sql`: Schema-qualified `extensions.digest` for pgcrypto in `enqueue_job`, and reset initial project epoch to 1 after initial owner insertion in `create_project`.
- **Database Access Package (`packages/database`)**:
  - `createDbPool`, `checkDatabaseHealth`, `closeDbPool`.
  - `withTransaction`: Atomic transaction manager (`BEGIN` / `COMMIT` / `ROLLBACK`).
  - `callMutation`: Parameterized runner executing `app_private` mutation functions.
  - `createUserClient`: User-scoped Supabase client forwarding caller's verified JWT so RLS applies.
  - Strongly typed wrappers for all 13 mutation functions.
- **Test Fixtures Package (`packages/test-fixtures`)**:
  - `createRealTestUser`: Creates real Supabase Auth users with confirmed emails via the Admin API, signs them in through the anon client to acquire real access tokens, and creates user-scoped clients (no fake tokens).
  - `deleteRealTestUser`: Admin API cleanup.
  - `createAdminClient`, `createAnonClient`, `getTestSupabaseConfig`.
- **Security Documentation**:
  - Created `docs/security-model.md` documenting trust boundaries for every `SECURITY DEFINER` function, two-layer privilege separation, access class boundaries, reviewer approval confirmation, and finite testing limits.

## 2. Commands run

- `npm run db:start`: passed (local Supabase stack started, PostgreSQL on port 54322, Data API on port 54321).
- `npm run db:reset`: passed (all 17 migrations applied cleanly from an empty database).
- `npm run test`: passed (14/14 unit tests passed in 390ms).
- `npm run test:integration`: passed (22/22 integration tests passed in 998ms across migrations, bootstrap/membership, job lifecycle, and health endpoints).
- `npm run test:security`: passed (41/41 security tests passed in 1.18s across anon/auth privileges, cross-tenant isolation, restricted sources, last-owner protection, epoch invalidation, schema triggers, and environment guards).
- `npm run typecheck`: passed (`tsc --build` exited with code 0).
- `npm run lint`: passed (`eslint .` exited with 0 errors and 0 warnings).
- `npm run format:check`: passed (`prettier --check .` confirmed all files formatted).

## 3. Exit criteria

- `fresh migrations succeed`: met (verified by `npm run db:reset` cleanly re-creating schema and applying all 17 migrations).
- `cross-tenant reads fail`: met (verified by `tests/security/cross-tenant-isolation.test.ts` showing User A in Org A receives 0 rows when querying Org B/Project B objects across 8 tables via user-scoped Data API client).
- `restricted sources are invisible`: met (verified by `tests/security/restricted-sources.test.ts` showing ungranted members and org owners cannot view restricted source metadata, chunks, or derived claims; grants reveal them; archival hides them from all users).
- `last-owner protection works`: met (verified by `tests/security/last-owner-protection.test.ts` showing demotion, deactivation, or direct deletion of the last active owner fails at both org and project levels, and concurrent demotions are safely blocked).
- `epoch invalidation works`: met (verified by `tests/security/epoch-invalidation.test.ts` showing clean epoch increments on membership, grant, visibility, and archive changes, while source import does not increment the epoch).
- `every table has RLS and explicit policies`: met (verified by `tests/integration/migrations.test.ts` asserting `relrowsecurity = true` on every table, with explicit SELECT policies defined in `20261107100005_rls_policies.sql`).
- `no TODO comments in SQL`: met (verified by `grep -rn "TODO\|FIXME" supabase/migrations/` returning zero matches).

## 4. Decisions and spec issues recorded

- **Decisions**:
  - Recorded in `docs/decisions.md`:
    - Schema-qualifying `extensions.digest(...)` inside `SECURITY DEFINER` functions with `search_path = ''`.
    - Ensuring fresh projects initialize with `access_epoch = 1` in `create_project`.
    - Using Unicode code points (character length) for chunk and quote offsets across PostgreSQL and JavaScript tests (`[...str].length` for emoji and multi-byte scripts).
    - Privilege lockdown structure: `authenticated` has SELECT only (no DML); RLS helpers in `app_private` granted to `authenticated`; mutation functions granted to `service_role` only.
- **Spec issues**:
  - None identified for Phase 2. Followed the safer, more restrictive reading for all constraints.

## 5. Known limitations

- API routes for authentication, user management, and workspace navigation have not yet been wired up to the frontend UI; these will be implemented in Phase 3.
- Ingestion pipelines (parsing files, computing canonical UTF-8 content, chunk generation) are exercised at the database/trigger layer; full file ingestion endpoints will be added in Phase 4.
- Background worker connects to the database, but does not yet run the active lease-polling loop; the continuous worker loop will be implemented in Phase 5.
