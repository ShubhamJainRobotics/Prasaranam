-- Migration: phase6_handover_workflow
-- Phase 6: Handover workflow, recipient-scoped generation, evidence review,
-- immutability triggers, and atomic approval/share functions.

-- ─── Helper updates: can_read_handover and can_read_handover_item ────────────

create or replace function app_private.can_read_handover(
  p_handover_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.handovers h
    join public.projects p on p.id = h.project_id
    where h.id = p_handover_id
      and app_private.is_org_member(p.organisation_id, p_user_id)
      and app_private.is_project_member(h.project_id, p_user_id)
      and (
        -- reviewer: draft or approved status, must be owner or reviewer
        -- MUST also be able to read every cited claim (SPEC 2A.2 line 92)
        (
          h.status in ('draft', 'approved')
          and app_private.has_project_role(h.project_id, p_user_id, array['owner', 'reviewer'])
          and not exists (
            select 1
            from public.handover_items hi
            join public.handover_item_claims hic on hic.item_id = hi.id
            where hi.handover_id = h.id
              and not app_private.can_read_claim(hic.claim_id, p_user_id)
          )
        )
        -- recipient: shared status, identity match, epoch matches, memberships active, can read all cited claims
        or (
          h.status = 'shared'
          and h.recipient_id = p_user_id
          and h.generated_access_epoch = p.access_epoch
          and h.approved_access_epoch = p.access_epoch
          and not exists (
            select 1
            from public.handover_items hi
            join public.handover_item_claims hic on hic.item_id = hi.id
            where hi.handover_id = h.id
              and hi.review_state <> 'rejected'
              and not app_private.can_read_claim(hic.claim_id, p_user_id)
          )
        )
        -- reviewer can read shared handover if epoch matches and can read all cited claims
        or (
          h.status = 'shared'
          and app_private.has_project_role(h.project_id, p_user_id, array['owner', 'reviewer'])
          and h.generated_access_epoch = p.access_epoch
          and h.approved_access_epoch = p.access_epoch
          and not exists (
            select 1
            from public.handover_items hi
            join public.handover_item_claims hic on hic.item_id = hi.id
            where hi.handover_id = h.id
              and hi.review_state <> 'rejected'
              and not app_private.can_read_claim(hic.claim_id, p_user_id)
          )
        )
      )
  );
$$;

create or replace function app_private.can_read_handover_item(
  p_item_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.handover_items hi
    join public.handovers h on h.id = hi.handover_id
    join public.projects p on p.id = h.project_id
    where hi.id = p_item_id
      and app_private.can_read_handover(h.id, p_user_id)
      -- If handover is stale (epoch changed), no items are readable by anyone (SPEC 2A.9 item 3)
      and h.generated_access_epoch = p.access_epoch
      and (h.status <> 'shared' or h.approved_access_epoch = p.access_epoch)
      -- User must be able to read every cited claim for this item
      and not exists (
        select 1
        from public.handover_item_claims hic
        where hic.item_id = hi.id
          and not app_private.can_read_claim(hic.claim_id, p_user_id)
      )
  );
$$;

-- ─── Immutability trigger updates ─────────────────────────────────────────────

create or replace function app_private.enforce_handover_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if old.status in ('approved', 'shared') then
      raise exception 'handover % is % and cannot be deleted', old.id, old.status;
    end if;
    return old;
  end if;

  -- Once approved or shared, only status transitions are allowed
  if old.status in ('approved', 'shared') then
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

drop trigger if exists handovers_immutability on public.handovers;
create trigger handovers_immutability
  before update or delete on public.handovers
  for each row execute function app_private.enforce_handover_immutability();

create or replace function app_private.enforce_handover_item_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_handover_id uuid;
begin
  if TG_OP = 'DELETE' then
    v_handover_id := old.handover_id;
  else
    v_handover_id := new.handover_id;
  end if;

  select h.status into v_status
  from public.handovers h
  where h.id = v_handover_id;

  if v_status in ('approved', 'shared') then
    raise exception 'handover item cannot be modified or inserted; parent handover is %',
      v_status;
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists handover_items_immutability on public.handover_items;
create trigger handover_items_immutability
  before insert or update or delete on public.handover_items
  for each row execute function app_private.enforce_handover_item_immutability();

-- ─── 1. create_handover_draft_from_generation ────────────────────────────────

