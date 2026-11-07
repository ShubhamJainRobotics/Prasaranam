-- Migration: baseline_schema
-- Full database schema from SPEC.md Section 10.
-- Applied once; never edited after first application.

create extension if not exists pgcrypto;

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table public.organisations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.organisation_members (
  organisation_id uuid not null
    references public.organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (organisation_id, user_id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null
    references public.organisations(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '',
  domain text not null default 'general'
    check (domain in ('software_engineering', 'research', 'student_team',
      'nonprofit_operations', 'business_operations', 'general')),
  timezone text not null default 'UTC',
  access_epoch bigint not null default 1,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organisation_id)
);

create table public.project_members (
  project_id uuid not null
    references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null
    check (role in ('owner', 'reviewer', 'contributor', 'recipient')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  kind text not null check (
    kind in ('text', 'markdown', 'messages', 'issues', 'reviewer_context')
  ),
  visibility text not null
    check (visibility in ('project', 'restricted')),
  original_url text check (original_url is null or char_length(original_url) <= 2048),
  author_label text,
  event_at timestamptz,
  content text not null check (char_length(content) > 0),
  content_sha256 text not null,
  revision integer not null default 1 check (revision > 0),
  lineage_id uuid not null default gen_random_uuid(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending', 'processing', 'ready', 'failed')),
  processing_error_code text,
  archived_at timestamptz,
  archived_by uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);

create table public.source_grants (
  source_id uuid not null,
  project_id uuid not null,
  user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (source_id, user_id),
  foreign key (source_id, project_id)
    references public.sources(id, project_id) on delete cascade,
  foreign key (project_id, user_id)
    references public.project_members(project_id, user_id) on delete cascade
);

create table public.source_chunks (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null,
  project_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  record_ref text,
  author_label text,
  event_at timestamptz,
  original_url text,
  start_offset integer not null check (start_offset >= 0),
  end_offset integer not null check (end_offset > start_offset),
  content text not null,
  check (char_length(content) = end_offset - start_offset),
  search_vector tsvector generated always as (
    to_tsvector('english', content)
  ) stored,
  foreign key (source_id, project_id)
    references public.sources(id, project_id) on delete cascade,
  unique (source_id, ordinal),
  unique (id, project_id)
);

create table public.claims (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (
    kind in (
      'decision', 'proposal', 'task', 'blocker', 'risk',
      'dependency', 'responsibility', 'contact', 'open_question'
    )
  ),
  statement text not null check (char_length(statement) between 1 and 4000),
  work_state text not null default 'unknown' check (
    work_state in (
      'proposed', 'open', 'in_progress', 'blocked',
      'completed', 'cancelled', 'superseded', 'unknown'
    )
  ),
  evidence_state text not null check (
    evidence_state in (
      'supported', 'corroborated', 'needs_confirmation',
      'conflicting', 'unknown'
    )
  ),
  owner_user_id uuid references auth.users(id),
  owner_label text,
  observed_at timestamptz,
  review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected')),
  archived_at timestamptz,
  dedupe_key text not null,
  search_vector tsvector generated always as (
    to_tsvector('english', statement)
  ) stored,
  model_name text,
  prompt_version text not null,
  created_at timestamptz not null default now(),
  unique (id, project_id)
);

create table public.claim_evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  claim_id uuid not null,
  chunk_id uuid not null,
  quote text not null check (char_length(quote) > 0),
  quote_start integer not null check (quote_start >= 0),
  quote_end integer not null check (quote_end > quote_start),
  foreign key (claim_id, project_id)
    references public.claims(id, project_id) on delete cascade,
  foreign key (chunk_id, project_id)
    references public.source_chunks(id, project_id) on delete cascade,
  unique (claim_id, chunk_id, quote_start, quote_end)
);

create table public.claim_relationships (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  from_claim_id uuid not null,
  to_claim_id uuid not null,
  relation text not null check (
    relation in ('depends_on', 'supersedes', 'contradicts', 'related_to')
  ),
  explanation text not null check (char_length(explanation) between 1 and 2000),
  created_at timestamptz not null default now(),
  foreign key (from_claim_id, project_id)
    references public.claims(id, project_id) on delete cascade,
  foreign key (to_claim_id, project_id)
    references public.claims(id, project_id) on delete cascade,
  check (from_claim_id <> to_claim_id),
  unique (from_claim_id, to_claim_id, relation)
);

create table public.clarification_questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  created_for uuid not null references auth.users(id),
  question text not null,
  reason text not null,
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  dedupe_key text not null,
  status text not null default 'open'
    check (status in ('open', 'answered', 'dismissed')),
  answer_source_id uuid,
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'answered') = (answer_source_id is not null)),
  foreign key (answer_source_id, project_id)
    references public.sources(id, project_id),
  unique (id, project_id)
);

create table public.question_claims (
  question_id uuid not null,
  project_id uuid not null,
  claim_id uuid not null,
  primary key (question_id, claim_id),
  foreign key (question_id, project_id)
    references public.clarification_questions(id, project_id) on delete cascade,
  foreign key (claim_id, project_id)
    references public.claims(id, project_id) on delete cascade
);

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  root_id uuid not null,
  version integer not null check (version > 0),
  title text not null,
  recipient_id uuid not null,
  departing_user_id uuid references auth.users(id),
  created_by uuid not null references auth.users(id),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'shared', 'stale', 'superseded')),
  configuration jsonb not null,
  generated_access_epoch bigint not null,
  approved_access_epoch bigint,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  shared_at timestamptz,
  shared_by uuid references auth.users(id),
  model_name text not null,
  prompt_version text not null,
  row_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (project_id, recipient_id)
    references public.project_members(project_id, user_id),
  check (status not in ('approved', 'shared') or (
    approved_by is not null and approved_at is not null and approved_access_epoch is not null
  )),
  check (status <> 'shared' or (shared_at is not null and shared_by is not null)),
  unique (root_id, version),
  unique (id, project_id)
);
-- The first version of a handover has root_id = id (set by the creation function).

