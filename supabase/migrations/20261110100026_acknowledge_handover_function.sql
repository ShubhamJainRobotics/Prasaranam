-- Migration: acknowledge_handover_function
-- app_private.acknowledge_handover: idempotent recipient acknowledgement of a
-- shared handover.
-- Section 2A.1: EXECUTE revoked from public/anon/authenticated; granted to
-- service_role only.
-- search_path = '' throughout; all references are schema-qualified.

create or replace function app_private.acknowledge_handover(
  p_actor_id   uuid,
  p_handover_id uuid
) returns table (
  id              uuid,
  handover_id     uuid,
  user_id         uuid,
  acknowledged_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
-- TRUST BOUNDARY: Called by service_role only. p_actor_id is the verified user
-- id from the Express API (Supabase auth.getUser verified). Checks that the
-- actor is the designated recipient, the handover is in 'shared' status, all
-- access epoch guards pass, and the actor is still an active project member
-- before inserting the acknowledgement row.
declare
  v_h           public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id      uuid;
  v_ack_id      uuid;
  v_ack_at      timestamptz;
begin
  -- 1. Lock the handover row FOR SHARE to prevent concurrent status changes
  --    while still allowing parallel reads.
  select h.* into v_h
  from public.handovers h
  where h.id = p_handover_id
  for share;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  -- 2. Actor must be the designated recipient (generic FORBIDDEN to avoid
  --    leaking handover existence to non-recipients).
  if v_h.recipient_id <> p_actor_id then
    raise exception 'FORBIDDEN';
  end if;

  -- 3. Handover must be in 'shared' status.
  if v_h.status <> 'shared' then
    raise exception 'REGENERATION_REQUIRED';
  end if;

  -- 4. Load project epoch and org id.
  select p.access_epoch, p.organisation_id
  into v_current_epoch, v_org_id
  from public.projects p
  where p.id = v_h.project_id;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  -- Epoch guards: both generated_access_epoch and approved_access_epoch must
  -- equal the current project epoch.
  if v_h.generated_access_epoch <> v_current_epoch
     or v_h.approved_access_epoch is distinct from v_current_epoch then
    raise exception 'REGENERATION_REQUIRED';
  end if;

  -- 5. Actor must still be an active project member.
  if not app_private.is_project_member(v_h.project_id, p_actor_id) then
    raise exception 'REGENERATION_REQUIRED';
  end if;

  -- 6. No non-rejected item may have an unreadable claim for the actor.
  if exists (
    select 1
    from public.handover_items hi
    join public.handover_item_claims hic on hic.item_id = hi.id
    where hi.handover_id = p_handover_id
      and hi.review_state <> 'rejected'
      and not app_private.can_read_claim(hic.claim_id, p_actor_id)
  ) then
    raise exception 'REGENERATION_REQUIRED';
  end if;

  -- 7. Insert the acknowledgement idempotently.
  insert into public.handover_acknowledgements (project_id, handover_id, user_id)
  values (v_h.project_id, p_handover_id, p_actor_id)
  on conflict (handover_id, user_id) do nothing
  returning
    public.handover_acknowledgements.id,
    public.handover_acknowledgements.acknowledged_at
  into v_ack_id, v_ack_at;

  -- If DO NOTHING fired (already acknowledged), read the existing row.
  if v_ack_id is null then
    select
      ha.id,
      ha.acknowledged_at
    into v_ack_id, v_ack_at
    from public.handover_acknowledgements ha
    where ha.handover_id = p_handover_id
      and ha.user_id = p_actor_id;
  end if;

  -- 8. Write audit event.
  perform app_private.write_audit_event(
    v_org_id,
    v_h.project_id,
    p_actor_id,
    'acknowledge_handover',
    'handover',
    p_handover_id,
    jsonb_build_object('version', v_h.version)
  );

  -- 9. Return the acknowledgement row.
  return query
    select
      v_ack_id,
      p_handover_id,
      p_actor_id,
      v_ack_at;
end;
$$;

-- Section 2A.1: service_role only.
revoke execute on function app_private.acknowledge_handover(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.acknowledge_handover(uuid, uuid) to service_role;
