-- Migration: Fix app_private.flag_claim to include project_id on claim_flags insert
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
    project_id,
    claim_id,
    flagged_by,
    reason
  ) values (
    v_project_id,
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

revoke execute on function app_private.flag_claim(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function app_private.flag_claim(uuid, uuid, text, text) to service_role;
