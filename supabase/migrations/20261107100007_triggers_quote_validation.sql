-- Migration: triggers_quote_validation
-- Safeguard 2: Validate quote bounds and exact substring equality in claim_evidence.
-- Offsets are zero-based Unicode code-point indices (char_length in UTF-8 Postgres).

create or replace function app_private.validate_quote()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_chunk_content text;
  v_chunk_start integer;
  v_chunk_end integer;
  v_expected_quote text;
begin
  -- Fetch the chunk's content and offsets
  select sc.content, sc.start_offset, sc.end_offset
  into v_chunk_content, v_chunk_start, v_chunk_end
  from public.source_chunks sc
  where sc.id = new.chunk_id;

  if not found then
    raise exception 'chunk not found: %', new.chunk_id;
  end if;

  -- quote_start and quote_end are relative to the chunk content
  if new.quote_start < 0 then
    raise exception 'quote_start must be >= 0, got %', new.quote_start;
  end if;

  if new.quote_end <= new.quote_start then
    raise exception 'quote_end (%) must be > quote_start (%)', new.quote_end, new.quote_start;
  end if;

  if new.quote_end > char_length(v_chunk_content) then
    raise exception 'quote_end (%) exceeds chunk length (%)', new.quote_end, char_length(v_chunk_content);
  end if;

  -- Extract expected substring: PostgreSQL substring is 1-based, using code-point positions
  v_expected_quote := substring(v_chunk_content from new.quote_start + 1 for new.quote_end - new.quote_start);

  if new.quote <> v_expected_quote then
    raise exception 'quote text does not match chunk content at [%,%)', new.quote_start, new.quote_end;
  end if;

  return new;
end;
$$;

create trigger claim_evidence_validate_quote
  before insert or update on public.claim_evidence
  for each row execute function app_private.validate_quote();