create table public.handover_items (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null,
  project_id uuid not null,
  section text not null check (
    section in (
      'snapshot', 'decisions', 'work_in_progress', 'owners_contacts',
      'risks_dependencies', 'open_questions', 'next_actions'
    )
  ),
  ordinal integer not null check (ordinal >= 0),
  text text not null check (char_length(text) between 1 and 4000),
  item_kind text not null check (
    item_kind in ('fact', 'suggestion', 'unknown')
  ),
  evidence_state text not null check (
    evidence_state in (
      'supported', 'corroborated', 'needs_confirmation',
      'conflicting', 'unknown'
    )
  ),
  review_state text not null default 'pending'
    check (review_state in ('pending', 'approved', 'rejected')),
  original_text text,
  edited_by uuid references auth.users(id),
  edited_at timestamptz,
  row_version integer not null default 1,
  foreign key (handover_id, project_id)
    references public.handovers(id, project_id) on delete cascade,
  unique (handover_id, section, ordinal),
  unique (id, project_id)
);

create table public.handover_item_claims (
  item_id uuid not null,
  project_id uuid not null,
  claim_id uuid not null,
  primary key (item_id, claim_id),
  foreign key (item_id, project_id)
    references public.handover_items(id, project_id) on delete cascade,
  foreign key (claim_id, project_id)
    references public.claims(id, project_id)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null,
  project_id uuid not null,
  item_id uuid,
  reviewer_id uuid not null references auth.users(id),
  action text not null check (
    action in (
      'approve_item', 'reject_item', 'edit_item', 'comment', 'flag',
      'add_context', 'create_version', 'approve_version', 'share'
    )
  ),
  comment text check (comment is null or char_length(comment) <= 4000),
  confirmed_reviewed_for_recipient boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (handover_id, project_id)
    references public.handovers(id, project_id) on delete cascade,
  foreign key (item_id, project_id)
    references public.handover_items(id, project_id)
);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  kind text not null check (
    kind in ('extract', 'analyze_relationships', 'generate_questions', 'generate_handover')
  ),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text not null,
  payload_hash text not null,
  payload jsonb not null,
  result jsonb,
  progress integer not null default 0 check (progress between 0 and 100),
  cancel_requested boolean not null default false,
  attempts integer not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  heartbeat_at timestamptz,
  lock_token uuid,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, requested_by, kind, idempotency_key)
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, project_id)
);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  project_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  body jsonb not null,
  access_epoch bigint not null,
  created_at timestamptz not null default now(),
  foreign key (conversation_id, project_id)
    references public.conversations(id, project_id) on delete cascade
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid references public.organisations(id),
  project_id uuid references public.projects(id),
  actor_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.claim_flags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  claim_id uuid not null,
  handover_item_id uuid,
  flagged_by uuid not null references auth.users(id),
  reason text not null check (char_length(reason) between 1 and 2000),
  status text not null default 'open' check (status in ('open', 'acknowledged')),
  created_at timestamptz not null default now(),
  foreign key (claim_id, project_id)
    references public.claims(id, project_id) on delete cascade,
  foreign key (handover_item_id, project_id)
    references public.handover_items(id, project_id)
);

create table public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  job_id uuid references public.jobs(id) on delete set null,
  purpose text not null check (
    purpose in ('extract', 'analyze_relationships', 'generate_questions',
      'generate_handover', 'answer', 'schema_repair')
  ),
  model_name text not null,
  prompt_version text not null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer not null check (latency_ms >= 0),
  outcome text not null check (
    outcome in ('ok', 'validation_failed', 'timeout', 'provider_error', 'cancelled')
  ),
  created_at timestamptz not null default now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

create index source_chunks_search_idx
  on public.source_chunks using gin (search_vector);
create index sources_project_idx on public.sources(project_id);
create index grants_user_idx on public.source_grants(user_id, source_id);
create index claims_project_kind_idx on public.claims(project_id, kind);
create index evidence_claim_idx on public.claim_evidence(claim_id);
create index evidence_chunk_idx on public.claim_evidence(chunk_id);
create index handovers_recipient_idx
  on public.handovers(recipient_id, project_id);
create index jobs_queue_idx on public.jobs(status, run_after)
  where status in ('queued', 'running');
create unique index claims_dedupe_idx
  on public.claims(project_id, dedupe_key) where archived_at is null;
create index claims_search_idx on public.claims using gin (search_vector);
create unique index clarification_open_dedupe_idx
  on public.clarification_questions(project_id, dedupe_key) where status = 'open';
create index conversation_messages_idx
  on public.conversation_messages(conversation_id, created_at);
create index ai_usage_project_day_idx on public.ai_usage(project_id, created_at desc);
create index claim_flags_claim_idx on public.claim_flags(claim_id);
create index handover_item_claims_claim_idx on public.handover_item_claims(claim_id);
create index reviews_handover_idx on public.reviews(handover_id, created_at);
create index audit_project_time_idx
  on public.audit_events(project_id, created_at desc);
