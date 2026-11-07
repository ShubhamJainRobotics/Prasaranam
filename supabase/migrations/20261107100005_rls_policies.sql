-- Migration: rls_policies
-- Enable RLS on every public application table and define all policies.
-- Policies use (select auth.uid()) to avoid per-row re-evaluation.
-- No INSERT/UPDATE/DELETE policies for authenticated (all mutations via app_private).

-- ─── Enable RLS on every table ───────────────────────────────────────────────
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.sources enable row level security;
alter table public.source_grants enable row level security;
alter table public.source_chunks enable row level security;
alter table public.claims enable row level security;
alter table public.claim_evidence enable row level security;
alter table public.claim_relationships enable row level security;
alter table public.claim_flags enable row level security;
alter table public.clarification_questions enable row level security;
alter table public.question_claims enable row level security;
alter table public.handovers enable row level security;
alter table public.handover_items enable row level security;
alter table public.handover_item_claims enable row level security;
alter table public.reviews enable row level security;
alter table public.jobs enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.audit_events enable row level security;
alter table public.profiles enable row level security;
alter table public.ai_usage enable row level security;

-- ─── organisations: active org members can read their organisation ────────────
create policy "organisations_select"
  on public.organisations
  for select
  to authenticated
  using (app_private.is_org_member(id, (select auth.uid())));

-- ─── organisation_members: admins see all; members see themselves ─────────────
create policy "organisation_members_select"
  on public.organisation_members
  for select
  to authenticated
  using (
    app_private.is_org_admin(organisation_id, (select auth.uid()))
    or user_id = (select auth.uid())
  );

-- ─── projects: org member who is also an admin or project member ──────────────
create policy "projects_select"
  on public.projects
  for select
  to authenticated
  using (
    app_private.is_org_member(organisation_id, (select auth.uid()))
    and (
      app_private.is_org_admin(organisation_id, (select auth.uid()))
      or app_private.is_project_member(id, (select auth.uid()))
    )
  );

-- ─── project_members: owners see all; others see themselves ──────────────────
create policy "project_members_select"
  on public.project_members
  for select
  to authenticated
  using (
    app_private.has_project_role(project_id, (select auth.uid()), array['owner'])
    or user_id = (select auth.uid())
  );

-- ─── sources: based on can_read_source helper ────────────────────────────────
create policy "sources_select"
  on public.sources
  for select
  to authenticated
  using (app_private.can_read_source(id, (select auth.uid())));

-- ─── source_grants: project owners manage grants ─────────────────────────────
create policy "source_grants_select"
  on public.source_grants
  for select
  to authenticated
  using (
    app_private.has_project_role(project_id, (select auth.uid()), array['owner'])
  );

-- ─── source_chunks: inherit source access ────────────────────────────────────
create policy "source_chunks_select"
  on public.source_chunks
  for select
  to authenticated
  using (app_private.can_read_source(source_id, (select auth.uid())));

-- ─── claims: based on can_read_claim helper ──────────────────────────────────
create policy "claims_select"
  on public.claims
  for select
  to authenticated
  using (app_private.can_read_claim(id, (select auth.uid())));

-- ─── claim_evidence: inherit claim access ────────────────────────────────────
create policy "claim_evidence_select"
  on public.claim_evidence
  for select
  to authenticated
  using (app_private.can_read_claim(claim_id, (select auth.uid())));

-- ─── claim_relationships: both endpoint claims must be readable ───────────────
create policy "claim_relationships_select"
  on public.claim_relationships
  for select
  to authenticated
  using (
    app_private.can_read_claim(from_claim_id, (select auth.uid()))
    and app_private.can_read_claim(to_claim_id, (select auth.uid()))
  );

-- ─── claim_flags: readable if the underlying claim is readable ───────────────
create policy "claim_flags_select"
  on public.claim_flags
  for select
  to authenticated
  using (app_private.can_read_claim(claim_id, (select auth.uid())));

-- ─── clarification_questions: based on can_read_question helper ──────────────
create policy "clarification_questions_select"
  on public.clarification_questions
  for select
  to authenticated
  using (app_private.can_read_question(id, (select auth.uid())));

-- ─── question_claims: readable if the question is readable ───────────────────
create policy "question_claims_select"
  on public.question_claims
  for select
  to authenticated
  using (app_private.can_read_question(question_id, (select auth.uid())));

-- ─── handovers: based on can_read_handover helper ────────────────────────────
create policy "handovers_select"
  on public.handovers
  for select
  to authenticated
  using (app_private.can_read_handover(id, (select auth.uid())));

-- ─── handover_items: based on can_read_handover_item helper ──────────────────
create policy "handover_items_select"
  on public.handover_items
  for select
  to authenticated
  using (app_private.can_read_handover_item(id, (select auth.uid())));

-- ─── handover_item_claims: readable if the item is readable ──────────────────
create policy "handover_item_claims_select"
  on public.handover_item_claims
  for select
  to authenticated
  using (app_private.can_read_handover_item(item_id, (select auth.uid())));

-- ─── reviews: readable if the parent handover is readable ────────────────────
create policy "reviews_select"
  on public.reviews
  for select
  to authenticated
  using (app_private.can_read_handover(handover_id, (select auth.uid())));

-- ─── jobs: requester sees own; project owners see all project jobs ────────────
create policy "jobs_select"
  on public.jobs
  for select
  to authenticated
  using (
    requested_by = (select auth.uid())
    or app_private.has_project_role(project_id, (select auth.uid()), array['owner'])
  );

-- ─── conversations: owning user only ─────────────────────────────────────────
create policy "conversations_select"
  on public.conversations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ─── conversation_messages: owning user only (via conversation) ───────────────
create policy "conversation_messages_select"
  on public.conversation_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.user_id = (select auth.uid())
    )
  );

-- ─── audit_events: project owners and org admins ─────────────────────────────
create policy "audit_events_select"
  on public.audit_events
  for select
  to authenticated
  using (
    (project_id is not null and app_private.has_project_role(project_id, (select auth.uid()), array['owner']))
    or (organisation_id is not null and app_private.is_org_admin(organisation_id, (select auth.uid())))
  );

-- ─── profiles: all authenticated users can read (display names only) ─────────
create policy "profiles_select"
  on public.profiles
  for select
  to authenticated
  using (true);

-- ─── ai_usage: no access for authenticated; service_role only ────────────────
-- (No policy needed; RLS enabled with no permissive policy = deny all)
