-- PalCalc cloud sync schema (Phase 1). One table per existing localStorage entity
-- (src/store/types.ts), each scoped to its owner via RLS. Row caps are enforced in
-- the INSERT policy itself (not client-side) since the anon key is public once the
-- app ships — see docs/PRODUCTION_READINESS_PLAN.md Phase 1.
--
-- Row caps are enforced via AFTER INSERT ... FOR EACH STATEMENT triggers, not a
-- count(*) subquery in the RLS WITH CHECK clause. A WITH CHECK subquery shares one
-- statement-level snapshot across every row in a multi-row INSERT, so it can't see
-- sibling rows from the same statement — a single bulk insert (e.g. the guest→account
-- migration's bulk-upsert) could blow past the cap in one shot with a subquery-based
-- check. A statement-level trigger runs after the statement's own inserts are already
-- visible in the same transaction, so count(*) reflects the real post-insert total.
create or replace function enforce_user_row_cap() returns trigger as $$
declare
  cap int := TG_ARGV[0]::int;
  current_count int;
begin
  execute format('select count(*) from %I where user_id = $1', TG_TABLE_NAME)
    into current_count
    using auth.uid();
  if current_count > cap then
    raise exception '% row cap of % exceeded for this user', TG_TABLE_NAME, cap;
  end if;
  return null;
end;
$$ language plpgsql;

-- ── rosters ──────────────────────────────────────────────────────────────────
create table rosters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  species text not null,
  gender text not null,
  passives jsonb not null default '[]'::jsonb,
  notes text
);

alter table rosters enable row level security;

create policy "select own rosters" on rosters
  for select using (auth.uid() = user_id);

create policy "insert own rosters" on rosters
  for insert with check (auth.uid() = user_id);

create policy "update own rosters" on rosters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own rosters" on rosters
  for delete using (auth.uid() = user_id);

create trigger rosters_row_cap
  after insert on rosters
  for each statement
  execute function enforce_user_row_cap(1000);

-- RLS alone isn't enough: Postgres denies all access to a newly created table for any
-- role until explicitly granted, regardless of policies (the Supabase dashboard's table
-- editor does this grant for you automatically; a raw migration must do it explicitly).
-- Only `authenticated` needs it — guests never touch Supabase directly, they use
-- localStorage, so `anon` gets nothing here.
grant select, insert, update, delete on rosters to authenticated;
grant all on rosters to service_role;

-- ── saved_plans ──────────────────────────────────────────────────────────────
create table saved_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  saved_at timestamptz not null default now(),
  kind text not null check (kind in ('single', 'union')),
  targets jsonb not null default '[]'::jsonb,
  desired_passives jsonb,
  -- result, guaranteedCarrierOutcome, ownedUnassignedPassives, nextBestWhenOwned:
  -- already solver-shaped, stored as-is rather than normalized further.
  data jsonb not null
);

alter table saved_plans enable row level security;

create policy "select own saved_plans" on saved_plans
  for select using (auth.uid() = user_id);

create policy "insert own saved_plans" on saved_plans
  for insert with check (auth.uid() = user_id);

create policy "update own saved_plans" on saved_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own saved_plans" on saved_plans
  for delete using (auth.uid() = user_id);

create trigger saved_plans_row_cap
  after insert on saved_plans
  for each statement
  execute function enforce_user_row_cap(200);

grant select, insert, update, delete on saved_plans to authenticated;
grant all on saved_plans to service_role;

-- ── teams / team_slots ───────────────────────────────────────────────────────
create table teams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

alter table teams enable row level security;

create policy "select own teams" on teams
  for select using (auth.uid() = user_id);

create policy "insert own teams" on teams
  for insert with check (auth.uid() = user_id);

create policy "update own teams" on teams
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own teams" on teams
  for delete using (auth.uid() = user_id);

create trigger teams_row_cap
  after insert on teams
  for each statement
  execute function enforce_user_row_cap(50);

grant select, insert, update, delete on teams to authenticated;
grant all on teams to service_role;

-- team_slots has no independent cap: bounded by teams' own cap (50 teams x fixed
-- TEAM_SLOT_COUNT=5 slots = 250 rows max), so no separate count check needed.
create table team_slots (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  slot_index int not null check (slot_index >= 0 and slot_index < 5),
  target text,
  desired_passives jsonb not null default '[]'::jsonb,
  plan jsonb,
  pending_plan jsonb,
  unique (team_id, slot_index)
);

alter table team_slots enable row level security;

create policy "select own team_slots" on team_slots
  for select using (auth.uid() = user_id);

create policy "insert own team_slots" on team_slots
  for insert with check (auth.uid() = user_id);

create policy "update own team_slots" on team_slots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own team_slots" on team_slots
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on team_slots to authenticated;
grant all on team_slots to service_role;

-- ── settings ─────────────────────────────────────────────────────────────────
-- One row per user, including `live` (LiveConnectionSettings: proxy base URL +
-- bearer token) as nested jsonb. Row-level RLS protects the whole row — the
-- bearer token gets no extra column-level treatment, see PRODUCTION_READINESS_PLAN.md
-- Phase 1 discussion: this defends against other app users, not a leaked
-- service_role key or direct DB access, which is an accepted residual risk.
create table settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  allow_catching boolean not null default false,
  catch_cost numeric not null default 1,
  saved_perk_sets jsonb not null default '[]'::jsonb,
  server_config_preset jsonb,
  active_ruleset text,
  icon_display_mode text not null default 'compact' check (icon_display_mode in ('compact', 'full')),
  live jsonb not null default '{
    "baseUrl": "",
    "bearerToken": "",
    "autoPollEnabled": true,
    "autoPollIntervalSeconds": 300,
    "nameOverrides": {},
    "identityLinks": {}
  }'::jsonb
);

alter table settings enable row level security;

create policy "select own settings" on settings
  for select using (auth.uid() = user_id);

create policy "insert own settings" on settings
  for insert with check (auth.uid() = user_id);

create policy "update own settings" on settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own settings" on settings
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on settings to authenticated;
grant all on settings to service_role;
