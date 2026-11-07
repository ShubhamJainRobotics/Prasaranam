-- Migration: Return requested_by in app_private.lease_job
drop function if exists app_private.lease_job(integer);

create or replace function app_private.lease_job(
  p_lease_seconds integer default 30
) returns table (
  id uuid,
  project_id uuid,
  requested_by uuid,
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
  ) sub
  where j.id = sub.id
  returning j.id into v_job_id;

  if v_job_id is not null then
    return query
    select
      j.id,
      j.project_id,
      j.requested_by,
      j.kind,
      j.payload,
      j.lock_token,
      j.attempts
    from public.jobs j
    where j.id = v_job_id;
  end if;
end;
$$;

revoke execute on function app_private.lease_job(integer) from public, anon, authenticated;
grant execute on function app_private.lease_job(integer) to service_role;
