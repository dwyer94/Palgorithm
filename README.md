# PalCalc — Palworld Breeding Path Optimizer

A personal, client-side tool that takes the Pals you own (species, gender, passives) and
one or more target Pals (with a desired perk set) and returns the breeding plan that
reaches them in the **fewest distinct breeding combinations**. Built to survive
Palworld's 1.0 breeding overhaul (Genetic Recombination) by keeping all breeding rules
behind a swappable interface — see [`PALWORLD_BREEDING_OPTIMIZER_SPEC.md`](docs/PALWORLD_BREEDING_OPTIMIZER_SPEC.md)
for the full design and [`CLAUDE.md`](CLAUDE.md) for the working invariants.

React + TypeScript + Tailwind, built with Vite. No backend is required to use it — game
data ships as a bundled static JSON dataset, and your roster/plans/settings live in
`localStorage`. Two optional backends extend that: a FastAPI **proxy** (see below) that
pulls live pal data from a running Palworld server instead of manual entry, and a
**Supabase** account layer that syncs your data across devices instead of keeping it
local-only (see below).

## Features

- **Roster manager** — enter the Pals you own (species, gender, passives).
- **Single-target planner** — cheapest breeding path to one target Pal + perk set.
- **Hub / multi-target planner** — finds a shared "hub" Pal (or small set of combinations)
  that reaches several targets at once, cheaper than solving each target independently.
  Includes curated "jump-start" suggestions per role (combat/worker/mount) — see
  [Suggested hubs](#suggested-hubs-pipeline) below.
- **Forward calculator** — given two parents, what can they produce.
- **Reverse lookup** — given a target species, what parent pairs can produce it.
- **Saved plans** — persist breeding plans locally for later reference.
- **Server Pals / live connection** — optionally pull real pals from every player on a
  running Palworld server via a proxy in front of PalDefender, and use them as planner
  inputs alongside (or instead of) your manually-entered roster. See
  [Live server connection](#live-server-connection-optional-proxy) below.
- **Optional accounts / cloud sync** — sign in (email+password, Google, or Discord) to
  sync your roster/plans/teams/settings across devices. Fully opt-in — see
  [Accounts and cloud sync](#accounts-and-cloud-sync-optional) below.
- **Settings** — allowed-catch policy, perk sets, live-connection config, display-name
  overrides for the proxy's live data, account sign-in.

All views live in [`src/ui`](src/ui); Phase 0 UI is intentionally functional/unstyled
(visual design is a separate later pass — see `CLAUDE.md` invariant 5).

## Getting started

```bash
npm install
npm run dev       # start the app (Vite dev server)
npm run build     # production build (tsc -b && vite build)
npm run test      # run the Vitest suite once
npm run test:watch
npm run lint
npm run format
```

No live-server setup is required to use the app — with an empty proxy base URL in
Settings, it runs entirely against the bundled dataset and your local roster. Likewise, no
account is required — see below.

## Accounts and cloud sync (optional)

The app is guest-first by design (`CLAUDE.md`): with no sign-in, everything — roster,
saved plans, teams, settings — lives in `localStorage` only, same as always. On top of
that, an opt-in account layer (Supabase auth + Postgres, RLS-scoped per user) lets your
data follow you across devices instead.

- **Sign in** from the sidebar's Account entry (`src/ui/AuthView.tsx`) — email+password,
  or OAuth via Google/Discord.
- Signing in switches reads/writes from `localStorage` to Supabase
  (`src/store/remoteStore.ts`), transparently to every view — none of them talk to storage
  directly, they all go through `src/store/hooks.ts`.
- **Guest -> account migration**: the first time you sign into an account with empty cloud
  tables, you're offered a one-time import of whatever's in this browser's local storage
  (`src/ui/GuestMigrationPrompt.tsx`). There's no merge/conflict resolution beyond that —
  if a second device also has local guest data, it's flagged rather than silently dropped.
- **Account deletion** cascades to every synced table via a `delete_user()` Postgres RPC
  (`supabase/migrations/0002_delete_account_rpc.sql`).

This layer only activates if the deployment is configured for it — copy `.env.example` to
`.env.local` and fill in `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from your own
Supabase project's Settings → API page (`src/store/supabaseClient.ts`). Leave them unset
and the app runs exactly as it did before this feature existed: fully local, no sign-in UI
gating anything. Schema/RLS policies live in `supabase/migrations/`. Full design notes:
[`docs/PRODUCTION_READINESS_PLAN.md`](docs/PRODUCTION_READINESS_PLAN.md) (Phase 1).

## Live server connection (optional proxy)

You can optionally point the app at a **proxy** service that mirrors the
[PalDefender](https://ultimeit.github.io/PalDefender/) REST API, so the planner can pull
in every player's real pals from a running Palworld dedicated server instead of manual
entry. This is entirely optional — leave the proxy base URL blank in Settings and the app
runs on your local roster only.

**Why a proxy instead of connecting directly to PalDefender:** nothing in the app hardcodes
the proxy's contract specifically — it just `fetch`es whatever base URL you give it, and
the proxy mirrors PalDefender's own paths and response shapes 1:1. The blocker is
PalDefender itself: it only listens on `127.0.0.1` on the server, holds an admin-equivalent
bearer token, and has no CORS support for a browser client, so a direct app→PalDefender
connection is never actually reachable from a real browser tab regardless of hosting. The
proxy (`proxy/` in this repo, FastAPI) is the only piece that ever holds that token; it
exposes a read-only mirror of PalDefender's API (`/v1/pdapi/players`, `/v1/pdapi/pals/{id}`)
with CORS enabled, an optional caller token, and a short-TTL cache, and is the only
component ever exposed off the server (via Tailscale). See
[`proxy/README.md`](proxy/README.md#can-i-point-the-app-at-paldefender-directly-skipping-the-proxy)
for the full breakdown of why.

```
Palworld Dedicated Server + PalDefender (127.0.0.1, holds the real token)
        │
        ▼
Proxy (proxy/, FastAPI, 127.0.0.1) — mirrors PalDefender's API, adds CORS + optional token
        │
        ▼
Tailscale (`tailscale serve`) — exposes the proxy over HTTPS on your tailnet only
        │
        ▼
App (Settings → Proxy base URL [+ optional bearer token])
```

Quick start for the proxy itself:

```bash
cd proxy
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env      # fill in PALDEFENDER_BASE / PALDEFENDER_TOKEN, etc.
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8080
```

Leaving `PALDEFENDER_TOKEN` blank runs the proxy in **demo mode** (canned data, no real
server needed) — useful for testing the app↔proxy connection on its own. See
[`proxy/README.md`](proxy/README.md) for proxy-specific details, and
[`docs/SETUP_admin_runbook.md`](docs/SETUP_admin_runbook.md) for the full walkthrough
(PalDefender install/config → proxy → Tailscale → app Settings), including a Windows
Firewall/Tailscale ACL security checklist. If you're just a player joining someone else's
server, use [`docs/SETUP_friends_guide.md`](docs/SETUP_friends_guide.md) instead — it's a
~2-minute, non-technical setup (install Tailscale, open the link, pick which players'
pals to include).

Once connected, point the app at the proxy in **Settings** (`src/ui/SettingsView.tsx`):
a proxy base URL and an optional bearer token (only needed if the proxy sets
`PROXY_TOKEN`). The **Server Pals** view (`src/ui/ServerPalsView.tsx`) then lists every
connected player's pals; check the players whose pals you want to feed into the planner,
and they merge into the same roster used by the single-target and hub planners. The data
layer (`src/live/dataSource.ts`, `src/live/normalize.ts`) fetches and normalizes live
pals into the app's model and flags anything that doesn't resolve against the bundled
dataset instead of silently guessing. Full design notes: [`docs/UI_REQUIREMENTS.md`](docs/UI_REQUIREMENTS.md).

## The data pipeline

Game data (species ranks, special combos, passives, reachability) never lives hardcoded
in the app — it's extracted offline from the game files and shipped as a static,
versioned dataset (`src/data/dataset.<version>.json`), loaded through
[`src/data/loader.ts`](src/data/loader.ts) and validated against a schema. The pipeline
that produces it is an offline Node CLI, never run in the browser — see
[`src/pipeline/README.md`](src/pipeline/README.md) and
[`src/pipeline/EXTRACTION.md`](src/pipeline/EXTRACTION.md) for the full extraction
run-notes (usmap sourcing, FModel export, classification rules).

```bash
npm run data:normalize   # raw UE4SS/FModel export → src/data/dataset.<version>.json
npm run data:hubs        # regenerate the "suggested hubs" cards (see below)
```

`data:normalize` (`src/pipeline/normalize.ts`) turns a raw DataTable export into the
app's dataset schema and self-validates before writing. `EXTRACTION.md` documents how to
get that raw export in the first place (sourcing a build-matched `Mappings.usmap`,
exporting `DT_PalMonsterParameter` / `DT_PalCombiUnique` / passive & name tables via
FModel) and the classification judgment calls baked into the current dataset (release
gating, `standardBreedable`, gender-dependent special combos, etc.).

### Suggested hubs pipeline

The Hub planner's "jump-start with a popular pick" cards (combat/worker/mount, in
`src/ui/HubView.tsx`) are precomputed offline rather than solved live, since the
structural half of hub scoring doesn't depend on any one user's roster.
`src/pipeline/suggestHubs.ts` reads a hand-curated target list per role from
[`src/pipeline/popularTargets.json`](src/pipeline/popularTargets.json) and writes
`src/data/suggestedHubs.0.6.json` by reusing the existing solver (`findHubs`/`planUnion`,
same breeding math as everywhere else — no new rules live in this script).

**To change which Pals show up as suggestions**, edit `popularTargets.json`
(`{ role: [speciesId, ...] }`) and re-run:

```bash
npm run data:hubs
```

then commit the regenerated `src/data/suggestedHubs.0.6.json`.

Every species listed must exist in the current dataset, be `standardBreedable: true`, and
must **not** be self+self-only in `ruleset.reverse(id)` — some apex/legendary Pals can
only be bred by crossing two of themselves (they're catch-only to bootstrap). One such
species in a role's list makes every hub candidate infeasible for that whole role, since
a hub must reach every target in the list; `suggestHubs.ts` throws with a pointer to this
check if a role comes back with zero hub candidates.

To add a new role beyond combat/worker/mount, add a key to `popularTargets.json` and
(optionally, for a nicer label) a `{ label, icon }` entry to `ROLE_META` in
`src/ui/HubView.tsx` — the UI renders an unrecognized role key with a default icon
without any code change.

Regenerate `suggestedHubs.0.6.json` whenever the dataset changes (new game data, patch
day) — it isn't wired into `data:normalize` automatically, so run `npm run data:hubs` as
a manual follow-up step.

## Project structure

```
/src/data      dataset.<version>.json + loader/validator
/src/ruleset   BreedingRuleset interface + the CombiRank (0.6) implementation
/src/solver    speciesPlanner, hubFinder, passivePlanner, shared types
/src/store     localStorage roster/plans/settings + optional Supabase remoteStore (accounts)
/src/ui        views + components (roster, planners, forward/reverse lookup, live, settings, auth)
/src/live      PalDefender-proxy connection: data source, normalizer, LiveContext
/src/pipeline  offline Node CLI: normalizer + suggested-hubs precompute + diff scripts
/test          ruleset-vs-oracle + solver unit tests
/proxy         FastAPI proxy mirroring PalDefender's REST API (see above)
/supabase      migrations + RLS policies for the optional account layer (see above)
/docs          admin/friends setup guides + UI requirements + production readiness plan
```

## Testing

Ruleset forward/reverse behavior is unit-tested against oracle repos, and is the
divergence detector for when a future ruleset (e.g. 1.0's Genetic Recombination) lands —
run `npm run test` before relying on any ruleset or solver change.
