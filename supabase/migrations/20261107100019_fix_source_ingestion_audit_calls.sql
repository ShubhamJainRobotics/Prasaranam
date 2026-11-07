-- Migration: fix_source_ingestion_audit_calls
-- Replaces audit event insertion in source ingestion functions with app_private.write_audit_event
-- using correct entity_type and entity_id column names.

create or replace function app_private.import_source(
  p_actor_id uuid,
  p_project_id uuid,
  p_title text,
  p_kind text,
  p_visibility text,
  p_content text,
  p_content_sha256 text,
  p_original_url text default null,
  p_author_label text default null,
  p_event_at timestamptz default null,
  p_chunks jsonb default '[]'::jsonb,
  p_grant_user_ids uuid[] default '{}'::uuid[],
  p_replaces_source_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation_id uuid;
  v_source_id uuid;
  v_lineage_id uuid;
  v_revision integer := 1;
  v_old_source record;
  v_grant_uid uuid;
  v_chunk_elem jsonb;
begin
  -- Trust boundary: Actor must be an active project member with role in ('owner', 'reviewer', 'contributor')
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner', 'reviewer', 'contributor']) then
    raise exception 'actor % is not authorised to import sources into project %', p_actor_id, p_project_id;
  end if;

  -- Validate project and get organisation_id
  select p.organisation_id into v_organisation_id
  from public.projects p
  where p.id = p_project_id;

  if not found then
    raise exception 'project % not found', p_project_id;
  end if;

  -- Validate visibility
  if p_visibility not in ('project', 'restricted') then
    raise exception 'invalid visibility: %', p_visibility;
  end if;

  -- Validate kind
  if p_kind not in ('text', 'markdown', 'messages', 'issues', 'reviewer_context') then
    raise exception 'invalid source kind: %', p_kind;
  end if;

  -- Handle replace-by-revision
  if p_replaces_source_id is not null then
    -- Per Section 2A.2 line 79, archiving sources requires project owner role
    if not app_private.has_project_role(p_project_id, p_actor_id, array['owner']) then
      raise exception 'only project owners may replace existing sources';
    end if;

    -- Lock and verify old source
    select s.id, s.lineage_id, s.revision, s.visibility
    into v_old_source
    from public.sources s
    where s.id = p_replaces_source_id
      and s.project_id = p_project_id
      and s.archived_at is null
    for update;

    if not found then
      raise exception 'source to replace (%) not found or already archived', p_replaces_source_id;
    end if;

    v_lineage_id := v_old_source.lineage_id;
    v_revision := v_old_source.revision + 1;

    -- Lock project row and archive the replaced source (this fires epoch invalidation)
    update public.projects
    set access_epoch = access_epoch + 1
    where id = p_project_id;

    update public.sources
    set archived_at = now(),
        archived_by = p_actor_id
    where id = p_replaces_source_id;

    perform app_private.write_audit_event(
      v_organisation_id, p_project_id, p_actor_id, 'source_archived', 'source', p_replaces_source_id,
      jsonb_build_object(
        'reason', 'replaced_by_revision',
        'replaces_source_id', p_replaces_source_id,
        'new_revision', v_revision
      )
    );
  else
    v_lineage_id := gen_random_uuid();
    v_revision := 1;
  end if;

  -- Generate new source ID
  v_source_id := gen_random_uuid();

  -- Insert source
  insert into public.sources (
    id, project_id, title, kind, visibility, original_url, author_label, event_at,
    content, content_sha256, revision, lineage_id, processing_status, created_by
  ) values (
    v_source_id, p_project_id, p_title, p_kind, p_visibility, p_original_url, p_author_label, p_event_at,
    p_content, p_content_sha256, v_revision, v_lineage_id, 'ready', p_actor_id
  );

  -- If restricted, add grant for the importer and any explicitly granted members
  if p_visibility = 'restricted' then
    -- Automatic grant for the importer
    insert into public.source_grants (source_id, project_id, user_id)
    values (v_source_id, p_project_id, p_actor_id)
    on conflict do nothing;

    -- Explicit grants
    if p_grant_user_ids is not null then
      foreach v_grant_uid in array p_grant_user_ids loop
        if not app_private.is_project_member(p_project_id, v_grant_uid) then
          raise exception 'granted user % is not an active project member', v_grant_uid;
        end if;
        insert into public.source_grants (source_id, project_id, user_id)
        values (v_source_id, p_project_id, v_grant_uid)
        on conflict do nothing;
      end loop;
    end if;
  end if;

  -- Insert chunks
  if p_chunks is not null and jsonb_array_length(p_chunks) > 0 then
    for v_chunk_elem in select * from jsonb_array_elements(p_chunks) loop
      insert into public.source_chunks (
        source_id,
        project_id,
        ordinal,
        record_ref,
        author_label,
        event_at,
        original_url,
        start_offset,
        end_offset,
        content
      ) values (
        v_source_id,
        p_project_id,
        (v_chunk_elem->>'ordinal')::integer,
        v_chunk_elem->>'recordRef',
        v_chunk_elem->>'authorLabel',
        case
          when v_chunk_elem->>'eventAt' is not null and v_chunk_elem->>'eventAt' <> ''
          then (v_chunk_elem->>'eventAt')::timestamptz
          else null
        end,
        v_chunk_elem->>'originalUrl',
        (v_chunk_elem->>'startOffset')::integer,
        (v_chunk_elem->>'endOffset')::integer,
        v_chunk_elem->>'content'
      );
    end loop;
  end if;

  -- Record audit event using standard helper
  perform app_private.write_audit_event(
    v_organisation_id, p_project_id, p_actor_id, 'source_imported', 'source', v_source_id,
    jsonb_build_object(
      'title', p_title,
      'kind', p_kind,
      'visibility', p_visibility,
      'revision', v_revision,
      'lineage_id', v_lineage_id,
      'chunks_count', coalesce(jsonb_array_length(p_chunks), 0),
      'replaces_source_id', p_replaces_source_id
    )
  );

  return v_source_id;
end;
$$;

create or replace function app_private.set_source_access(
  p_actor_id uuid,
  p_project_id uuid,
  p_source_id uuid,
  p_visibility text,
  p_grant_user_ids uuid[] default '{}'::uuid[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation_id uuid;
  v_old_visibility text;
  v_grant_uid uuid;
begin
  -- Trust boundary: Caller must be project owner (SPEC 2A.2 line 79)
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner']) then
    raise exception 'actor % is not a project owner', p_actor_id;
  end if;

  -- Lock project row to coordinate epoch increment
  select p.organisation_id into v_organisation_id
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'project % not found', p_project_id;
  end if;

  -- Validate and lock source
  select s.visibility into v_old_visibility
  from public.sources s
  where s.id = p_source_id
    and s.project_id = p_project_id
    and s.archived_at is null
  for update;

  if not found then
    raise exception 'source % not found or archived in project %', p_source_id, p_project_id;
  end if;

  if p_visibility not in ('project', 'restricted') then
    raise exception 'invalid visibility: %', p_visibility;
  end if;

  -- Update source visibility
  update public.sources
  set visibility = p_visibility
  where id = p_source_id;

  if p_visibility = 'project' then
    delete from public.source_grants
    where source_id = p_source_id;
  else
    -- Delete any existing grants not in the new list
    delete from public.source_grants
    where source_id = p_source_id
      and not (user_id = any(coalesce(p_grant_user_ids, '{}'::uuid[])));

    -- Insert new grants
    if p_grant_user_ids is not null then
      foreach v_grant_uid in array p_grant_user_ids loop
        if not app_private.is_project_member(p_project_id, v_grant_uid) then
          raise exception 'granted user % is not an active project member', v_grant_uid;
        end if;
        insert into public.source_grants (source_id, project_id, user_id)
        values (p_source_id, p_project_id, v_grant_uid)
        on conflict do nothing;
      end loop;
    end if;
  end if;

  -- Audit event
  perform app_private.write_audit_event(
    v_organisation_id, p_project_id, p_actor_id, 'source_access_updated', 'source', p_source_id,
    jsonb_build_object(
      'old_visibility', v_old_visibility,
      'new_visibility', p_visibility,
      'grants_count', coalesce(array_length(p_grant_user_ids, 1), 0)
    )
  );
end;
$$;

create or replace function app_private.archive_source(
  p_actor_id uuid,
  p_project_id uuid,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_organisation_id uuid;
begin
  -- Trust boundary: Caller must be project owner (SPEC 2A.2 line 79)
  if not app_private.has_project_role(p_project_id, p_actor_id, array['owner']) then
    raise exception 'actor % is not a project owner', p_actor_id;
  end if;

  -- Lock project row
  select p.organisation_id into v_organisation_id
  from public.projects p
  where p.id = p_project_id
  for update;

  if not found then
    raise exception 'project % not found', p_project_id;
  end if;

  -- Lock and update source
  update public.sources
  set archived_at = now(),
      archived_by = p_actor_id
  where id = p_source_id
    and project_id = p_project_id
    and archived_at is null;

  if not found then
    raise exception 'source % not found or already archived in project %', p_source_id, p_project_id;
  end if;

  -- Audit event
  perform app_private.write_audit_event(
    v_organisation_id, p_project_id, p_actor_id, 'source_archived', 'source', p_source_id,
    jsonb_build_object('archived_by', p_actor_id)
  );
end;
$$;
