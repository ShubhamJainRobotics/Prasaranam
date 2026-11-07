-- Migration: triggers_chunk_validation
-- Safeguard 3: Validate that source_chunks content matches the canonical source
-- content at the given offsets. Also enforces chunk content length invariant.

create or replace function app_private.validate_chunk()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_source_content text;
  v_expected_content text;
begin
  -- Fetch the source's canonical content
  select s.content
  into v_source_content
  from public.sources s
  where s.id = new.source_id;

  if not found then
    raise exception 'source not found: %', new.source_id;
  end if;

  -- Validate offset bounds
  if new.start_offset < 0 then
    raise exception 'start_offset must be >= 0, got %', new.start_offset;
  end if;

  if new.end_offset <= new.start_offset then
    raise exception 'end_offset (%) must be > start_offset (%)', new.end_offset, new.start_offset;
  end if;

  if new.end_offset > char_length(v_source_content) then
    raise exception 'end_offset (%) exceeds source content length (%)',
      new.end_offset, char_length(v_source_content);
  end if;

  -- Extract expected content (1-based, code-point aware in UTF-8 Postgres)
  v_expected_content := substring(v_source_content from new.start_offset + 1
    for new.end_offset - new.start_offset);

  if new.content <> v_expected_content then
    raise exception 'chunk content does not match source content at offsets [%,%)',
      new.start_offset, new.end_offset;
  end if;

  -- Validate content length matches offset difference
  if char_length(new.content) <> new.end_offset - new.start_offset then
    raise exception 'chunk content length (%) does not equal end_offset - start_offset (%)',
      char_length(new.content), new.end_offset - new.start_offset;
  end if;

  return new;
end;
$$;

create trigger source_chunks_validate_chunk
  before insert or update on public.source_chunks
  for each row execute function app_private.validate_chunk();
