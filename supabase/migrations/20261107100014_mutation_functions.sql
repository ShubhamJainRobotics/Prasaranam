-- Migration: mutation_functions
-- All app_private mutation functions.
-- Each: empty search_path, schema-qualified, takes actor_id, re-checks
-- permissions, writes audit event in same transaction.
-- EXECUTE revoked from public/anon/authenticated; granted to service_role only.

-- ─── Helper: write an audit event ────────────────────────────────────────────
create or replace function app_private.write_audit_event(
  p_organisation_id uuid,
  p_project_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb,
  p_request_id text default null
) returns void
language sql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Writes audit events on behalf of mutation functions
-- (service_role context). Caller must supply verified actor_id; never trust
-- client-submitted values directly.
  insert into public.audit_events (
    organisation_id, project_id, actor_id, action,
    entity_type, entity_id, metadata, request_id
  ) values (
    p_organisation_id, p_project_id, p_actor_id, p_action,
    p_entity_type, p_entity_id, p_metadata, p_request_id
  );
$$;

-- ─── bootstrap_organisation ──────────────────────────────────────────────────
-- Creates an organisation and sets the actor as owner.
-- Returns the new organisation id.
create or replace function app_private.bootstrap_organisation(
  p_actor_id uuid,
  p_org_name text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. p_actor_id is the verified user
-- id from the Express API (Supabase auth.getUser verified). Creates org and
-- owner membership atomically.
declare
  v_org_id uuid;
begin
  -- Create organisation
  insert into public.organisations (name, created_by)
  values (p_org_name, p_actor_id)
  returning id into v_org_id;

  -- Create owner membership
  insert into public.organisation_members (organisation_id, user_id, role, active)
  values (v_org_id, p_actor_id, 'owner', true);

  -- Write audit event
  perform app_private.write_audit_event(
    v_org_id, null, p_actor_id,
    'bootstrap_organisation', 'organisation', v_org_id,
    jsonb_build_object('name', p_org_name)
  );

  return v_org_id;
end;
$$;

-- ─── create_project ──────────────────────────────────────────────────────────
-- Creates a project under an organisation and sets the actor as owner.
-- Actor must be an org owner or admin.
-- Returns the new project id.
create or replace function app_private.create_project(
  p_actor_id uuid,
  p_org_id uuid,
  p_name text,
  p_description text,
  p_domain text,
  p_timezone text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is org owner/admin
-- before creating project.
declare
  v_project_id uuid;
begin
  -- Permission check
  if not app_private.is_org_admin(p_org_id, p_actor_id) then
    raise exception 'FORBIDDEN: actor % is not an org admin of %', p_actor_id, p_org_id;
  end if;

  -- Create project
  insert into public.projects (organisation_id, name, description, domain, timezone, created_by)
  values (p_org_id, p_name, p_description, p_domain, p_timezone, p_actor_id)
  returning id into v_project_id;

  -- Create owner membership
  insert into public.project_members (project_id, user_id, role, active)
  values (v_project_id, p_actor_id, 'owner', true);

  -- Write audit event
  perform app_private.write_audit_event(
    p_org_id, v_project_id, p_actor_id,
    'create_project', 'project', v_project_id,
    jsonb_build_object('name', p_name, 'domain', p_domain)
  );

  return v_project_id;
end;
$$;

-- ─── add_org_member ──────────────────────────────────────────────────────────
-- Adds an existing verified user to an organisation.
-- Actor must be an org owner or admin.
create or replace function app_private.add_org_member(
  p_actor_id uuid,
  p_org_id uuid,
  p_target_user_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is org admin.
begin
  -- Permission check
  if not app_private.is_org_admin(p_org_id, p_actor_id) then
    raise exception 'FORBIDDEN: actor % is not an org admin of %', p_actor_id, p_org_id;
  end if;

  -- Validate role
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'VALIDATION_ERROR: invalid org role %', p_role;
  end if;

  -- Upsert membership
  insert into public.organisation_members (organisation_id, user_id, role, active)
  values (p_org_id, p_target_user_id, p_role, true)
  on conflict (organisation_id, user_id) do update
    set role = excluded.role, active = true;

  -- Write audit event
  perform app_private.write_audit_event(
    p_org_id, null, p_actor_id,
    'add_org_member', 'organisation_member', p_target_user_id,
    jsonb_build_object('role', p_role)
  );
end;
$$;

-- ─── update_org_member ───────────────────────────────────────────────────────
-- Updates org member role or active state. Last-owner protection applies.
-- Increments project access_epoch for all projects in the org (via trigger).
create or replace function app_private.update_org_member(
  p_actor_id uuid,
  p_org_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is org admin and
-- last-owner protection before updating.
declare
  v_active_owner_count integer;
  v_current_role text;
  v_current_active boolean;
begin
  -- Permission check
  if not app_private.is_org_admin(p_org_id, p_actor_id) then
    raise exception 'FORBIDDEN: actor % is not an org admin of %', p_actor_id, p_org_id;
  end if;

  -- Validate role
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'VALIDATION_ERROR: invalid org role %', p_role;
  end if;

  -- Get current state
  select role, active into v_current_role, v_current_active
  from public.organisation_members
  where organisation_id = p_org_id and user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: member % not in org %', p_target_user_id, p_org_id;
  end if;

  -- Last-owner protection: if the target is currently an active owner, and
  -- the change would remove them as active owner, check that at least one other remains.
  if v_current_role = 'owner' and v_current_active = true then
    if p_role <> 'owner' or p_active = false then
      select count(*) into v_active_owner_count
      from public.organisation_members
      where organisation_id = p_org_id
        and role = 'owner'
        and active = true
        and user_id <> p_target_user_id;

      if v_active_owner_count = 0 then
        raise exception 'LAST_OWNER: cannot remove the last active owner of org %', p_org_id;
      end if;
    end if;
  end if;

  -- Update membership
  update public.organisation_members
  set role = p_role, active = p_active
  where organisation_id = p_org_id and user_id = p_target_user_id;

  -- Write audit event
  perform app_private.write_audit_event(
    p_org_id, null, p_actor_id,
    'update_org_member', 'organisation_member', p_target_user_id,
    jsonb_build_object('role', p_role, 'active', p_active)
  );
end;
$$;

-- ─── add_project_member ──────────────────────────────────────────────────────
-- Adds an existing active org member to a project.
-- Actor must be a project owner.
create or replace function app_private.add_project_member(
  p_actor_id uuid,
  p_project_id uuid,
  p_target_user_id uuid,
  p_role text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is project owner
-- and that the target is an active org member.
declare
  v_org_id uuid;
begin
  -- Validate role
  if p_role not in ('owner', 'reviewer', 'contributor', 'recipient') then
    raise exception 'VALIDATION_ERROR: invalid project role %', p_role;
  end if;

  -- Get org_id
  select organisation_id into v_org_id
  from public.projects where id = p_project_id;

  if not found then
    raise exception 'NOT_FOUND: project %', p_project_id;
  end if;

  -- Permission check: actor must be project owner
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner']) then
    raise exception 'FORBIDDEN: actor % is not an owner of project %', p_actor_id, p_project_id;
  end if;

  -- Target must be an active org member (safeguard 14)
  if not app_private.is_org_member(v_org_id, p_target_user_id) then
    raise exception 'VALIDATION_ERROR: target % is not an active org member', p_target_user_id;
  end if;

  -- Upsert membership
  insert into public.project_members (project_id, user_id, role, active)
  values (p_project_id, p_target_user_id, p_role, true)
  on conflict (project_id, user_id) do update
    set role = excluded.role, active = true;

  -- Write audit event (epoch increment happens via trigger on project_members)
  perform app_private.write_audit_event(
    v_org_id, p_project_id, p_actor_id,
    'add_project_member', 'project_member', p_target_user_id,
    jsonb_build_object('role', p_role)
  );
end;
$$;

-- ─── update_project_member ───────────────────────────────────────────────────
-- Updates project member role or active state. Last-owner protection applies.
-- Epoch increment happens via trigger on project_members.
create or replace function app_private.update_project_member(
  p_actor_id uuid,
  p_project_id uuid,
  p_target_user_id uuid,
  p_role text,
  p_active boolean
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is project owner
-- and enforces last-owner protection before updating.
declare
  v_org_id uuid;
  v_active_owner_count integer;
  v_current_role text;
  v_current_active boolean;
begin
  -- Validate role
  if p_role not in ('owner', 'reviewer', 'contributor', 'recipient') then
    raise exception 'VALIDATION_ERROR: invalid project role %', p_role;
  end if;

  -- Get org_id
  select organisation_id into v_org_id
  from public.projects where id = p_project_id;

  if not found then
    raise exception 'NOT_FOUND: project %', p_project_id;
  end if;

  -- Permission check
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner']) then
    raise exception 'FORBIDDEN: actor % is not an owner of project %', p_actor_id, p_project_id;
  end if;

  -- Get current state (lock the row)
  select role, active into v_current_role, v_current_active
  from public.project_members
  where project_id = p_project_id and user_id = p_target_user_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: member % not in project %', p_target_user_id, p_project_id;
  end if;

  -- Last-owner protection
  if v_current_role = 'owner' and v_current_active = true then
    if p_role <> 'owner' or p_active = false then
      select count(*) into v_active_owner_count
      from public.project_members
      where project_id = p_project_id
        and role = 'owner'
        and active = true
        and user_id <> p_target_user_id;

      if v_active_owner_count = 0 then
        raise exception 'LAST_OWNER: cannot remove the last active owner of project %', p_project_id;
      end if;
    end if;
  end if;

  -- Update membership (epoch increment happens via trigger)
  update public.project_members
  set role = p_role, active = p_active
  where project_id = p_project_id and user_id = p_target_user_id;

  -- Write audit event
  perform app_private.write_audit_event(
    v_org_id, p_project_id, p_actor_id,
    'update_project_member', 'project_member', p_target_user_id,
    jsonb_build_object('role', p_role, 'active', p_active)
  );
end;
$$;

-- ─── enqueue_job ─────────────────────────────────────────────────────────────
-- Enqueues a new job or returns an existing one for the same idempotency key.
-- Same key + same payload → returns existing job id.
-- Same key + different payload → raises IDEMPOTENCY_CONFLICT (422 in API).
create or replace function app_private.enqueue_job(
  p_actor_id uuid,
  p_project_id uuid,
  p_kind text,
  p_idempotency_key text,
  p_payload jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. p_actor_id is verified upstream.
declare
  v_payload_hash text;
  v_existing_id uuid;
  v_existing_hash text;
  v_job_id uuid;
  v_org_id uuid;
begin
  -- Validate kind
  if p_kind not in ('extract', 'analyze_relationships', 'generate_questions', 'generate_handover') then
    raise exception 'VALIDATION_ERROR: invalid job kind %', p_kind;
  end if;

  -- Actor must be an active project member
  if not app_private.is_project_member(p_project_id, p_actor_id) then
    raise exception 'FORBIDDEN: actor % is not a member of project %', p_actor_id, p_project_id;
  end if;

  -- Compute payload hash
  v_payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');

  -- Check for existing job with this idempotency key
  select id, payload_hash into v_existing_id, v_existing_hash
  from public.jobs
  where project_id = p_project_id
    and requested_by = p_actor_id
    and kind = p_kind
    and idempotency_key = p_idempotency_key;

  if found then
    -- Same payload → idempotent return
    if v_existing_hash = v_payload_hash then
      return v_existing_id;
    else
      -- Different payload → conflict
      raise exception 'IDEMPOTENCY_CONFLICT: idempotency key % already used with different payload',
        p_idempotency_key;
    end if;
  end if;

  -- Get org_id for audit
  select organisation_id into v_org_id from public.projects where id = p_project_id;

  -- Insert new job
  insert into public.jobs (
    project_id, requested_by, kind, idempotency_key, payload_hash, payload
  ) values (
    p_project_id, p_actor_id, p_kind, p_idempotency_key, v_payload_hash, p_payload
  )
  returning id into v_job_id;

  -- Write audit event
  perform app_private.write_audit_event(
    v_org_id, p_project_id, p_actor_id,
    'enqueue_job', 'job', v_job_id,
    jsonb_build_object('kind', p_kind)
  );

  return v_job_id;
end;
$$;

-- ─── lease_job ───────────────────────────────────────────────────────────────
-- Atomically leases one queued job using FOR UPDATE SKIP LOCKED.
-- Returns the leased job row or empty if none available.
create or replace function app_private.lease_job(
  p_lease_seconds integer default 30
) returns table (
  id uuid,
  project_id uuid,
  kind text,
  payload jsonb,
  lock_token uuid,
  attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role (worker process) only.
-- Uses FOR UPDATE SKIP LOCKED so concurrent workers never double-lease.
declare
  v_lock_token uuid;
  v_job_id uuid;
begin
  v_lock_token := gen_random_uuid();

  -- Atomic lease: select one queued job, lock it, update in place
  update public.jobs j
  set
    status = 'running',
    lock_token = v_lock_token,
    locked_until = now() + (p_lease_seconds || ' seconds')::interval,
    heartbeat_at = now(),
    attempts = j.attempts + 1
  from (
    select jj.id
    from public.jobs jj
    where jj.status = 'queued'
      and jj.run_after <= now()
    order by jj.run_after asc
    limit 1
    for update skip locked
  ) as candidate
  where j.id = candidate.id
  returning j.id, j.project_id, j.kind, j.payload, j.lock_token, j.attempts
  into id, project_id, kind, payload, lock_token, attempts;

  if found then
    return next;
  end if;
end;
$$;

-- ─── heartbeat_job ───────────────────────────────────────────────────────────
-- Extends the lease of a running job. Verifies lock_token ownership.
create or replace function app_private.heartbeat_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_lease_seconds integer default 30
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role (worker process) only.
-- Lock token guards against stale workers extending another worker's lease.
declare
  v_rows integer;
begin
  update public.jobs
  set
    heartbeat_at = now(),
    locked_until = now() + (p_lease_seconds || ' seconds')::interval
  where id = p_job_id
    and lock_token = p_lock_token
    and status = 'running';

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'LEASE_LOST: job % lock token mismatch or not running', p_job_id;
  end if;
end;
$$;

-- ─── complete_job ────────────────────────────────────────────────────────────
-- Marks a job as succeeded with its result. Verifies lock_token.
create or replace function app_private.complete_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_result jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role (worker process) only.
declare
  v_rows integer;
begin
  update public.jobs
  set
    status = 'succeeded',
    result = p_result,
    progress = 100,
    lock_token = null,
    locked_until = null
  where id = p_job_id
    and lock_token = p_lock_token
    and status = 'running';

  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    raise exception 'LEASE_LOST: job % lock token mismatch or not running', p_job_id;
  end if;
end;
$$;

-- ─── fail_job ────────────────────────────────────────────────────────────────
-- Marks a job as failed or requeues it with exponential backoff + jitter.
-- Verifies lock_token. Terminal when attempts >= max_attempts.
create or replace function app_private.fail_job(
  p_job_id uuid,
  p_lock_token uuid,
  p_error_code text,
  p_max_attempts integer default 3,
  p_retry_base_seconds integer default 30
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role (worker process) only.
declare
  v_attempts integer;
  v_rows integer;
  v_backoff_seconds numeric;
begin
  -- Get current attempts under lock
  select attempts into v_attempts
  from public.jobs
  where id = p_job_id and lock_token = p_lock_token and status = 'running'
  for update;

  if not found then
    raise exception 'LEASE_LOST: job % lock token mismatch or not running', p_job_id;
  end if;

  if v_attempts >= p_max_attempts then
    -- Terminal failure
    update public.jobs
    set
      status = 'failed',
      last_error_code = p_error_code,
      lock_token = null,
      locked_until = null
    where id = p_job_id;
  else
    -- Requeue with exponential backoff + random jitter (up to 50% of backoff)
    v_backoff_seconds := p_retry_base_seconds * power(2, v_attempts - 1);
    v_backoff_seconds := v_backoff_seconds + (random() * v_backoff_seconds * 0.5);

    update public.jobs
    set
      status = 'queued',
      last_error_code = p_error_code,
      lock_token = null,
      locked_until = null,
      run_after = now() + (v_backoff_seconds || ' seconds')::interval
    where id = p_job_id;
  end if;
end;
$$;

-- ─── requeue_expired_jobs ─────────────────────────────────────────────────────
-- Requeues running jobs whose lease has expired. Fails terminal ones.
-- Returns the count of jobs requeued or failed.
create or replace function app_private.requeue_expired_jobs(
  p_max_attempts integer default 3
) returns integer
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role (reaper process) only.
declare
  v_count integer := 0;
  v_job record;
begin
  for v_job in
    select id, attempts
    from public.jobs
    where status = 'running'
      and locked_until < now()
    for update skip locked
  loop
    if v_job.attempts >= p_max_attempts then
      update public.jobs
      set
        status = 'failed',
        last_error_code = 'LEASE_EXPIRED',
        lock_token = null,
        locked_until = null
      where id = v_job.id;
    else
      update public.jobs
      set
        status = 'queued',
        lock_token = null,
        locked_until = null,
        run_after = now()
      where id = v_job.id;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ─── request_cancel_job ──────────────────────────────────────────────────────
-- Sets cancel_requested on a job. Actor must be requester or project owner.
create or replace function app_private.request_cancel_job(
  p_actor_id uuid,
  p_job_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Called by service_role only. Verifies actor is requester or owner.
declare
  v_project_id uuid;
  v_requested_by uuid;
  v_status text;
begin
  select project_id, requested_by, status
  into v_project_id, v_requested_by, v_status
  from public.jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'NOT_FOUND: job %', p_job_id;
  end if;

  -- Permission check
  if v_requested_by <> p_actor_id
    and not app_private.has_project_role(v_project_id, p_actor_id, array['owner']) then
    raise exception 'FORBIDDEN: actor % cannot cancel job %', p_actor_id, p_job_id;
  end if;

  -- Can only cancel queued or running jobs
  if v_status not in ('queued', 'running') then
    raise exception 'ILLEGAL_STATE: job % is % and cannot be cancelled', p_job_id, v_status;
  end if;

  update public.jobs
  set cancel_requested = true
  where id = p_job_id;
end;
$$;

-- ─── Revoke execution from public/anon/authenticated for all mutation functions
-- Grant to service_role only.

revoke execute on function
  app_private.write_audit_event(uuid, uuid, uuid, text, text, uuid, jsonb, text),
  app_private.bootstrap_organisation(uuid, text),
  app_private.create_project(uuid, uuid, text, text, text, text),
  app_private.add_org_member(uuid, uuid, uuid, text),
  app_private.update_org_member(uuid, uuid, uuid, text, boolean),
  app_private.add_project_member(uuid, uuid, uuid, text),
  app_private.update_project_member(uuid, uuid, uuid, text, boolean),
  app_private.enqueue_job(uuid, uuid, text, text, jsonb),
  app_private.lease_job(integer),
  app_private.heartbeat_job(uuid, uuid, integer),
  app_private.complete_job(uuid, uuid, jsonb),
  app_private.fail_job(uuid, uuid, text, integer, integer),
  app_private.requeue_expired_jobs(integer),
  app_private.request_cancel_job(uuid, uuid)
from public, anon, authenticated;

grant execute on function
  app_private.write_audit_event(uuid, uuid, uuid, text, text, uuid, jsonb, text),
  app_private.bootstrap_organisation(uuid, text),
  app_private.create_project(uuid, uuid, text, text, text, text),
  app_private.add_org_member(uuid, uuid, uuid, text),
  app_private.update_org_member(uuid, uuid, uuid, text, boolean),
  app_private.add_project_member(uuid, uuid, uuid, text),
  app_private.update_project_member(uuid, uuid, uuid, text, boolean),
  app_private.enqueue_job(uuid, uuid, text, text, jsonb),
  app_private.lease_job(integer),
  app_private.heartbeat_job(uuid, uuid, integer),
  app_private.complete_job(uuid, uuid, jsonb),
  app_private.fail_job(uuid, uuid, text, integer, integer),
  app_private.requeue_expired_jobs(integer),
  app_private.request_cancel_job(uuid, uuid)
to service_role;
