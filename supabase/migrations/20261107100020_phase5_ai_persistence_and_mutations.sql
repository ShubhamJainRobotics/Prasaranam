-- Migration: phase5_ai_persistence_and_mutations
-- Provides transactional persistence and mutation functions for AI extraction,
-- relationship analysis, clarification questions, and claims lifecycle.

-- 1. app_private.persist_claims
create or replace function app_private.persist_claims(
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_claims jsonb,
  p_access_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Called by service_role from the worker or API to persist
-- semantically validated claims and evidence for a project. Validates access epoch.
declare
  v_current_epoch bigint;
  v_claim_elem jsonb;
  v_ev_elem jsonb;
  v_claim_id uuid;
  v_dedupe_key text;
  v_evidence_triples text;
  v_inserted_count integer := 0;
  v_existing_count integer := 0;
begin
  -- Lock project and verify access epoch
  select access_epoch into v_current_epoch
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_current_epoch <> p_access_epoch then
    raise exception 'STALE_CONTEXT';
  end if;

  -- Iterate through each claim in the batch
  for v_claim_elem in select * from jsonb_array_elements(p_claims) loop
    -- Compute sorted evidence triples representation: chunk_id:quote_start:quote_end
    select coalesce(string_agg(
      (ev->>'chunkId') || ':' || (ev->>'quoteStart') || ':' || (ev->>'quoteEnd'),
      ',' order by (ev->>'chunkId'), (ev->>'quoteStart')::integer
    ), '')
    into v_evidence_triples
    from jsonb_array_elements(v_claim_elem->'evidence') as ev;

    -- dedupe_key per Section 2A.11 item 4: SHA-256 of kind, whitespace-collapsed lowercase statement, and evidence triples
    v_dedupe_key := extensions.digest(
      (v_claim_elem->>'kind') || ':' ||
      lower(regexp_replace(trim(v_claim_elem->>'statement'), '\s+', ' ', 'g')) || ':' ||
      v_evidence_triples,
      'sha256'
    )::text;

    -- Insert claim with ON CONFLICT DO NOTHING
    insert into public.claims (
      project_id,
      kind,
      statement,
      work_state,
      evidence_state,
      owner_label,
      observed_at,
      dedupe_key,
      model_name,
      prompt_version
    ) values (
      p_project_id,
      v_claim_elem->>'kind',
      v_claim_elem->>'statement',
      coalesce(v_claim_elem->>'workState', 'unknown'),
      v_claim_elem->>'evidenceState',
      v_claim_elem->>'ownerLabel',
      (v_claim_elem->>'observedAt')::timestamptz,
      v_dedupe_key,
      v_claim_elem->>'modelName',
      coalesce(v_claim_elem->>'promptVersion', 'extraction-v1')
    )
    on conflict (project_id, dedupe_key) where archived_at is null
    do nothing
    returning id into v_claim_id;

    if v_claim_id is not null then
      v_inserted_count := v_inserted_count + 1;
    else
      v_existing_count := v_existing_count + 1;
      select id into v_claim_id
      from public.claims
      where project_id = p_project_id
        and dedupe_key = v_dedupe_key
        and archived_at is null;
    end if;

    -- Insert evidence entries for the claim
    if v_claim_id is not null then
      for v_ev_elem in select * from jsonb_array_elements(v_claim_elem->'evidence') loop
        insert into public.claim_evidence (
          project_id,
          claim_id,
          chunk_id,
          quote,
          quote_start,
          quote_end
        ) values (
          p_project_id,
          v_claim_id,
          (v_ev_elem->>'chunkId')::uuid,
          v_ev_elem->>'quote',
          (v_ev_elem->>'quoteStart')::integer,
          (v_ev_elem->>'quoteEnd')::integer
        )
        on conflict (claim_id, chunk_id, quote_start, quote_end)
        do nothing;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', v_inserted_count,
    'existing', v_existing_count
  );
end;
$$;

