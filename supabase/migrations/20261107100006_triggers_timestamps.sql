-- Migration: triggers_timestamps
-- Safeguard 1: Keep updated_at columns current on modification.

create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on public.projects
  for each row execute function app_private.set_updated_at();

create trigger handovers_updated_at
  before update on public.handovers
  for each row execute function app_private.set_updated_at();

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function app_private.set_updated_at();

create trigger jobs_updated_at
  before update on public.jobs
  for each row execute function app_private.set_updated_at();
