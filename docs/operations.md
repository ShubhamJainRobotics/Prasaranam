# Relay Operations & Maintenance Runbook

This runbook provides operational instructions for operators maintaining the Relay knowledge handover service in production.

---

## 1. AI Provider Data Transfer Disclosure

Relay integrates with Google Gemini for knowledge extraction, relationship synthesis, clarification question generation, handover drafting, and evidence-grounded Q&A.

### 1.1 What Data Leaves the System

- **Source Chunks**: Only raw text from imported documents within a single access class is transmitted during extraction.
- **Handover Generation Context**: Only claims and evidence quotes that are mutually readable by both the designated reviewer and recipient are transmitted.
- **Q&A Context**: Only top-scoring search results from claims readable by the querying user are transmitted.
- **Prompt Envelopes**: System instructions, section definitions, and contract schemas.

### 1.2 What Never Leaves the System

- **Restricted Material Beyond Grant**: Documents or claims not explicitly shared with the recipient are excluded server-side before request serialization.
- **Database IDs & Internal Secrets**: Database connection strings, service role keys, user emails, and passwords are never sent to AI providers.
- **Full Database Context**: Entire database dumps or cross-project data are never transmitted.

### 1.3 Provider Logging & Zero Retention

Relay's Gemini adapter (`apps/api/src/ai/providers/gemini-adapter.ts`) logs only execution metadata:

- Request ID, model name, input/output token counts, latency in milliseconds, and status.
- Prompts, raw responses, and extracted quotes are strictly omitted from log streams.

---

## 2. Key Rotation Procedures

### 2.1 Gemini API Key Rotation

1. Generate a new API key in Google AI Studio.
2. Update the `GEMINI_API_KEY` environment variable in the production secret store (e.g., AWS Secrets Manager, Kubernetes Secrets).
3. Perform a rolling restart of `relay-api` and `relay-worker`.
4. Verify `/health/ready` and inspect worker logs for successful job execution.
5. Decommission the old Gemini API key.

### 2.2 Supabase JWT Secret Rotation

1. Update JWT secret in Supabase dashboard under API Settings.
2. Update `SUPABASE_JWT_SECRET` across all `relay-api` and `relay-worker` instances.
3. Restart backend services. Active user sessions will be prompted to re-authenticate.

### 2.3 Supabase Service Role Key Rotation

1. Generate new service role secret in Supabase dashboard.
2. Update `SUPABASE_SERVICE_ROLE_KEY` in `relay-api` and `relay-worker`.
3. Restart backend services.

---

## 3. Incident Response: Rapid Access Invalidation

If an unauthorized disclosure is suspected, or if a team member's clearance changes abruptly:

### Immediate Access Invalidation (Emergency Bump)

To immediately invalidate all in-flight jobs, draft handovers, and cached Q&A history for a project:

```sql
-- Connect via psql as service_role / postgres
UPDATE public.projects
SET access_epoch = access_epoch + 1,
    updated_at = clock_timestamp()
WHERE id = 'TARGET_PROJECT_UUID';
```

**Impact**:

- All active worker jobs for that project will fail on completion with `STALE_CONTEXT` and discard uncommitted AI drafts.
- All draft handovers under that project will be marked `stale` and require regeneration.
- Q&A conversation history from earlier epochs is masked with the generic access change notice.

### Source Revocation

To revoke a restricted source from a user:

```sql
DELETE FROM public.source_grants
WHERE source_id = 'SOURCE_UUID' AND user_id = 'USER_UUID';
```

_(The existing database trigger automatically increments the project's `access_epoch` and logs an audit event)._

---

## 4. Quotas & Worker Scaling

### 4.1 Token Budget Management

Each project enforces a daily token quota (`AI_PROJECT_DAILY_TOKEN_BUDGET`). Daily usage is tracked in `public.ai_usage`:

```sql
SELECT
  project_id,
  SUM(input_tokens + output_tokens) AS daily_tokens,
  COUNT(*) AS total_calls
FROM public.ai_usage
WHERE created_at >= CURRENT_DATE
GROUP BY project_id;
```

If a project hits its daily budget, background jobs will pause until the quota window resets at midnight UTC, or an administrator raises the limit in `project_settings`.

### 4.2 Worker Scaling & Advisory Locks

- The background worker uses transactional advisory leasing (`app_private.lease_job`) with `FOR UPDATE SKIP LOCKED`.
- You can horizontally scale `relay-worker` containers from 1 to N replicas without race conditions. Each replica processes jobs up to its configured `WORKER_CONCURRENCY`.

---

## 5. Database Backups & Data Retention

### 5.1 Automated Backups

- Run daily PostgreSQL snapshots using `pg_dump`:

```bash
pg_dump -Fc -v --clean -d "$DATABASE_URL" -f "relay_backup_$(date +%Y%m%d_%H%M%S).dump"
```

- Store backups encrypted at rest with 30-day retention.

### 5.2 Soft-Deletion and Hard GDPR Erasure

- Relay uses soft deletion for sources (`archived_at IS NOT NULL`) to preserve audit provenance.
- For formal GDPR Right to be Forgotten requests:
  1. An administrator runs an authorized script to delete user records from `auth.users`, which cascades to `public.profiles`.
  2. The user's contributions in `public.audit_events` retain actor UUID for tamper-evidence while personal identifiers are cleared.