-- 2. app_private.persist_relationships
create or replace function app_private.persist_relationships(
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_relationships jsonb,
  p_conflicts jsonb,
  p_access_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Called by service_role from the worker to persist validated
-- relationships, contradictions, supersessions, and generated conflicts.
declare
  v_current_epoch bigint;
  v_rel_elem jsonb;
  v_conf_elem jsonb;
  v_from_id uuid;
  v_to_id uuid;
  v_rel text;
  v_explanation text;
  v_rel_count integer := 0;
  v_conf_count integer := 0;
  v_question_id uuid;
  v_question_text text;
  v_sorted_claim_ids text;
  v_dedupe_key text;
  v_cid uuid;
begin
  -- Lock project and verify access epoch
  select access_epoch into v_current_epoch
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_current_epoch <> p_access_epoch then
    raise exception 'STALE_CONTEXT';
  end if;

  -- 1. Insert Relationships
  for v_rel_elem in select * from jsonb_array_elements(p_relationships) loop
    v_from_id := (v_rel_elem->>'fromClaimId')::uuid;
    v_to_id := (v_rel_elem->>'toClaimId')::uuid;
    v_rel := v_rel_elem->>'relation';
    v_explanation := v_rel_elem->>'explanation';

    -- Trigger enforce_symmetric_relation_order handles from_claim_id < to_claim_id for symmetric relations
    insert into public.claim_relationships (
      project_id,
      from_claim_id,
      to_claim_id,
      relation,
      explanation
    ) values (
      p_project_id,
      v_from_id,
      v_to_id,
      v_rel,
      v_explanation
    )
    on conflict (from_claim_id, to_claim_id, relation)
    do update set explanation = excluded.explanation;

    v_rel_count := v_rel_count + 1;

    -- Contradiction lowers evidence_state to conflicting (Section 2A.5 / 2A.8)
    if v_rel = 'contradicts' then
      update public.claims
      set evidence_state = 'conflicting'
      where id in (v_from_id, v_to_id)
        and project_id = p_project_id;
    end if;

    -- Supersedes sets target claim's work_state to superseded
    if v_rel = 'supersedes' then
      update public.claims
      set work_state = 'superseded'
      where id = v_to_id
        and project_id = p_project_id;
    end if;
  end loop;

  -- 2. Insert Conflicts as Clarification Questions
  for v_conf_elem in select * from jsonb_array_elements(p_conflicts) loop
    v_question_text := v_conf_elem->>'clarificationQuestion';

    -- Extract sorted claim IDs string
    select string_agg(cid::text, ',' order by cid::text)
    into v_sorted_claim_ids
    from jsonb_array_elements_text(v_conf_elem->'claimIds') as cid;

    -- dedupe_key: SHA-256 of question text + sorted claim IDs (Section 2A.8 item 4)
    v_dedupe_key := extensions.digest(
      lower(regexp_replace(trim(v_question_text), '\s+', ' ', 'g')) || ':' || v_sorted_claim_ids,
      'sha256'
    )::text;

    insert into public.clarification_questions (
      project_id,
      created_for,
      question,
      reason,
      priority,
      dedupe_key,
      status
    ) values (
      p_project_id,
      p_actor_id,
      v_question_text,
      v_conf_elem->>'description',
      'high',
      v_dedupe_key,
      'open'
    )
    on conflict (project_id, dedupe_key) where status = 'open'
    do nothing
    returning id into v_question_id;

    if v_question_id is null then
      select id into v_question_id
      from public.clarification_questions
      where project_id = p_project_id
        and dedupe_key = v_dedupe_key
        and status = 'open';
    end if;

    if v_question_id is not null then
      v_conf_count := v_conf_count + 1;
      for v_cid in select (jsonb_array_elements_text(v_conf_elem->'claimIds'))::uuid loop
        insert into public.question_claims (
          question_id,
          project_id,
          claim_id
        ) values (
          v_question_id,
          p_project_id,
          v_cid
        )
        on conflict do nothing;
      end loop;
    end if;
  end loop;

  return jsonb_build_object(
    'relationships', v_rel_count,
    'conflicts', v_conf_count
  );
end;
$$;

-- 3. app_private.persist_questions
create or replace function app_private.persist_questions(
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_questions jsonb,
  p_created_for uuid,
  p_access_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Called by service_role from the worker to persist generated
-- clarification questions. Deduplicates open questions with dedupe_key.
declare
  v_current_epoch bigint;
  v_q_elem jsonb;
  v_question_text text;
  v_sorted_claim_ids text;
  v_dedupe_key text;
  v_question_id uuid;
  v_cid uuid;
  v_inserted_count integer := 0;
begin
  -- Lock project and verify access epoch
  select access_epoch into v_current_epoch
  from public.projects
  where id = p_project_id
  for update;

  if not found then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if v_current_epoch <> p_access_epoch then
    raise exception 'STALE_CONTEXT';
  end if;

  for v_q_elem in select * from jsonb_array_elements(p_questions) loop
    v_question_text := v_q_elem->>'question';

    select string_agg(cid::text, ',' order by cid::text)
    into v_sorted_claim_ids
    from jsonb_array_elements_text(v_q_elem->'relatedClaimIds') as cid;

    v_dedupe_key := extensions.digest(
      lower(regexp_replace(trim(v_question_text), '\s+', ' ', 'g')) || ':' || coalesce(v_sorted_claim_ids, ''),
      'sha256'
    )::text;

    insert into public.clarification_questions (
      project_id,
      created_for,
      question,
      reason,
      priority,
      dedupe_key,
      status
    ) values (
      p_project_id,
      p_created_for,
      v_question_text,
      v_q_elem->>'reason',
      coalesce(v_q_elem->>'priority', 'medium'),
      v_dedupe_key,
      'open'
    )
    on conflict (project_id, dedupe_key) where status = 'open'
    do nothing
    returning id into v_question_id;

    if v_question_id is not null then
      v_inserted_count := v_inserted_count + 1;
      if v_q_elem->'relatedClaimIds' is not null then
        for v_cid in select (jsonb_array_elements_text(v_q_elem->'relatedClaimIds'))::uuid loop
          insert into public.question_claims (
            question_id,
            project_id,
            claim_id
          ) values (
            v_question_id,
            p_project_id,
            v_cid
          )
          on conflict do nothing;
        end loop;
      end if;
    end if;
  end loop;

  return jsonb_build_object('inserted', v_inserted_count);
end;
$$;

-- 4. app_private.record_ai_usage
create or replace function app_private.record_ai_usage(
  p_actor_id uuid,
  p_project_id uuid,
  p_job_id uuid,
  p_purpose text,
  p_model_name text,
  p_prompt_version text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_latency_ms integer,
  p_outcome text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Called by service_role from the worker or API to log provider
-- token usage and latency without source text, prompts, or response bodies.
declare
  v_id uuid;
begin
  insert into public.ai_usage (
    project_id,
    user_id,
    job_id,
    purpose,
    model_name,
    prompt_version,
    input_tokens,
    output_tokens,
    latency_ms,
    outcome
  ) values (
    p_project_id,
    p_actor_id,
    p_job_id,
    p_purpose,
    p_model_name,
    p_prompt_version,
    p_input_tokens,
    p_output_tokens,
    greatest(0, p_latency_ms),
    p_outcome
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 5. app_private.review_claim
create or replace function app_private.review_claim(
  p_actor_id uuid,
  p_claim_id uuid,
  p_review_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Project owners and reviewers can approve or reject claims.
declare
  v_project_id uuid;
  v_org_id uuid;
  v_old_state text;
begin
  select c.project_id, p.organisation_id, c.review_state
  into v_project_id, v_org_id, v_old_state
  from public.claims c
  join public.projects p on p.id = c.project_id
  where c.id = p_claim_id;

  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  update public.claims
  set review_state = p_review_state
  where id = p_claim_id;

  perform app_private.write_audit_event(
    v_org_id,
    v_project_id,
    p_actor_id,
    'claim_reviewed',
    'claim',
    p_claim_id,
    jsonb_build_object('old_state', v_old_state, 'new_state', p_review_state)
  );

  return jsonb_build_object(
    'claimId', p_claim_id,
    'reviewState', p_review_state
  );
end;
$$;

-- 6. app_private.set_claim_owner
create or replace function app_private.set_claim_owner(
  p_actor_id uuid,
  p_claim_id uuid,
  p_owner_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Links a claim to an active project member. Section 2A.8 item 6.
declare
  v_project_id uuid;
  v_org_id uuid;
begin
  select c.project_id, p.organisation_id
  into v_project_id, v_org_id
  from public.claims c
  join public.projects p on p.id = c.project_id
  where c.id = p_claim_id;

  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  if p_owner_user_id is not null then
    if not app_private.is_project_member(v_project_id, p_owner_user_id) then
      raise exception 'OWNER_NOT_PROJECT_MEMBER';
    end if;
  end if;

  update public.claims
  set owner_user_id = p_owner_user_id
  where id = p_claim_id;

  perform app_private.write_audit_event(
    v_org_id,
    v_project_id,
    p_actor_id,
    'claim_owner_linked',
    'claim',
    p_claim_id,
    jsonb_build_object('ownerUserId', p_owner_user_id)
  );

  return jsonb_build_object(
    'claimId', p_claim_id,
    'ownerUserId', p_owner_user_id
  );
end;
$$;

-- 7. app_private.flag_claim
create or replace function app_private.flag_claim(
  p_actor_id uuid,
  p_claim_id uuid,
  p_reason text,
  p_new_evidence_state text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Flags a claim for doubt or conflict. Lowers evidence state per Section 2A.5.
declare
  v_project_id uuid;
  v_org_id uuid;
  v_flag_id uuid;
begin
  select c.project_id, p.organisation_id
  into v_project_id, v_org_id
  from public.claims c
  join public.projects p on p.id = c.project_id
  where c.id = p_claim_id;

  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;

  if not app_private.has_project_role(v_project_id, p_actor_id, array['owner', 'reviewer']) then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.claim_flags (
    claim_id,
    flagged_by,
    reason
  ) values (
    p_claim_id,
    p_actor_id,
    p_reason
  )
  returning id into v_flag_id;

  -- Lower evidence state if requested
  if p_new_evidence_state in ('needs_confirmation', 'conflicting') then
    update public.claims
    set evidence_state = p_new_evidence_state
    where id = p_claim_id;
  end if;

  perform app_private.write_audit_event(
    v_org_id,
    v_project_id,
    p_actor_id,
    'claim_flagged',
    'claim',
    p_claim_id,
    jsonb_build_object('reason', p_reason, 'newEvidenceState', p_new_evidence_state)
  );

  return jsonb_build_object(
    'flagId', v_flag_id,
    'claimId', p_claim_id,
    'evidenceState', p_new_evidence_state
  );
end;
$$;

-- 8. app_private.dismiss_question
create or replace function app_private.dismiss_question(
  p_actor_id uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Project owners, reviewers, or question creator can dismiss a question.
declare
  v_project_id uuid;
  v_org_id uuid;
  v_created_for uuid;
begin
  select q.project_id, p.organisation_id, q.created_for
  into v_project_id, v_org_id, v_created_for
  from public.clarification_questions q
  join public.projects p on p.id = q.project_id
  where q.id = p_question_id;

  if not found then
    raise exception 'QUESTION_NOT_FOUND';
  end if;

  if not (
    p_actor_id = v_created_for or
    app_private.has_project_role(v_project_id, p_actor_id, array['owner', 'reviewer'])
  ) then
    raise exception 'FORBIDDEN';
  end if;

  update public.clarification_questions
  set status = 'dismissed'
  where id = p_question_id;

  perform app_private.write_audit_event(
    v_org_id,
    v_project_id,
    p_actor_id,
    'question_dismissed',
    'clarification_question',
    p_question_id,
    '{}'::jsonb
  );

  return jsonb_build_object('questionId', p_question_id, 'status', 'dismissed');
end;
$$;

-- 9. app_private.retry_job
create or replace function app_private.retry_job(
  p_actor_id uuid,
  p_job_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- Trust boundary: Section 2A.11 item 5: Retrying a failed job by requester or project owner.
declare
  v_project_id uuid;
  v_org_id uuid;
  v_requested_by uuid;
  v_status text;
begin
  select j.project_id, p.organisation_id, j.requested_by, j.status
  into v_project_id, v_org_id, v_requested_by, v_status
  from public.jobs j
  join public.projects p on p.id = j.project_id
  where j.id = p_job_id;

  if not found then
    raise exception 'JOB_NOT_FOUND';
  end if;

  if not (
    p_actor_id = v_requested_by or
    app_private.has_project_role(v_project_id, p_actor_id, array['owner'])
  ) then
    raise exception 'FORBIDDEN';
  end if;

  if v_status <> 'failed' then
    raise exception 'JOB_NOT_FAILED';
  end if;

  update public.jobs
  set status = 'queued',
      attempts = 0,
      run_after = now(),
      locked_until = null,
      lock_token = null,
      last_error_code = null,
      updated_at = now()
  where id = p_job_id;

  perform app_private.write_audit_event(
    v_org_id,
    v_project_id,
    p_actor_id,
    'job_retried',
    'job',
    p_job_id,
    '{}'::jsonb
  );

  return jsonb_build_object('jobId', p_job_id, 'status', 'queued');
end;
$$;

-- Revoke all permissions and grant strictly to service_role (Section 2A.1)
revoke execute on function app_private.persist_claims(uuid, uuid, uuid, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_private.persist_claims(uuid, uuid, uuid, jsonb, bigint) to service_role;

revoke execute on function app_private.persist_relationships(uuid, uuid, uuid, jsonb, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_private.persist_relationships(uuid, uuid, uuid, jsonb, jsonb, bigint) to service_role;

revoke execute on function app_private.persist_questions(uuid, uuid, uuid, jsonb, uuid, bigint) from public, anon, authenticated;
grant execute on function app_private.persist_questions(uuid, uuid, uuid, jsonb, uuid, bigint) to service_role;

revoke execute on function app_private.record_ai_usage(uuid, uuid, uuid, text, text, text, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function app_private.record_ai_usage(uuid, uuid, uuid, text, text, text, integer, integer, integer, text) to service_role;

revoke execute on function app_private.review_claim(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app_private.review_claim(uuid, uuid, text) to service_role;

revoke execute on function app_private.set_claim_owner(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.set_claim_owner(uuid, uuid, uuid) to service_role;

revoke execute on function app_private.flag_claim(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app_private.flag_claim(uuid, uuid, text, text) to service_role;

revoke execute on function app_private.dismiss_question(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.dismiss_question(uuid, uuid) to service_role;

revoke execute on function app_private.retry_job(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.retry_job(uuid, uuid) to service_role;
