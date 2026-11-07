-- Migration: last_owner_protection
-- Safeguard 10: Last-owner protection at organisation and project level.
-- An organisation always keeps at least one active owner, and a project always
-- keeps at least one active owner. Enforced at the database layer via triggers.

-- ─── Organisation last-owner protection trigger ──────────────────────────────
create or replace function app_private.enforce_org_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Enforces that an organisation never loses its last active owner.
declare
  v_other_active_owners integer;
begin
  -- Only care if the affected row was an active owner
  if old.role = 'owner' and old.active = true then
    -- If deleting, or updating role away from owner, or deactivating
    if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.role <> 'owner' or new.active = false)) then
      -- Check if the organisation itself is still present (not in mid-cascade deletion)
      if exists (select 1 from public.organisations where id = old.organisation_id) then
        select count(*) into v_other_active_owners
        from public.organisation_members
        where organisation_id = old.organisation_id
          and role = 'owner'
          and active = true
          and user_id <> old.user_id;

        if v_other_active_owners = 0 then
          raise exception 'LAST_OWNER: cannot remove or deactivate the last active owner of organisation %',
            old.organisation_id;
        end if;
      end if;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger org_members_last_owner_protection
  before update or delete on public.organisation_members
  for each row execute function app_private.enforce_org_last_owner();

-- ─── Project last-owner protection trigger ───────────────────────────────────
create or replace function app_private.enforce_project_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: Enforces that a project never loses its last active owner.
declare
  v_other_active_owners integer;
begin
  -- Only care if the affected row was an active owner
  if old.role = 'owner' and old.active = true then
    -- If deleting, or updating role away from owner, or deactivating
    if TG_OP = 'DELETE' or (TG_OP = 'UPDATE' and (new.role <> 'owner' or new.active = false)) then
      -- Check if the project itself is still present (not in mid-cascade deletion)
      if exists (select 1 from public.projects where id = old.project_id) then
        select count(*) into v_other_active_owners
        from public.project_members
        where project_id = old.project_id
          and role = 'owner'
          and active = true
          and user_id <> old.user_id;

        if v_other_active_owners = 0 then
          raise exception 'LAST_OWNER: cannot remove or deactivate the last active owner of project %',
            old.project_id;
        end if;
      end if;
    end if;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger project_members_last_owner_protection
  before update or delete on public.project_members
  for each row execute function app_private.enforce_project_last_owner();
