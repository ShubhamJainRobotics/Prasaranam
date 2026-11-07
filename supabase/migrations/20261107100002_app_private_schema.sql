-- Migration: app_private_schema
-- Creates the app_private schema and sets privilege baseline.
-- Per SPEC.md 2A.1: mutations live in app_private, never exposed via Data API.

create schema if not exists app_private;

-- Revoke all from public (default grants). Grant usage to authenticated so
-- RLS helper functions in app_private can be called from policies.
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

-- Alter default privileges: future objects in public schema must not be
-- automatically accessible to anon or authenticated beyond explicit grants.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on sequences from authenticated;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on functions from authenticated;
alter default privileges in schema app_private revoke all on tables from public;
alter default privileges in schema app_private revoke all on functions from public;
