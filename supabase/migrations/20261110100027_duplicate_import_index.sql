-- Migration: duplicate_import_index
-- Index to speed up SHA-256 duplicate checks at import time.
-- The check uses the user-scoped client so RLS applies: a source
-- the caller cannot read is invisible, ensuring duplicate detection
-- cannot reveal restricted source existence.

create index if not exists sources_project_sha256_idx
  on public.sources(project_id, content_sha256)
  where archived_at is null;
