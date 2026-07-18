# RLS policy tests

Exercises the actual RLS policies and cap triggers in
`supabase/migrations/0001_init_schema.sql` against a real local Postgres — not a
mocked client, since a mock can't tell you whether the policy SQL itself is
correct. Kept separate from `npm run test`/CI for now (see
`docs/PRODUCTION_READINESS_PLAN.md` Phase 1/3 discussion) since it needs Docker
running locally; revisit folding it into CI once Phase 1's schema has settled.

## One-time setup

1. Install Docker Desktop (or Docker Engine, e.g. via WSL2) and make sure it's running.
2. `npx supabase init` — only needed once; `supabase/migrations/` already exists
   from this repo, this just adds the local `supabase/config.toml` for whatever
   CLI version you have installed. Safe to run even with the migration already
   in place.
3. `npx supabase start` — pulls and starts the local Postgres/Auth/PostgREST
   containers and applies `supabase/migrations/*.sql` automatically on first run.
   Leave it running.

## Running the tests

```
npm run test:rls
```

`test/rls/setup.ts` uses the Supabase CLI's fixed local-dev demo keys (not
secrets — identical on every machine, documented in Supabase's own docs, and only
ever valid against `http://127.0.0.1:54321`). It creates and tears down its own
throwaway test users per run via the `service_role` admin API — never used in
`src/`, which is exactly what the CI `service_role` grep tripwire (`ci.yml`) checks
for.

## When you're done

`npx supabase stop` to shut down the containers.
