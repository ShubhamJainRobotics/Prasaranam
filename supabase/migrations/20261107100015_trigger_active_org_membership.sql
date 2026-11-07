-- Migration: trigger_active_org_membership
-- Safeguard 14: Project membership requires an active organisation membership,
-- enforced in the database.

create or replace function app_private.enforce_active_org_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Validates that any active project member belongs to the
-- organisation and has an active organisation membership.
declare
  v_org_id uuid;
  v_is_active_org_member boolean;
begin
  -- Only active project members require active org membership
  if new.active = true then
    select organisation_id into v_org_id
    from public.projects
    where id = new.project_id;

    if v_org_id is null then
      raise exception 'Project % not found', new.project_id;
    end if;

    select exists (
      select 1
      from public.organisation_members om
      where om.organisation_id = v_org_id
        and om.user_id = new.user_id
        and om.active = true
    ) into v_is_active_org_member;

    if not v_is_active_org_member then
      raise exception 'VALIDATION_ERROR: user % must be an active member of organisation % to be an active project member',
        new.user_id, v_org_id;
    end if;
  end if;

  return new;
end;
$$;

create trigger project_members_active_org_check
  before insert or update on public.project_members
  for each row execute function app_private.enforce_active_org_membership();

-- When an organisation membership is deactivated or deleted, automatically
-- deactivate all project memberships for that user in that organisation's projects.
create or replace function app_private.cascade_org_member_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Cascades org member deactivation/removal to all projects
-- within that organisation, preserving the invariant that active project members
-- must be active organisation members.
declare
  v_target_user_id uuid;
  v_target_org_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_target_user_id := old.user_id;
    v_target_org_id := old.organisation_id;
  elsif TG_OP = 'UPDATE' and old.active = true and new.active = false then
    v_target_user_id := new.user_id;
    v_target_org_id := new.organisation_id;
  else
    return new;
  end if;

  -- Deactivate project memberships for this user in all projects of the org
  update public.project_members pm
  set active = false
  from public.projects p
  where p.id = pm.project_id
    and p.organisation_id = v_target_org_id
    and pm.user_id = v_target_user_id
    and pm.active = true;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger org_members_cascade_deactivation
  after update or delete on public.organisation_members
  for each row execute function app_private.cascade_org_member_deactivation();