create or replace function app_private.create_handover_draft_from_generation(
  p_actor_id uuid,
  p_project_id uuid,
  p_recipient_id uuid,
  p_departing_user_id uuid,
  p_title text,
  p_configuration jsonb,
  p_model_name text,
  p_prompt_version text,
  p_expected_access_epoch bigint,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_epoch bigint;
  v_org_id uuid;
  v_handover_id uuid;
  v_item jsonb;
  v_item_id uuid;
  v_section text;
  v_ordinal integer;
  v_text text;
  v_item_kind text;
  v_evidence_state text;
  v_claim_ids jsonb;
  v_claim_id_text text;
  v_claim_id uuid;
  v_claim_ev_state text;
  v_min_strength integer;
  v_curr_strength integer;
begin
  -- 1. Check actor permissions
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  -- 2. Lock project row and verify epoch
  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_current_epoch <> p_expected_access_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  -- 3. Verify recipient active membership
  if not (
    app_private.is_project_member(p_project_id, p_recipient_id)
    and app_private.is_org_member(v_org_id, p_recipient_id)
  ) then
    raise exception 'RECIPIENT_NOT_ACTIVE_MEMBER';
  end if;

  -- 4. Verify departing user if provided
  if p_departing_user_id is not null then
    if not (
      app_private.is_project_member(p_project_id, p_departing_user_id)
      and app_private.is_org_member(v_org_id, p_departing_user_id)
    ) then
      raise exception 'DEPARTING_USER_NOT_ACTIVE_MEMBER';
    end if;
  end if;

  -- 5. Insert handover draft
  v_handover_id := gen_random_uuid();

  insert into public.handovers (
    id,
    project_id,
    root_id,
    version,
    title,
    recipient_id,
    departing_user_id,
    created_by,
    status,
    configuration,
    generated_access_epoch,
    model_name,
    prompt_version,
    row_version
  ) values (
    v_handover_id,
    p_project_id,
    v_handover_id,
    1,
    p_title,
    p_recipient_id,
    p_departing_user_id,
    p_actor_id,
    'draft',
    p_configuration,
    v_current_epoch,
    p_model_name,
    p_prompt_version,
    1
  );

  -- 6. Insert items and claim links
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_section := v_item->>'section';
    v_ordinal := (v_item->>'ordinal')::integer;
    v_text := v_item->>'text';
    v_item_kind := v_item->>'itemKind';
    v_claim_ids := v_item->'claimIds';

    if v_item_kind not in ('fact', 'suggestion', 'unknown') then
      raise exception 'INVALID_ITEM_KIND';
    end if;

    if v_item_kind in ('fact', 'suggestion') and (v_claim_ids is null or jsonb_array_length(v_claim_ids) = 0) then
      raise exception 'FACTS_REQUIRE_EVIDENCE';
    end if;

    v_min_strength := 4; -- 4: corroborated, 3: supported, 2: needs_confirmation, 1: conflicting

    if v_claim_ids is not null and jsonb_array_length(v_claim_ids) > 0 then
      for v_claim_id_text in select * from jsonb_array_elements_text(v_claim_ids) loop
        v_claim_id := v_claim_id_text::uuid;

        -- Verify claim belongs to project
        select c.evidence_state into v_claim_ev_state
        from public.claims c
        where c.id = v_claim_id and c.project_id = p_project_id;

        if not found then
          raise exception 'CLAIM_NOT_FOUND';
        end if;

        -- Verify BOTH reviewer and recipient can read the claim
        if not (
          app_private.can_read_claim(v_claim_id, p_actor_id)
          and app_private.can_read_claim(v_claim_id, p_recipient_id)
        ) then
          raise exception 'ACCESS_VALIDATION_FAILED';
        end if;

        -- Calculate weakest evidence strength
        if v_claim_ev_state = 'conflicting' then
          v_curr_strength := 1;
        elsif v_claim_ev_state = 'needs_confirmation' then
          v_curr_strength := 2;
        elsif v_claim_ev_state = 'supported' then
          v_curr_strength := 3;
        elsif v_claim_ev_state = 'corroborated' then
          v_curr_strength := 4;
        else
          v_curr_strength := 1;
        end if;

        if v_curr_strength < v_min_strength then
          v_min_strength := v_curr_strength;
        end if;
      end loop;

      if v_min_strength = 1 then
        v_evidence_state := 'conflicting';
      elsif v_min_strength = 2 then
        v_evidence_state := 'needs_confirmation';
      elsif v_min_strength = 3 then
        v_evidence_state := 'supported';
      else
        v_evidence_state := 'corroborated';
      end if;
    else
      v_evidence_state := 'unknown';
    end if;

    -- If model explicitly outputted a lower state, respect the lower state
    if (v_item->>'evidenceState') in ('needs_confirmation', 'conflicting') then
      v_evidence_state := v_item->>'evidenceState';
    end if;

    v_item_id := gen_random_uuid();

    insert into public.handover_items (
      id,
      handover_id,
      project_id,
      section,
      ordinal,
      text,
      item_kind,
      evidence_state,
      review_state,
      row_version
    ) values (
      v_item_id,
      v_handover_id,
      p_project_id,
      v_section,
      v_ordinal,
      v_text,
      v_item_kind,
      v_evidence_state,
      'pending',
      1
    );

    if v_claim_ids is not null and jsonb_array_length(v_claim_ids) > 0 then
      for v_claim_id_text in select * from jsonb_array_elements_text(v_claim_ids) loop
        insert into public.handover_item_claims (
          item_id,
          project_id,
          claim_id
        ) values (
          v_item_id,
          p_project_id,
          v_claim_id_text::uuid
        ) on conflict do nothing;
      end loop;
    end if;
  end loop;

  -- 7. Audit event
  perform app_private.write_audit_event(
    v_org_id,
    p_project_id,
    p_actor_id,
    'create_handover_draft',
    'handover',
    v_handover_id,
    jsonb_build_object('recipient_id', p_recipient_id, 'title', p_title)
  );

  return jsonb_build_object(
    'handoverId', v_handover_id,
    'version', 1,
    'rowVersion', 1
  );
end;
$$;

-- ─── 2. update_item ──────────────────────────────────────────────────────────

create or replace function app_private.update_item(
  p_actor_id uuid,
  p_handover_id uuid,
  p_item_id uuid,
  p_expected_row_version integer,
  p_review_state text default null,
  p_text text default null,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_action text;
  v_new_text text;
  v_new_orig text;
  v_new_review_state text;
  v_new_edited_by uuid;
  v_new_edited_at timestamptz;
  v_claim_count integer;
begin
  -- Lock item and handover
  select
    hi.*,
    h.project_id,
    h.status as handover_status,
    h.generated_access_epoch,
    p.access_epoch,
    p.organisation_id
  into v_rec
  from public.handover_items hi
  join public.handovers h on h.id = hi.handover_id
  join public.projects p on p.id = h.project_id
  where hi.id = p_item_id and hi.handover_id = p_handover_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  -- Check actor permissions
  if not app_private.has_project_role(v_rec.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  -- Must be draft
  if v_rec.handover_status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  -- Epoch check
  if v_rec.generated_access_epoch <> v_rec.access_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  -- Optimistic concurrency
  if v_rec.row_version <> p_expected_row_version then
    raise exception 'VERSION_CONFLICT';
  end if;

  v_new_text := v_rec.text;
  v_new_orig := v_rec.original_text;
  v_new_edited_by := v_rec.edited_by;
  v_new_edited_at := v_rec.edited_at;
  v_new_review_state := v_rec.review_state;
  v_action := 'comment';

  -- Handle text edit
  if p_text is not null and p_text <> v_rec.text then
    if v_new_orig is null then
      v_new_orig := v_rec.text;
    end if;
    v_new_text := p_text;
    v_new_edited_by := p_actor_id;
    v_new_edited_at := now();
    v_action := 'edit_item';

    -- Fact or suggestion must retain at least one claim link
    if v_rec.item_kind in ('fact', 'suggestion') then
      select count(*) into v_claim_count
      from public.handover_item_claims
      where item_id = p_item_id;

      if v_claim_count = 0 then
        raise exception 'FACTS_REQUIRE_EVIDENCE';
      end if;
    end if;
  end if;

  -- Handle review state change
  if p_review_state is not null then
    if p_review_state not in ('approved', 'rejected', 'pending') then
      raise exception 'INVALID_REVIEW_STATE';
    end if;
    v_new_review_state := p_review_state;

    if v_action <> 'edit_item' then
      if p_review_state = 'approved' then
        v_action := 'approve_item';
      elsif p_review_state = 'rejected' then
        v_action := 'reject_item';
      end if;
    end if;
  end if;

  -- Update item
  update public.handover_items
  set
    text = v_new_text,
    original_text = v_new_orig,
    edited_by = v_new_edited_by,
    edited_at = v_new_edited_at,
    review_state = v_new_review_state,
    row_version = v_rec.row_version + 1
  where id = p_item_id;

  -- Insert review log
  insert into public.reviews (
    handover_id,
    project_id,
    item_id,
    reviewer_id,
    action,
    comment
  ) values (
    p_handover_id,
    v_rec.project_id,
    p_item_id,
    p_actor_id,
    v_action,
    p_comment
  );

  -- Audit event
  perform app_private.write_audit_event(
    v_rec.organisation_id,
    v_rec.project_id,
    p_actor_id,
    v_action,
    'handover_item',
    p_item_id,
    jsonb_build_object(
      'handover_id', p_handover_id,
      'review_state', v_new_review_state,
      'row_version', v_rec.row_version + 1
    )
  );

  return jsonb_build_object(
    'itemId', p_item_id,
    'rowVersion', v_rec.row_version + 1,
    'reviewState', v_new_review_state,
    'text', v_new_text,
    'originalText', v_new_orig
  );
end;
$$;

-- ─── 3. add_item_from_claims ─────────────────────────────────────────────────

create or replace function app_private.add_item_from_claims(
  p_actor_id uuid,
  p_handover_id uuid,
  p_section text,
  p_ordinal integer,
  p_text text,
  p_item_kind text,
  p_claim_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id uuid;
  v_item_id uuid;
  v_ordinal integer;
  v_claim_id uuid;
  v_claim_ev_state text;
  v_min_strength integer;
  v_curr_strength integer;
  v_evidence_state text;
begin
  select * into v_h
  from public.handovers
  where id = p_handover_id
  for update;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_h.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_h.status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = v_h.project_id;

  if v_h.generated_access_epoch <> v_current_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  if p_item_kind not in ('fact', 'suggestion', 'unknown') then
    raise exception 'INVALID_ITEM_KIND';
  end if;

  if p_item_kind in ('fact', 'suggestion') and (p_claim_ids is null or array_length(p_claim_ids, 1) = 0) then
    raise exception 'FACTS_REQUIRE_EVIDENCE';
  end if;

  v_min_strength := 4;

  if p_claim_ids is not null and array_length(p_claim_ids, 1) > 0 then
    foreach v_claim_id in array p_claim_ids loop
      select c.evidence_state into v_claim_ev_state
      from public.claims c
      where c.id = v_claim_id and c.project_id = v_h.project_id;

      if not found then
        raise exception 'CLAIM_NOT_FOUND';
      end if;

      if not (
        app_private.can_read_claim(v_claim_id, p_actor_id)
        and app_private.can_read_claim(v_claim_id, v_h.recipient_id)
      ) then
        raise exception 'ACCESS_VALIDATION_FAILED';
      end if;

      if v_claim_ev_state = 'conflicting' then v_curr_strength := 1;
      elsif v_claim_ev_state = 'needs_confirmation' then v_curr_strength := 2;
      elsif v_claim_ev_state = 'supported' then v_curr_strength := 3;
      else v_curr_strength := 4;
      end if;

      if v_curr_strength < v_min_strength then
        v_min_strength := v_curr_strength;
      end if;
    end loop;

    if v_min_strength = 1 then v_evidence_state := 'conflicting';
    elsif v_min_strength = 2 then v_evidence_state := 'needs_confirmation';
    elsif v_min_strength = 3 then v_evidence_state := 'supported';
    else v_evidence_state := 'corroborated';
    end if;
  else
    v_evidence_state := 'unknown';
  end if;

  if p_ordinal is null or p_ordinal < 0 then
    select coalesce(max(ordinal) + 1, 0) into v_ordinal
    from public.handover_items
    where handover_id = p_handover_id and section = p_section;
  else
    v_ordinal := p_ordinal;
  end if;

  v_item_id := gen_random_uuid();

  insert into public.handover_items (
    id,
    handover_id,
    project_id,
    section,
    ordinal,
    text,
    item_kind,
    evidence_state,
    review_state,
    row_version
  ) values (
    v_item_id,
    p_handover_id,
    v_h.project_id,
    p_section,
    v_ordinal,
    p_text,
    p_item_kind,
    v_evidence_state,
    'pending',
    1
  );

  if p_claim_ids is not null and array_length(p_claim_ids, 1) > 0 then
    foreach v_claim_id in array p_claim_ids loop
      insert into public.handover_item_claims (
        item_id,
        project_id,
        claim_id
      ) values (
        v_item_id,
        v_h.project_id,
        v_claim_id
      ) on conflict do nothing;
    end loop;
  end if;

  update public.handovers
  set row_version = row_version + 1, updated_at = now()
  where id = p_handover_id;

  perform app_private.write_audit_event(
    v_org_id,
    v_h.project_id,
    p_actor_id,
    'add_item',
    'handover_item',
    v_item_id,
    jsonb_build_object('handover_id', p_handover_id, 'section', p_section)
  );

  return jsonb_build_object(
    'itemId', v_item_id,
    'handoverId', p_handover_id,
    'section', p_section,
    'ordinal', v_ordinal,
    'itemKind', p_item_kind,
    'evidenceState', v_evidence_state,
    'reviewState', 'pending',
    'rowVersion', 1
  );
end;
$$;

-- ─── 4. attach_claims ────────────────────────────────────────────────────────

create or replace function app_private.attach_claims(
  p_actor_id uuid,
  p_handover_id uuid,
  p_item_id uuid,
  p_claim_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_claim_id uuid;
  v_claim_ev_state text;
  v_min_strength integer;
  v_curr_strength integer;
  v_new_ev_state text;
begin
  select
    hi.*,
    h.project_id,
    h.recipient_id,
    h.status as handover_status,
    h.generated_access_epoch,
    p.access_epoch,
    p.organisation_id
  into v_rec
  from public.handover_items hi
  join public.handovers h on h.id = hi.handover_id
  join public.projects p on p.id = h.project_id
  where hi.id = p_item_id and hi.handover_id = p_handover_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_rec.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_rec.handover_status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  if v_rec.generated_access_epoch <> v_rec.access_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  v_min_strength := 4;

  foreach v_claim_id in array p_claim_ids loop
    select c.evidence_state into v_claim_ev_state
    from public.claims c
    where c.id = v_claim_id and c.project_id = v_rec.project_id;

    if not found then
      raise exception 'CLAIM_NOT_FOUND';
    end if;

    if not (
      app_private.can_read_claim(v_claim_id, p_actor_id)
      and app_private.can_read_claim(v_claim_id, v_rec.recipient_id)
    ) then
      raise exception 'ACCESS_VALIDATION_FAILED';
    end if;

    insert into public.handover_item_claims (
      item_id,
      project_id,
      claim_id
    ) values (
      p_item_id,
      v_rec.project_id,
      v_claim_id
    ) on conflict do nothing;
  end loop;

  -- Recalculate weakest evidence_state among all claims attached to item
  for v_claim_ev_state in
    select c.evidence_state
    from public.handover_item_claims hic
    join public.claims c on c.id = hic.claim_id
    where hic.item_id = p_item_id
  loop
    if v_claim_ev_state = 'conflicting' then v_curr_strength := 1;
    elsif v_claim_ev_state = 'needs_confirmation' then v_curr_strength := 2;
    elsif v_claim_ev_state = 'supported' then v_curr_strength := 3;
    else v_curr_strength := 4;
    end if;

    if v_curr_strength < v_min_strength then
      v_min_strength := v_curr_strength;
    end if;
  end loop;

  if v_min_strength = 1 then v_new_ev_state := 'conflicting';
  elsif v_min_strength = 2 then v_new_ev_state := 'needs_confirmation';
  elsif v_min_strength = 3 then v_new_ev_state := 'supported';
  else v_new_ev_state := 'corroborated';
  end if;

  -- Never raise evidence state above human downgrade or prior state
  if v_rec.evidence_state in ('needs_confirmation', 'conflicting') then
    if v_rec.evidence_state = 'conflicting' then
      v_new_ev_state := 'conflicting';
    elsif v_new_ev_state in ('supported', 'corroborated') then
      v_new_ev_state := 'needs_confirmation';
    end if;
  end if;

  update public.handover_items
  set
    evidence_state = v_new_ev_state,
    row_version = row_version + 1
  where id = p_item_id;

  perform app_private.write_audit_event(
    v_rec.organisation_id,
    v_rec.project_id,
    p_actor_id,
    'attach_claims',
    'handover_item',
    p_item_id,
    jsonb_build_object('handover_id', p_handover_id, 'claims', p_claim_ids)
  );

  return jsonb_build_object(
    'itemId', p_item_id,
    'evidenceState', v_new_ev_state,
    'rowVersion', v_rec.row_version + 1
  );
end;
$$;

-- ─── 5. flag_item ────────────────────────────────────────────────────────────

create or replace function app_private.flag_item(
  p_actor_id uuid,
  p_handover_id uuid,
  p_item_id uuid,
  p_reason text,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rec record;
  v_new_ev_state text;
begin
  select
    hi.*,
    h.project_id,
    h.status as handover_status,
    h.generated_access_epoch,
    p.access_epoch,
    p.organisation_id
  into v_rec
  from public.handover_items hi
  join public.handovers h on h.id = hi.handover_id
  join public.projects p on p.id = h.project_id
  where hi.id = p_item_id and hi.handover_id = p_handover_id
  for update;

  if not found then
    raise exception 'ITEM_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_rec.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_rec.handover_status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  if v_rec.generated_access_epoch <> v_rec.access_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  -- Downgrade only (SPEC 2A.5 item 1)
  if p_reason in ('contradiction', 'conflicting') then
    v_new_ev_state := 'conflicting';
  else
    v_new_ev_state := 'needs_confirmation';
  end if;

  update public.handover_items
  set
    evidence_state = v_new_ev_state,
    row_version = row_version + 1
  where id = p_item_id;

  insert into public.reviews (
    handover_id,
    project_id,
    item_id,
    reviewer_id,
    action,
    comment
  ) values (
    p_handover_id,
    v_rec.project_id,
    p_item_id,
    p_actor_id,
    'flag',
    coalesce(p_comment, p_reason)
  );

  perform app_private.write_audit_event(
    v_rec.organisation_id,
    v_rec.project_id,
    p_actor_id,
    'flag_item',
    'handover_item',
    p_item_id,
    jsonb_build_object(
      'handover_id', p_handover_id,
      'reason', p_reason,
      'evidence_state', v_new_ev_state
    )
  );

  return jsonb_build_object(
    'itemId', p_item_id,
    'evidenceState', v_new_ev_state,
    'rowVersion', v_rec.row_version + 1
  );
end;
$$;

-- ─── 6. add_reviewer_context ─────────────────────────────────────────────────

create or replace function app_private.add_reviewer_context(
  p_actor_id uuid,
  p_handover_id uuid,
  p_title text,
  p_content text,
  p_format text,
  p_visibility text,
  p_grant_user_ids uuid[] default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id uuid;
  v_source_id uuid;
  v_job_id uuid;
  v_chunk_id uuid;
  v_payload_hash text;
  v_content_len integer;
begin
  select * into v_h
  from public.handovers
  where id = p_handover_id
  for update;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_h.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_h.status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = v_h.project_id;

  if v_h.generated_access_epoch <> v_current_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  v_content_len := char_length(p_content);
  v_source_id := gen_random_uuid();
  v_chunk_id := gen_random_uuid();

  -- Insert source
  insert into public.sources (
    id,
    project_id,
    imported_by,
    title,
    source_type,
    access_mode,
    author_label,
    canonical_content,
    content_sha256
  ) values (
    v_source_id,
    v_h.project_id,
    p_actor_id,
    p_title,
    'reviewer_context',
    p_visibility,
    'Reviewer Context',
    p_content,
    extensions.digest(convert_to(p_content, 'UTF8'), 'sha256')
  );

  -- Insert chunk
  insert into public.source_chunks (
    id,
    source_id,
    project_id,
    ordinal,
    start_offset,
    end_offset,
    content,
    content_sha256
  ) values (
    v_chunk_id,
    v_source_id,
    v_h.project_id,
    0,
    0,
    v_content_len,
    p_content,
    extensions.digest(convert_to(p_content, 'UTF8'), 'sha256')
  );

  -- If restricted, automatically grant author and any specified users
  if p_visibility = 'restricted' then
    insert into public.source_grants (source_id, project_id, user_id, granted_by)
    values (v_source_id, v_h.project_id, p_actor_id, p_actor_id)
    on conflict do nothing;

    if p_grant_user_ids is not null then
      insert into public.source_grants (source_id, project_id, user_id, granted_by)
      select v_source_id, v_h.project_id, unnest(p_grant_user_ids), p_actor_id
      on conflict do nothing;
    end if;
  end if;

  -- Enqueue extraction job
  v_payload_hash := encode(
    extensions.digest(
      convert_to(jsonb_build_object('source_id', v_source_id)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  v_job_id := app_private.enqueue_job(
    v_h.project_id,
    p_actor_id,
    'extract',
    gen_random_uuid()::text,
    v_payload_hash,
    jsonb_build_object('source_id', v_source_id)
  );

  -- Insert review record
  insert into public.reviews (
    handover_id,
    project_id,
    reviewer_id,
    action,
    comment
  ) values (
    p_handover_id,
    v_h.project_id,
    p_actor_id,
    'add_context',
    p_title
  );

  perform app_private.write_audit_event(
    v_org_id,
    v_h.project_id,
    p_actor_id,
    'add_reviewer_context',
    'source',
    v_source_id,
    jsonb_build_object('handover_id', p_handover_id, 'job_id', v_job_id)
  );

  return jsonb_build_object(
    'sourceId', v_source_id,
    'jobId', v_job_id
  );
end;
$$;

-- ─── 7. create_revision ──────────────────────────────────────────────────────

create or replace function app_private.create_revision(
  p_actor_id uuid,
  p_handover_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id uuid;
  v_max_version integer;
  v_new_handover_id uuid;
  v_item record;
  v_new_item_id uuid;
begin
  select * into v_old
  from public.handovers
  where id = p_handover_id
  for update;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_old.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_old.status not in ('approved', 'shared') then
    raise exception 'ILLEGAL_STATE';
  end if;

  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = v_old.project_id
  for update;

  if not (
    app_private.is_project_member(v_old.project_id, v_old.recipient_id)
    and app_private.is_org_member(v_org_id, v_old.recipient_id)
  ) then
    raise exception 'RECIPIENT_NOT_ACTIVE_MEMBER';
  end if;

  -- Revalidate cited claims in non-rejected items
  if exists (
    select 1
    from public.handover_items hi
    join public.handover_item_claims hic on hic.item_id = hi.id
    where hi.handover_id = p_handover_id
      and hi.review_state <> 'rejected'
      and not (
        app_private.can_read_claim(hic.claim_id, p_actor_id)
        and app_private.can_read_claim(hic.claim_id, v_old.recipient_id)
      )
  ) then
    raise exception 'ACCESS_VALIDATION_FAILED';
  end if;

  select coalesce(max(version), 1) into v_max_version
  from public.handovers
  where root_id = v_old.root_id;

  v_new_handover_id := gen_random_uuid();

  insert into public.handovers (
    id,
    project_id,
    root_id,
    version,
    title,
    recipient_id,
    departing_user_id,
    created_by,
    status,
    configuration,
    generated_access_epoch,
    model_name,
    prompt_version,
    row_version
  ) values (
    v_new_handover_id,
    v_old.project_id,
    v_old.root_id,
    v_max_version + 1,
    v_old.title,
    v_old.recipient_id,
    v_old.departing_user_id,
    p_actor_id,
    'draft',
    v_old.configuration,
    v_current_epoch,
    v_old.model_name,
    v_old.prompt_version,
    1
  );

  -- Copy non-rejected items, resetting review_state to pending
  for v_item in
    select * from public.handover_items
    where handover_id = p_handover_id and review_state <> 'rejected'
    order by section, ordinal
  loop
    v_new_item_id := gen_random_uuid();

    insert into public.handover_items (
      id,
      handover_id,
      project_id,
      section,
      ordinal,
      text,
      item_kind,
      evidence_state,
      review_state,
      original_text,
      edited_by,
      edited_at,
      row_version
    ) values (
      v_new_item_id,
      v_new_handover_id,
      v_old.project_id,
      v_item.section,
      v_item.ordinal,
      v_item.text,
      v_item.item_kind,
      v_item.evidence_state,
      'pending',
      v_item.original_text,
      v_item.edited_by,
      v_item.edited_at,
      1
    );

    insert into public.handover_item_claims (
      item_id,
      project_id,
      claim_id
    )
    select v_new_item_id, v_old.project_id, hic.claim_id
    from public.handover_item_claims hic
    where hic.item_id = v_item.id;
  end loop;

  insert into public.reviews (
    handover_id,
    project_id,
    reviewer_id,
    action,
    comment
  ) values (
    v_new_handover_id,
    v_old.project_id,
    p_actor_id,
    'create_version',
    'Created revision from version ' || v_old.version
  );

  perform app_private.write_audit_event(
    v_org_id,
    v_old.project_id,
    p_actor_id,
    'create_revision',
    'handover',
    v_new_handover_id,
    jsonb_build_object('parent_version', v_old.version, 'new_version', v_max_version + 1)
  );

  return jsonb_build_object(
    'handoverId', v_new_handover_id,
    'version', v_max_version + 1,
    'rowVersion', 1
  );
end;
$$;

-- ─── 8. approve_handover ─────────────────────────────────────────────────────

create or replace function app_private.approve_handover(
  p_actor_id uuid,
  p_handover_id uuid,
  p_confirm_reviewed_for_recipient boolean,
  p_comment text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id uuid;
  v_approved_count integer;
  v_pending_count integer;
  v_invalid_evidence_count integer;
begin
  if not coalesce(p_confirm_reviewed_for_recipient, false) then
    raise exception 'CONFIRMATION_REQUIRED';
  end if;

  select * into v_h
  from public.handovers
  where id = p_handover_id
  for update;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_h.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_h.status <> 'draft' then
    raise exception 'ILLEGAL_STATE';
  end if;

  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = v_h.project_id
  for update;

  if v_h.generated_access_epoch <> v_current_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  if not (
    app_private.is_project_member(v_h.project_id, v_h.recipient_id)
    and app_private.is_org_member(v_org_id, v_h.recipient_id)
  ) then
    raise exception 'RECIPIENT_NOT_ACTIVE_MEMBER';
  end if;

  -- Check no pending items
  select count(*) into v_pending_count
  from public.handover_items
  where handover_id = p_handover_id and review_state = 'pending';

  if v_pending_count > 0 then
    raise exception 'PENDING_ITEMS_EXIST';
  end if;

  -- Check at least 1 approved item
  select count(*) into v_approved_count
  from public.handover_items
  where handover_id = p_handover_id and review_state = 'approved';

  if v_approved_count = 0 then
    raise exception 'NO_APPROVED_ITEMS';
  end if;

  -- Check every approved fact/suggestion has at least 1 claim
  select count(*) into v_invalid_evidence_count
  from public.handover_items hi
  where hi.handover_id = p_handover_id
    and hi.review_state = 'approved'
    and hi.item_kind in ('fact', 'suggestion')
    and not exists (
      select 1
      from public.handover_item_claims hic
      where hic.item_id = hi.id
    );

  if v_invalid_evidence_count > 0 then
    raise exception 'FACTS_REQUIRE_EVIDENCE';
  end if;

  -- Revalidate claim access for reviewer and recipient
  if exists (
    select 1
    from public.handover_items hi
    join public.handover_item_claims hic on hic.item_id = hi.id
    where hi.handover_id = p_handover_id
      and hi.review_state <> 'rejected'
      and not (
        app_private.can_read_claim(hic.claim_id, p_actor_id)
        and app_private.can_read_claim(hic.claim_id, v_h.recipient_id)
      )
  ) then
    raise exception 'ACCESS_VALIDATION_FAILED';
  end if;

  update public.handovers
  set
    status = 'approved',
    approved_by = p_actor_id,
    approved_at = now(),
    approved_access_epoch = v_current_epoch,
    updated_at = now()
  where id = p_handover_id;

  insert into public.reviews (
    handover_id,
    project_id,
    reviewer_id,
    action,
    comment,
    confirmed_reviewed_for_recipient
  ) values (
    p_handover_id,
    v_h.project_id,
    p_actor_id,
    'approve_version',
    p_comment,
    true
  );

  perform app_private.write_audit_event(
    v_org_id,
    v_h.project_id,
    p_actor_id,
    'approve_handover',
    'handover',
    p_handover_id,
    jsonb_build_object('version', v_h.version, 'approved_access_epoch', v_current_epoch)
  );

  return jsonb_build_object(
    'handoverId', p_handover_id,
    'status', 'approved',
    'approvedAccessEpoch', v_current_epoch,
    'approvedAt', now()
  );
end;
$$;

-- ─── 9. share_handover ───────────────────────────────────────────────────────

create or replace function app_private.share_handover(
  p_actor_id uuid,
  p_handover_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers%rowtype;
  v_current_epoch bigint;
  v_org_id uuid;
begin
  select * into v_h
  from public.handovers
  where id = p_handover_id
  for update;

  if not found then
    raise exception 'HANDOVER_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_h.project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if v_h.status <> 'approved' then
    raise exception 'ILLEGAL_STATE';
  end if;

  select access_epoch, organisation_id
  into v_current_epoch, v_org_id
  from public.projects
  where id = v_h.project_id
  for update;

  if v_h.generated_access_epoch <> v_current_epoch or v_h.approved_access_epoch <> v_current_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  if not (
    app_private.is_project_member(v_h.project_id, v_h.recipient_id)
    and app_private.is_org_member(v_org_id, v_h.recipient_id)
  ) then
    raise exception 'RECIPIENT_NOT_ACTIVE_MEMBER';
  end if;

  -- Revalidate claim access for recipient
  if exists (
    select 1
    from public.handover_items hi
    join public.handover_item_claims hic on hic.item_id = hi.id
    where hi.handover_id = p_handover_id
      and hi.review_state <> 'rejected'
      and not app_private.can_read_claim(hic.claim_id, v_h.recipient_id)
  ) then
    raise exception 'ACCESS_VALIDATION_FAILED';
  end if;

  -- Mark previously shared versions of the same root as superseded (SPEC 2A.4 item 8)
  update public.handovers
  set status = 'superseded', updated_at = now()
  where root_id = v_h.root_id
    and status = 'shared'
    and id <> p_handover_id;

  -- Update target handover to shared
  update public.handovers
  set
    status = 'shared',
    shared_by = p_actor_id,
    shared_at = now(),
    updated_at = now()
  where id = p_handover_id;

  insert into public.reviews (
    handover_id,
    project_id,
    reviewer_id,
    action
  ) values (
    p_handover_id,
    v_h.project_id,
    p_actor_id,
    'share'
  );

  perform app_private.write_audit_event(
    v_org_id,
    v_h.project_id,
    p_actor_id,
    'share_handover',
    'handover',
    p_handover_id,
    jsonb_build_object('version', v_h.version, 'recipient_id', v_h.recipient_id)
  );

  return jsonb_build_object(
    'handoverId', p_handover_id,
    'status', 'shared',
    'sharedAt', now()
  );
end;
$$;

-- ─── Privilege restrictions ──────────────────────────────────────────────────

grant execute on function app_private.create_handover_draft_from_generation to service_role;
revoke execute on function app_private.create_handover_draft_from_generation from public, anon, authenticated;

grant execute on function app_private.update_item to service_role;
revoke execute on function app_private.update_item from public, anon, authenticated;

grant execute on function app_private.add_item_from_claims to service_role;
revoke execute on function app_private.add_item_from_claims from public, anon, authenticated;

grant execute on function app_private.attach_claims to service_role;
revoke execute on function app_private.attach_claims from public, anon, authenticated;

grant execute on function app_private.flag_item to service_role;
revoke execute on function app_private.flag_item from public, anon, authenticated;

grant execute on function app_private.add_reviewer_context to service_role;
revoke execute on function app_private.add_reviewer_context from public, anon, authenticated;

grant execute on function app_private.create_revision to service_role;
revoke execute on function app_private.create_revision from public, anon, authenticated;

grant execute on function app_private.approve_handover to service_role;
revoke execute on function app_private.approve_handover from public, anon, authenticated;

grant execute on function app_private.share_handover to service_role;
revoke execute on function app_private.share_handover from public, anon, authenticated;
