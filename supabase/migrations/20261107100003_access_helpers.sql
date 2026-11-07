-- Migration: access_helpers
-- app_private helper functions used by RLS policies.
-- TRUST BOUNDARY noted on each SECURITY DEFINER function.
-- All functions: empty search_path, schema-qualified references, no dynamic SQL.

-- ─── is_org_member ───────────────────────────────────────────────────────────
-- Returns true if the given user is an active member of the organisation.
create or replace function app_private.is_org_member(
  p_organisation_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = p_organisation_id
      and om.user_id = p_user_id
      and om.active = true
  );
$$;

-- ─── is_org_admin ────────────────────────────────────────────────────────────
-- Returns true if the given user is an active owner or admin of the organisation.
create or replace function app_private.is_org_admin(
  p_organisation_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.organisation_members om
    where om.organisation_id = p_organisation_id
      and om.user_id = p_user_id
      and om.active = true
      and om.role in ('owner', 'admin')
  );
$$;

-- ─── is_project_member ───────────────────────────────────────────────────────
-- Returns true if the given user is an active member of the project.
create or replace function app_private.is_project_member(
  p_project_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.active = true
  );
$$;

-- ─── has_project_role ────────────────────────────────────────────────────────
-- Returns true if the given user has an active membership with one of the
-- specified roles in the project.
create or replace function app_private.has_project_role(
  p_project_id uuid,
  p_user_id uuid,
  p_roles text[]
) returns boolean
language sql stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = p_user_id
      and pm.active = true
      and pm.role = any(p_roles)
  );
$$;

-- ─── can_read_source ─────────────────────────────────────────────────────────
-- TRUST BOUNDARY: This function reads organisation_members, project_members,
-- sources, and source_grants across row visibility. It is SECURITY DEFINER so
-- that RLS policies on those tables do not recursively apply when evaluating
-- source access. The caller is any authenticated user; this function may read
-- rows the caller cannot directly access to determine access rights.
create or replace function app_private.can_read_source(
  p_source_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sources s
    join public.projects p on p.id = s.project_id
    where s.id = p_source_id
      and s.archived_at is null
      -- user must be an active org member
      and app_private.is_org_member(p.organisation_id, p_user_id)
      -- user must be an active project member
      and app_private.is_project_member(s.project_id, p_user_id)
      -- visibility: project-wide or explicitly granted
      and (
        s.visibility = 'project'
        or exists (
          select 1
          from public.source_grants sg
          where sg.source_id = p_source_id
            and sg.user_id = p_user_id
        )
      )
  );
$$;

-- ─── can_read_claim ──────────────────────────────────────────────────────────
-- TRUST BOUNDARY: This function reads claims, claim_evidence, and source access
-- across row visibility. It is SECURITY DEFINER to avoid recursive RLS when
-- checking evidence sources. The caller is any authenticated user; this
-- function may inspect rows the caller cannot directly access.
create or replace function app_private.can_read_claim(
  p_claim_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.claims c
    join public.projects p on p.id = c.project_id
    where c.id = p_claim_id
      -- user must be active org and project member
      and app_private.is_org_member(p.organisation_id, p_user_id)
      and app_private.is_project_member(c.project_id, p_user_id)
      -- at least one evidence link must exist
      and exists (
        select 1 from public.claim_evidence ce where ce.claim_id = p_claim_id
      )
      -- every linked evidence source must be readable
      and not exists (
        select 1
        from public.claim_evidence ce
        join public.source_chunks sc on sc.id = ce.chunk_id
        where ce.claim_id = p_claim_id
          and not app_private.can_read_source(sc.source_id, p_user_id)
      )
  );
$$;

-- ─── can_read_question ───────────────────────────────────────────────────────
-- TRUST BOUNDARY: Reads clarification_questions and question_claims. SECURITY
-- DEFINER to avoid recursive RLS when checking linked claims. Caller is any
-- authenticated user.
create or replace function app_private.can_read_question(
  p_question_id uuid,
  p_user_id uuid
) returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clarification_questions q
    join public.projects p on p.id = q.project_id
    where q.id = p_question_id
      and app_private.is_org_member(p.organisation_id, p_user_id)
      and app_private.is_project_member(q.project_id, p_user_id)
      and (
        -- the question was created for this user
        q.created_for = p_user_id
        -- or the user is an owner or reviewer
        or app_private.has_project_role(q.project_id, p_user_id, array['owner', 'reviewer'])
      )
      -- every linked claim must be readable by this user
      and not exists (
        select 1
        from public.question_claims qc
        where qc.question_id = p_question_id
          and not app_private.can_read_claim(qc.claim_id, p_user_id)
      )
  );
$$;

-- ─── can_read_handover ───────────────────────────────────────────────────────
-- TRUST BOUNDARY: Reads handovers and projects. SECURITY DEFINER to avoid
-- recursive RLS. Caller is any authenticated user.
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
        (
          h.status in ('draft', 'approved')
          and app_private.has_project_role(h.project_id, p_user_id, array['owner', 'reviewer'])
        )
        -- recipient: shared status, identity match, epoch matches, memberships active
        or (
          h.status = 'shared'
          and h.recipient_id = p_user_id
          and h.generated_access_epoch = p.access_epoch
          and h.approved_access_epoch = p.access_epoch
        )
        -- any project member can read a shared handover addressed to them or in reviewer role
        or (
          h.status = 'shared'
          and app_private.has_project_role(h.project_id, p_user_id, array['owner', 'reviewer'])
          and h.generated_access_epoch = p.access_epoch
          and h.approved_access_epoch = p.access_epoch
        )
      )
  );
$$;

-- ─── can_read_handover_item ──────────────────────────────────────────────────
-- TRUST BOUNDARY: Reads handover_items and delegates to can_read_handover.
-- SECURITY DEFINER to avoid recursive RLS. Caller is any authenticated user.
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
    where hi.id = p_item_id
      and app_private.can_read_handover(hi.handover_id, p_user_id)
  );
$$;

-- Grant execute on helper functions to authenticated (needed for RLS policies).
-- Mutation functions will separately revoke from authenticated after M14.
grant execute on function app_private.is_org_member(uuid, uuid) to authenticated;
grant execute on function app_private.is_org_admin(uuid, uuid) to authenticated;
grant execute on function app_private.is_project_member(uuid, uuid) to authenticated;
grant execute on function app_private.has_project_role(uuid, uuid, text[]) to authenticated;
grant execute on function app_private.can_read_source(uuid, uuid) to authenticated;
grant execute on function app_private.can_read_claim(uuid, uuid) to authenticated;
grant execute on function app_private.can_read_question(uuid, uuid) to authenticated;
grant execute on function app_private.can_read_handover(uuid, uuid) to authenticated;
grant execute on function app_private.can_read_handover_item(uuid, uuid) to authenticated;
