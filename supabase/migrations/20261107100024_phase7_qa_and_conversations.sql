-- ─── Phase 7: Evidence-grounded Q&A and Conversations ────────────────────────

-- ─── create_conversation ───────────────────────────────────────────────────
create or replace function app_private.create_conversation(
  p_actor_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_conv_id uuid;
  v_created_at timestamptz;
begin
  -- 1. Verify project exists and caller is active project and org member
  select organisation_id into v_org_id
  from public.projects
  where id = p_project_id;

  if v_org_id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  if not app_private.is_project_member(p_project_id, p_actor_id) then
    raise exception 'NOT_PROJECT_MEMBER';
  end if;

  if not app_private.is_org_member(v_org_id, p_actor_id) then
    raise exception 'NOT_ACTIVE_ORG_MEMBER';
  end if;

  -- 2. Insert conversation row (conversations are strictly owned by actor_id)
  v_conv_id := gen_random_uuid();
  v_created_at := clock_timestamp();

  insert into public.conversations (
    id,
    project_id,
    user_id,
    created_at
  ) values (
    v_conv_id,
    p_project_id,
    p_actor_id,
    v_created_at
  );

  -- 3. Write audit event
  perform app_private.write_audit_event(
    v_org_id,
    p_project_id,
    p_actor_id,
    'conversation.create',
    'conversation',
    v_conv_id,
    jsonb_build_object('created_at', v_created_at)
  );

  return jsonb_build_object(
    'id', v_conv_id,
    'projectId', p_project_id,
    'userId', p_actor_id,
    'createdAt', v_created_at
  );
end;
$$;

revoke all on function app_private.create_conversation(uuid, uuid) from public, anon, authenticated;
grant execute on function app_private.create_conversation(uuid, uuid) to service_role;

-- ─── record_message ─────────────────────────────────────────────────────────
create or replace function app_private.record_message(
  p_actor_id uuid,
  p_conversation_id uuid,
  p_role text,
  p_body jsonb,
  p_access_epoch bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_id uuid;
  v_org_id uuid;
  v_current_epoch bigint;
  v_msg_id uuid;
  v_created_at timestamptz;
begin
  -- 1. Validate role
  if p_role not in ('user', 'assistant') then
    raise exception 'INVALID_ROLE';
  end if;

  -- 2. Verify conversation exists and is owned by caller
  select project_id into v_project_id
  from public.conversations
  where id = p_conversation_id
    and user_id = p_actor_id;

  if v_project_id is null then
    raise exception 'CONVERSATION_NOT_FOUND';
  end if;

  -- 3. Verify project and active memberships
  select organisation_id into v_org_id
  from public.projects
  where id = v_project_id;

  if not app_private.is_project_member(v_project_id, p_actor_id) then
    raise exception 'NOT_PROJECT_MEMBER';
  end if;

  if not app_private.is_org_member(v_org_id, p_actor_id) then
    raise exception 'NOT_ACTIVE_ORG_MEMBER';
  end if;

  -- 4. Verify project access epoch matches
  select access_epoch into v_current_epoch
  from public.projects
  where id = v_project_id;

  if p_access_epoch <> v_current_epoch then
    raise exception 'STALE_ACCESS_EPOCH';
  end if;

  -- 5. Insert conversation message
  v_msg_id := gen_random_uuid();
  v_created_at := clock_timestamp();

  insert into public.conversation_messages (
    id,
    conversation_id,
    project_id,
    role,
    body,
    access_epoch,
    created_at
  ) values (
    v_msg_id,
    p_conversation_id,
    v_project_id,
    p_role,
    p_body,
    p_access_epoch,
    v_created_at
  );

  return jsonb_build_object(
    'messageId', v_msg_id,
    'conversationId', p_conversation_id,
    'projectId', v_project_id,
    'role', p_role,
    'accessEpoch', p_access_epoch,
    'createdAt', v_created_at
  );
end;
$$;

revoke all on function app_private.record_message(uuid, uuid, text, jsonb, bigint) from public, anon, authenticated;
grant execute on function app_private.record_message(uuid, uuid, text, jsonb, bigint) to service_role;
