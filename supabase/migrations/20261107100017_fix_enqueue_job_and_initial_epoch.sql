-- Migration: fix_enqueue_job_and_initial_epoch
-- 1. Schema-qualify extensions.digest in enqueue_job so search_path = '' finds it.
-- 2. Ensure create_project leaves the fresh project with initial access_epoch = 1
--    (the project_members trigger increments it on initial owner insert; we reset it to 1).

-- ─── create_project ──────────────────────────────────────────────────────────
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

  -- Create project (starts with default access_epoch = 1)
  insert into public.projects (organisation_id, name, description, domain, timezone, created_by)
  values (p_org_id, p_name, p_description, p_domain, p_timezone, p_actor_id)
  returning id into v_project_id;

  -- Create owner membership
  insert into public.project_members (project_id, user_id, role, active)
  values (v_project_id, p_actor_id, 'owner', true);

  -- The project_members trigger incremented access_epoch to 2 on insert.
  -- Initial project creation starts with epoch 1 per Section 10.
  update public.projects
  set access_epoch = 1
  where id = v_project_id;

  -- Write audit event
  perform app_private.write_audit_event(
    p_org_id, v_project_id, p_actor_id,
    'create_project', 'project', v_project_id,
    jsonb_build_object('name', p_name, 'domain', p_domain)
  );

  return v_project_id;
end;
$$;

-- ─── enqueue_job ─────────────────────────────────────────────────────────────
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

  -- Compute payload hash using extensions.digest
  v_payload_hash := encode(extensions.digest(p_payload::text, 'sha256'), 'hex');

  -- Check for existing job with this idempotency key
  select id, payload_hash into v_existing_id, v_existing_hash
  from public.jobs
  where project_id = p_project_id
    and requested_by = p_actor_id
    and kind = p_kind
    and idempotency_key = p_idempotency_key;

  if found then
    -- Same payload -> idempotent return
    if v_existing_hash = v_payload_hash then
      return v_existing_id;
    else
      -- Different payload -> conflict
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

revoke execute on function
  app_private.create_project(uuid, uuid, text, text, text, text),
  app_private.enqueue_job(uuid, uuid, text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  app_private.create_project(uuid, uuid, text, text, text, text),
  app_private.enqueue_job(uuid, uuid, text, text, jsonb)
to service_role;
