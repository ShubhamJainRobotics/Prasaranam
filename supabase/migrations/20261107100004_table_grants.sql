-- Migration: table_grants
-- Implements the privilege model from SPEC.md 2A.1.
-- anon gets no grants on application tables.
-- authenticated gets SELECT only (no INSERT/UPDATE/DELETE/TRUNCATE).
-- All mutations go through app_private functions executed by service_role.

-- ─── Revoke from anon (belt-and-suspenders; anon has no default grants in
--     a fresh project but we make it explicit) ────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ─── Revoke INSERT/UPDATE/DELETE/TRUNCATE from authenticated ─────────────────
revoke insert, update, delete, truncate on
  public.organisations,
  public.organisation_members,
  public.projects,
  public.project_members,
  public.sources,
  public.source_grants,
  public.source_chunks,
  public.claims,
  public.claim_evidence,
  public.claim_relationships,
  public.claim_flags,
  public.clarification_questions,
  public.question_claims,
  public.handovers,
  public.handover_items,
  public.handover_item_claims,
  public.reviews,
  public.jobs,
  public.conversations,
  public.conversation_messages,
  public.audit_events,
  public.profiles,
  public.ai_usage
from authenticated;

-- ─── Grant SELECT to authenticated (RLS enforces row-level filtering) ─────────
grant select on
  public.organisations,
  public.organisation_members,
  public.projects,
  public.project_members,
  public.sources,
  public.source_grants,
  public.source_chunks,
  public.claims,
  public.claim_evidence,
  public.claim_relationships,
  public.claim_flags,
  public.clarification_questions,
  public.question_claims,
  public.handovers,
  public.handover_items,
  public.handover_item_claims,
  public.reviews,
  public.jobs,
  public.conversations,
  public.conversation_messages,
  public.audit_events,
  public.profiles
to authenticated;

-- ai_usage: no select for authenticated; queried by API server via service_role only.
revoke select on public.ai_usage from authenticated;
