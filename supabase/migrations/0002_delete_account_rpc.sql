-- Self-serve account deletion (Phase 4, docs/PRODUCTION_READINESS_PLAN.md). The
-- supabase-js client has no "delete my own auth user" call — deleting from auth.users
-- normally requires the service_role key, which this project's own CI tripwire forbids
-- from ever reaching the client (.github/workflows/ci.yml). Instead, a `security definer`
-- function runs with the privileges of its owner (the migration-running role, which can
-- write to auth.users) while still only ever deleting the calling user's own row via
-- auth.uid() — a signed-in user can never pass another user's id.
--
-- Deleting the auth.users row cascades to rosters/saved_plans/teams/team_slots/settings
-- automatically: every one of those tables' user_id columns is declared
-- `references auth.users (id) on delete cascade` in 0001_init_schema.sql.
create or replace function delete_user() returns void as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = auth, public;

-- Only a signed-in user may call this (and only ever against their own uid via auth.uid()
-- inside the function body) — anon never gets execute.
grant execute on function delete_user() to authenticated;
