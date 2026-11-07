-- Migration: triggers_immutability
-- Safeguard 5: Approved and shared handover versions are immutable.
-- Only status may change once a handover is approved or shared.
-- Safeguard 16: Handover items and item-claim links are mutable only while parent is draft.

-- ─── Handover immutability ───────────────────────────────────────────────────
create or replace function app_private.enforce_handover_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Once approved or shared, only status transitions are allowed
  if old.status in ('approved', 'shared') then
    -- Check no immutable field changed
    if (
      old.configuration::text <> new.configuration::text
      or old.title <> new.title
      or old.recipient_id <> new.recipient_id
      or old.departing_user_id is distinct from new.departing_user_id
      or old.model_name <> new.model_name
      or old.prompt_version <> new.prompt_version
      or old.generated_access_epoch <> new.generated_access_epoch
      or old.root_id <> new.root_id
      or old.version <> new.version
    ) then
      raise exception 'handover % is % and cannot be modified (only status may change)',
        old.id, old.status;
    end if;
  end if;
  return new;
end;
$$;

create trigger handovers_immutability
  before update on public.handovers
  for each row execute function app_private.enforce_handover_immutability();

-- ─── Handover item immutability ───────────────────────────────────────────────
create or replace function app_private.enforce_handover_item_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select h.status into v_status
  from public.handovers h
  where h.id = old.handover_id;

  if v_status in ('approved', 'shared') then
    raise exception 'handover item % cannot be modified; parent handover is %',
      old.id, v_status;
  end if;
  return new;
end;
$$;

create trigger handover_items_immutability
  before update or delete on public.handover_items
  for each row execute function app_private.enforce_handover_item_immutability();

-- ─── Handover item-claim link immutability ────────────────────────────────────
create or replace function app_private.enforce_handover_item_claim_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_item_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_item_id := old.item_id;
  else
    v_item_id := new.item_id;
  end if;

  select h.status into v_status
  from public.handover_items hi
  join public.handovers h on h.id = hi.handover_id
  where hi.id = v_item_id;

  if v_status in ('approved', 'shared') then
    raise exception 'handover item-claim link cannot be modified; parent handover is %', v_status;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger handover_item_claims_immutability
  before insert or update or delete on public.handover_item_claims
  for each row execute function app_private.enforce_handover_item_claim_immutability();
