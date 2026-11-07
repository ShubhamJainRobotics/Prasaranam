-- Migration: triggers_epoch_invalidation
-- Safeguard 6: Membership and grant changes increment project access_epoch.
-- Safeguard 13: Source archival also increments the access_epoch.
-- Per SPEC.md 2A.9: epoch increments on membership change, role change,
-- deactivation, grant change, visibility change, and source archive.
-- New source imports do NOT increment the epoch.

-- ─── Increment epoch on project membership change ────────────────────────────
create or replace function app_private.increment_epoch_on_membership_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Increment access_epoch with the project row locked
  update public.projects
  set access_epoch = access_epoch + 1
  where id = coalesce(new.project_id, old.project_id);

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger project_members_epoch_invalidation
  after insert or update or delete on public.project_members
  for each row execute function app_private.increment_epoch_on_membership_change();

-- ─── Increment epoch on source grant change ───────────────────────────────────
create or replace function app_private.increment_epoch_on_grant_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.projects
  set access_epoch = access_epoch + 1
  where id = coalesce(new.project_id, old.project_id);

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger source_grants_epoch_invalidation
  after insert or update or delete on public.source_grants
  for each row execute function app_private.increment_epoch_on_grant_change();

-- ─── Increment epoch on source visibility change ─────────────────────────────
create or replace function app_private.increment_epoch_on_visibility_change()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Only increment when visibility changes (not on every source update)
  if old.visibility <> new.visibility then
    update public.projects
    set access_epoch = access_epoch + 1
    where id = new.project_id;
  end if;
  return new;
end;
$$;

create trigger sources_visibility_epoch_invalidation
  after update on public.sources
  for each row execute function app_private.increment_epoch_on_visibility_change();

-- ─── Increment epoch on source archive ───────────────────────────────────────
create or replace function app_private.increment_epoch_on_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Increment when archived_at transitions from null to non-null
  if old.archived_at is null and new.archived_at is not null then
    update public.projects
    set access_epoch = access_epoch + 1
    where id = new.project_id;
  end if;
  return new;
end;
$$;

create trigger sources_archive_epoch_invalidation
  after update on public.sources
  for each row execute function app_private.increment_epoch_on_archive();
