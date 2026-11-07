# Relay Security Model

This document specifies the security architecture, trust boundaries, privilege separation, and documented security limitations of the Relay platform.

---

## 1. Two-Layer Data Access Model

Relay implements defense-in-depth across two distinct database layers (SPEC Section 2A.1):

### Layer 1: PostgreSQL Table-Level Privilege Lockdown

- The `anon` role has all table and sequence privileges revoked across the entire database.
- The `authenticated` role has `INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` revoked on every application table.
- `SELECT` is granted to `authenticated` only on tables read by the API via user-scoped Supabase clients.
- `ai_usage` has `SELECT` revoked from `authenticated` (queried by backend processes only).
- Default privileges in both `public` and `app_private` schemas are altered to prevent future objects from becoming world-accessible.

### Layer 2: Row Level Security (RLS)

- RLS is enabled on every public table.
- Every SELECT policy evaluates access using `(select auth.uid())` to prevent per-row re-evaluation overhead.
- All mutations are strictly prohibited via direct Data API requests. All state modifications must pass through hardened `app_private` stored procedures callable only by `service_role`.

---

## 2. Trust Boundaries of `SECURITY DEFINER` Functions

Every `SECURITY DEFINER` function runs with the privileges of its owner (`postgres` / `service_role`). To prevent search path injection, privilege escalation, or unauthorized access, every function enforces:

1. `SET search_path = ''` (empty search path).
2. Fully schema-qualified references (`public.`, `auth.`, `app_private.`, `extensions.`, `pg_catalog.`).
3. No dynamic SQL (`EXECUTE format(...)` is forbidden).
4. Strict argument validation and authorization re-checks inside the function boundary.

### Access Helpers (Granted to `authenticated` for RLS evaluation)

| Function                             | Trust Boundary & Rationale                                                                                                                                                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_private.can_read_source`        | Reads `organisation_members`, `project_members`, `sources`, and `source_grants` across row boundaries to avoid recursive RLS evaluation during source filtering. Verifies active org membership, active project membership, unarchived status, and visibility grant. |
| `app_private.can_read_claim`         | Evaluates all evidence links for a claim. SECURITY DEFINER ensures RLS does not recursively block evaluating evidence chunks from multiple sources. Enforces the all-evidence rule (a claim is readable only if EVERY linked evidence source is readable).           |
| `app_private.can_read_question`      | Evaluates question recipient identity, project reviewer role, and read access to all referenced claims.                                                                                                                                                              |
| `app_private.can_read_handover`      | Evaluates reviewer status (draft/approved) or recipient identity and access epoch matching (shared).                                                                                                                                                                 |
| `app_private.can_read_handover_item` | Checks whether the parent handover version is accessible to the caller.                                                                                                                                                                                              |

### Auth & System Triggers

| Function                                      | Trust Boundary & Rationale                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_private.handle_new_user`                 | Trigger on `auth.users` insert. Extracts `display_name` from `raw_user_meta_data` and inserts into `public.profiles`. Never stores email address or auth secrets. |
| `app_private.enforce_active_org_membership`   | Trigger on `project_members`. Ensures an active project member belongs to an active organisation membership.                                                      |
| `app_private.cascade_org_member_deactivation` | Trigger on `organisation_members`. Cascades deactivation to all projects in that organisation when an org member is deactivated.                                  |
| `app_private.enforce_org_last_owner`          | Trigger on `organisation_members`. Enforces that an organisation always keeps at least one active owner.                                                          |
| `app_private.enforce_project_last_owner`      | Trigger on `project_members`. Enforces that a project always keeps at least one active owner.                                                                     |

### Mutation Functions (Revoked from `public`, `anon`, `authenticated`; executable by `service_role` only)

| Function                             | Trust Boundary & Rationale                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `app_private.write_audit_event`      | Internal audit logger. Emits an immutable audit record in the same transaction as state changes.            |
| `app_private.bootstrap_organisation` | Creates organisation and sets actor as owner. Only callable by verified backend service.                    |
| `app_private.create_project`         | Verifies actor is an active org owner or admin before creating a project. Resets initial access epoch to 1. |
| `app_private.add_org_member`         | Verifies actor is an active org owner/admin before adding verified users.                                   |
| `app_private.update_org_member`      | Re-checks org admin role, validates input role, enforces last-owner protection.                             |
| `app_private.add_project_member`     | Verifies actor is project owner and target is an active org member. Triggers epoch invalidation.            |
| `app_private.update_project_member`  | Verifies project owner role, enforces last-owner protection, triggers epoch invalidation.                   |
| `app_private.enqueue_job`            | Verifies project membership, computes SHA-256 payload hash via `extensions.digest`, enforces idempotency.   |
| `app_private.lease_job`              | Atomic leasing using `FOR UPDATE SKIP LOCKED`. Issues a unique `lock_token` UUID to the winning worker.     |
| `app_private.heartbeat_job`          | Verifies matching `lock_token` and `running` status before extending lease.                                 |
| `app_private.complete_job`           | Verifies matching `lock_token` before persisting final results and marking succeeded.                       |
| `app_private.fail_job`               | Verifies matching `lock_token`. Enforces terminal failure vs exponential backoff retry.                     |
| `app_private.requeue_expired_jobs`   | Reaper process. Requeues abandoned jobs or marks terminal failure after max attempts.                       |
| `app_private.request_cancel_job`     | Verifies actor is job requester or project owner before marking cancel requested.                           |

---

## 3. Access Classes & Cross-Class Analysis Limitation

An access class is the pair `(visibility, set of granted members)` of a source (SPEC Section 2A.3):

1. Every extraction batch contains chunks from sources of exactly one access class.
2. Relationship, conflict analysis, and clarification question generation run strictly per access class, over claims whose evidence lies entirely within that class.
3. **Limitation**: Cross-class analysis is not performed in the initial release. Material in distinct restricted access classes is analyzed independently to prevent inadvertent cross-boundary inference.

---

## 4. Reviewer Approval & Free-Text Limitation

Per SPEC Section 2A.4 item 6:

- **Limitation**: Software algorithms and automated models cannot deterministically prove that free-text reviewer comments, edited summaries, or manual notes contain no sensitive or restricted facts.
- **Mitigation**: Final approval of a handover draft requires the reviewer to supply an explicit confirmation flag (`confirmReviewedForRecipient: true`), formally acknowledging that the content has been human-reviewed for the designated recipient.

---

## 5. Security Invariants & Finite Test Limitations

Per SPEC Section 22.3:

- The service-role key and Gemini API key never reach browser bundles, browser storage, logs, URLs, or error bodies.
- The browser communicates with Supabase strictly for Authentication; all data operations pass through the Express API.
- All database mutations are atomic and audited.
- **Limitation**: A finite test suite does not guarantee zero leakage in all theoretical edge cases. Continuous testing, automated negative integration suites, strict schema validation triggers, and minimal-privilege database roles together provide operational assurance.
