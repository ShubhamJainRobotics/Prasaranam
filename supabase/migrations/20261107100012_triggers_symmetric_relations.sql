-- Migration: triggers_symmetric_relations
-- Safeguard 15: Symmetric relations (contradicts, related_to) stored once
-- with from_claim_id < to_claim_id to avoid duplicate pairs.

create or replace function app_private.enforce_symmetric_relation_order()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tmp uuid;
begin
  -- For symmetric relations, ensure from_claim_id < to_claim_id
  if new.relation in ('contradicts', 'related_to') then
    if new.from_claim_id > new.to_claim_id then
      -- Swap the IDs to maintain canonical ordering
      v_tmp := new.from_claim_id;
      new.from_claim_id := new.to_claim_id;
      new.to_claim_id := v_tmp;
    end if;
  end if;
  return new;
end;
$$;

create trigger claim_relationships_symmetric_order
  before insert or update on public.claim_relationships
  for each row execute function app_private.enforce_symmetric_relation_order();
