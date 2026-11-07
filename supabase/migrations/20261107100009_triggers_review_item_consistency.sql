-- Migration: triggers_review_item_consistency
-- Safeguard 4: reviews.item_id must belong to reviews.handover_id when non-null.

create or replace function app_private.validate_review_item()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.item_id is not null then
    if not exists (
      select 1
      from public.handover_items hi
      where hi.id = new.item_id
        and hi.handover_id = new.handover_id
    ) then
      raise exception 'review item_id % does not belong to handover_id %',
        new.item_id, new.handover_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger reviews_validate_item_consistency
  before insert or update on public.reviews
  for each row execute function app_private.validate_review_item();
