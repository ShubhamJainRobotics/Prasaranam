-- Migration: trigger_auth_profile
-- Creates a profiles row when a new auth.users row is inserted.
-- Display name is taken from raw_user_meta_data->>'display_name'.
-- Falls back to 'Unnamed user' if not provided.
-- Profiles never store the email address.

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
-- TRUST BOUNDARY: This function runs as the owner (service role) when a new
-- user is created in auth.users. It writes one row to public.profiles using
-- metadata supplied at sign-up. It never writes email or any other PII.
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
      'Unnamed user'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
