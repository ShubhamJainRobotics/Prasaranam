-- Migration: handover_acknowledgements
-- New table for recipient acknowledgement of shared handovers.
-- Section 2A.1: no INSERT/UPDATE/DELETE from anon or authenticated.
-- RLS: select visible to the named recipient AND to project owners/reviewers
--      who can read the same handover via app_private.can_read_handover.

create table public.handover_acknowledgements (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null,
  handover_id      uuid not null,
  user_id          uuid not null references auth.users(id),
  acknowledged_at  timestamptz not null default now(),
  foreign key (handover_id, project_id)
    references public.handovers(id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.project_members(project_id, user_id),
  unique (handover_id, user_id)
);

alter table public.handover_acknowledgements enable row level security;

-- Only the named recipient and project owners/reviewers who can read
-- the handover may see the acknowledgement row.
create policy "handover_acknowledgements_select" on public.handover_acknowledgements
  for select using (
    (select auth.uid()) = user_id
    or app_private.can_read_handover(handover_id, (select auth.uid()))
  );

-- No insert/update/delete for anon or authenticated (Section 2A.1).
-- All writes go through app_private.acknowledge_handover only.
revoke insert, update, delete on public.handover_acknowledgements from anon, authenticated;
grant select on public.handover_acknowledgements to authenticated;
