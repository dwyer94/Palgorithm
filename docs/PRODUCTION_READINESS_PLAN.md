# PalCalc Production Readiness Plan

> Status: **All phases (0-5) done.** Phases 0-3, 2026-07-17 (docs reconciliation;
> accounts/cloud sync; onboarding/in-app guidance; CI/hardening — see
> `docs/DEPLOYING_GUIDE.md` for the private ops detail behind Phases 1/3); Phases 4-5,
> 2026-08-01 (observability/legal/deploy; Reference UI polish). **The app is live in
> production at https://palgorithm.dev with real users.** This plan is now a record of
> how it got there rather than a list of pending work; `CLAUDE.md`,
> `docs/UI_REQUIREMENTS.md`, and `docs/PALWORLD_BREEDING_OPTIMIZER_SPEC.md` reflect the
> guest-first direction and point back here for that history.

## Context

PalCalc has been built and documented as a personal, single-user, fully client-side
tool (CLAUDE.md, `docs/UI_REQUIREMENTS.md` §7: "No backend, no analytics, no auth, no
accounts... not a public product"). The owner now wants to ship it publicly with real
user accounts so people can save their roster/plans/teams across devices, while
deliberately **not** shipping the PalDefender live-server proxy as part of the public
product — that stays a self-hosted, BYO-Tailscale feature documented in
`docs/SETUP_admin_runbook.md`/`docs/SETUP_friends_guide.md`, available on GitHub for
anyone who wants to run it themselves. The visual design pass (session 0.D) is done,
so the remaining gap to "shippable" is backend, accounts, security/ops hygiene, and
onboarding copy for strangers who don't already know the domain.

This plan covers what's needed to take the app from "solo tool on my machine" to
"public web app with accounts," in the smallest number of well-sequenced phases.
Confirmed direction: **guest-first** — the app keeps working with zero sign-in
(current localStorage behavior unchanged), and creating an account is an opt-in
upgrade that syncs data to the cloud. This avoids signup friction for first-time
visitors and means the local-only code path never goes away, it just gets a sync
option layered on top.

**Explicitly out of scope for this plan** (confirmed with the owner):

- Hosting/running the PalDefender proxy ourselves, or making the proxy itself
  multi-tenant. The proxy stays a self-hosted, BYO-Tailscale component that lives in
  this repo for anyone to run on their own server — that part doesn't change.
- Any sharing/community features (public plan galleries, shared teams) — accounts are
  for private cloud sync of one person's own data, not social features.
- Native mobile apps (the existing PWA is the mobile story).

**In scope, clarified**: the *client-side* "connect to your own proxy" feature
(Settings → proxy base URL + bearer token, already implemented in `src/live/*` and
`SettingsView`) stays in the public product and gets one upgrade — that connection
config should sync via the user's account like everything else, so signing in on a
new device reconnects to their own proxy without re-entering the URL/token by hand.

## Key existing leverage (why this is smaller than it looks)

- **The store is already hook-abstracted.** Every view (`RosterView`, `HubView`,
  `TeamsView`, `SavedPlansView`, `SettingsView`, etc.) consumes `useRoster`,
  `useSavedPlans`, `useTeams`, `useSettings`, `useSelectedPlayerIds`
  (`src/store/hooks.ts`) — none touch `localStorage` directly. Adding cloud sync means
  changing the ~5 functions in `src/store/localStore.ts` + the hooks, not touching 15
  view files.
- **Data model is already flat and simple** (`src/store/types.ts`): `RosterEntry`,
  `SavedPlan`, `Team`/`TeamSlot`, `Settings` — no field is more than one level of
  nesting away from a Postgres row + JSONB column.
- **`LiveConnectionSettings` (nested in `Settings.live`) syncs too** — per owner
  clarification, a user's proxy connection (base URL + bearer token) should follow
  their account across devices, same as roster/plans. RLS already makes this private
  per-row, same protection localStorage never had.
- TypeScript is already in strict mode, `zod` is already a dependency (reuse for
  Supabase row validation), and there are 24 test files covering solver/ruleset/live
  logic already — the testing culture exists, it just needs a CI runner wired up.

---

## Phase 1 — Accounts & cloud sync (the core lift) — **done, 2026-07-17**

**Backend: Supabase (Postgres + Auth + Row-Level Security).** No custom server
needed for this — the browser talks to Supabase directly using the public anon key;
RLS policies (`user_id = auth.uid()`) are the only thing standing between users' data.
Never let the service_role key anywhere near the client.

**Schema** (one table per existing store entity, each with a `user_id uuid` FK to
`auth.users` and RLS `using (auth.uid() = user_id)`):

- `rosters` — mirrors `RosterEntry` (id, species, gender, passives, notes).
- `saved_plans` — mirrors `SavedPlan`; `result`, `guaranteedCarrierAlt`,
  `ownedUnassignedPassives` go in a single `data jsonb` column (already
  solver-shaped, no need to normalize further).
- `teams` + `team_slots` — one `teams` row per `Team`; `team_slots` gets an explicit
  `slot_index int` column instead of relying on array-index-as-identity
  (`types.ts:76-78` calls this out as a modeling wrinkle today).
- `settings` — one row per user, mirrors `Settings` including `live` (base URL,
  bearer token, autoPoll config, nameOverrides, identityLinks) as nested `jsonb`.
  `savedPerkSets` as `jsonb`. Same RLS rule protects the bearer token as everything
  else — it's private to that user's row, which is a real improvement over today's
  plain `localStorage` (readable by any script running on the page, no isolation).

**Data layer**: introduce a `src/store/remoteStore.ts` alongside `localStore.ts`
implementing the same function signatures (`getRoster`/`setRoster`/etc., now async),
and a thin switch in `src/store/hooks.ts` keyed on auth state (signed out → existing
sync localStorage path unchanged; signed in → Supabase-backed, realtime-subscribed).
This is the piece that keeps the ~15 view files untouched.

**Auth UI**: new minimal `AuthView`/account menu (Supabase Auth UI or hand-rolled —
email/password + optional OAuth). Session state via a small `AuthContext`, mirroring
the existing `RulesetContext`/`ReferenceContext`/`LiveContext` pattern already used in
`src/ui`. Email verification and password-reset flows are Supabase Auth built-ins
(`resetPasswordForEmail()` + confirmation emails) — no custom code needed. One real
gotcha: Supabase's default email sending is rate-limited and not intended for
production (a handful of emails/hour on the free tier) — before public launch, configure
a custom SMTP provider (Resend/Postmark/SendGrid) in the Supabase Auth dashboard so
verification/reset emails don't silently start failing under real signup volume.

**Anon-key abuse / rate limiting**: the anon key is public once the app ships, and RLS
is the only gate standing between it and the database. Needs a concrete decision before
launch (Supabase Auth rate limits are automatic; per-user row caps on `saved_plans`/
`teams`/`rosters` are not) — deferred for now, revisit during Phase 1 implementation
rather than blocking the start of it.

**Guest → account migration**: on first sign-in, if the Supabase tables are empty for
that user, offer a one-time "Import your local data" action that bulk-upserts current
localStorage roster/plans/teams/settings (including `live`) into the new rows. If the
account already has cloud data (returning user, new device), leave local guest data
alone and just switch to showing cloud data — no automatic merge logic in v1 (avoid
overbuilding a conflict-resolution UI nobody asked for).

**CORS, explained** (the owner flagged not knowing this well): CORS is a
browser-only restriction on which web *origins'* JavaScript may read a cross-origin
response — it is not an auth mechanism, and it does nothing to stop a non-browser
client (curl, a script, another server) from calling the proxy directly. The proxy's
actual security boundary is the bearer token plus Tailscale network reachability
(`docs/SETUP_admin_runbook.md` Part F), same as today. What changes once the app has
one real public URL (e.g. `https://palcalc.app`) instead of being run from
`localhost`/`file://`: self-hosters should set their proxy's `CORS_ORIGINS` (already
an env var in `proxy/.env`, `proxy/config.py:41,50`) to that exact origin so the
browser doesn't block the app's own fetch calls to their proxy. Leaving it at the
default `*` also works and isn't a meaningful extra risk here (no cookies, explicit
`Authorization` header, `allow_credentials` unset) — it's a convenience/precision
setting, not a security one. Worth adding one line to `SETUP_admin_runbook.md` Part B1
naming the production app's real origin so self-hosters can just paste it in instead
of guessing.

**Remove the demo/mock-data fallback from the production build.** Today, an
unconfigured live connection (`baseUrl` empty) transparently falls back to
`src/live/fixtures.ts` mock data (wired up in `LiveContext.tsx:87-89`). That's a
reasonable dev/testing convenience but wrong UX for a public product — a stranger with
no proxy configured should see a clear "not connected" empty state (feeds into Phase
2's empty-state work), not silently-fake Pals that look real. Plan: gate the mock
fallback in `src/live/dataSource.ts` behind `import.meta.env.DEV` (or an explicit
test-only flag) so it's still available for local development and the existing test
suite (`test/live/*`), but never reachable in the production bundle; `ServerPalsView`
shows the new empty state instead when disconnected. Scope note: this only touches the
*client-side* mock — the proxy's own `demo_data.py`/`DEMO_MODE` (`proxy/config.py:58`)
is untouched by this plan, since the proxy is self-hosted and out of scope for the
public deploy (see "Explicitly out of scope" above).

---

## Phase 2 — Onboarding & in-app guidance — **done, 2026-07-17**

No tooltip/help-copy pattern exists anywhere in `src/ui` today (confirmed by grep).
For strangers who don't already know the domain:

- Inline info-icons/tooltips on jargon: rank, hub, CombiRank score, mutation vs.
  inheritance roll — add a small reusable `InfoTooltip` component in
  `src/ui/components.tsx` (where other shared UI primitives already live) rather than
  ad-hoc per view.
- Empty-state copy in `RosterView`, `TeamsView`, `SavedPlansView`, `HubView` instead
  of blank tables.
- A short first-run explainer (dismissible banner or modal) covering the two things
  that aren't guessable from the UI: "closest eligible rank wins" and "a hub is a
  shared intermediate across multiple targets."
- Sign-in/sync entry point needs its own one-line explanation ("Create an account to
  save your roster across devices — using the planner works fine without one too").
- **About section**: app version, GitHub link, and the game version the current
  dataset was sourced from. Investigate whether the game version can be pulled
  dynamically from the extracted game files (`src/pipeline`) rather than hand-maintained
  — if not feasible without more pipeline work, fall back to a manually-set constant
  alongside `src/version.ts` and flag the manual-sync risk.
- **Ko-fi link**: a small, unobtrusive donation link (footer or about/settings area,
  not competing with primary actions) — placement is a UI-polish detail to nail down
  during this phase, not before.

---

## Phase 3 — Hardening & CI — **done, 2026-07-17**

- **CI**: none exists today. Add a GitHub Actions workflow running `npm run lint`,
  `tsc -b` (or a dedicated `typecheck` script), `npm run test`, and `npm run build` on
  every PR — this is pure upside given the strict TS config and existing test suite
  are currently unenforced by anything.
- **Dependency scanning**: enable Dependabot (free, GitHub-native) for npm advisories.
- **Supabase secrets hygiene**: confirm only the anon key ships in client env vars
  (`import.meta.env.VITE_SUPABASE_*`), never the service_role key; add a lint/CI grep
  check for the string `service_role` in committed source as a tripwire.
- **PWA update UX**: `vite.config.ts` uses `registerType: 'autoUpdate'`, which should
  self-invalidate caches on new deploys already — but silent auto-update means a
  signed-in user could have a stale tab still using an old bundle against new backend
  schema. Add a visible "new version available — reload" toast on
  `registration.onNeedRefresh` rather than relying on silent takeover, since a public
  user base won't know to hard-refresh (matches the known "stale bundled data" issue
  from prior sessions).
- **Error boundaries**: add a top-level React error boundary so a render crash shows a
  friendly message instead of a blank tab — currently nothing catches this.

---

## Phase 4 — Observability, legal, and deploy — **done, 2026-08-01**

Shipped as planned except for hosting, where the choice landed on **Render** rather
than the Vercel/Netlify/Cloudflare options sketched below. The blueprint lives in
`render.yaml` at the repo root (static site, `npm ci && npm run build` → `dist`), which
also owns the security headers and CSP rather than leaving them in a dashboard.
Note for anyone touching build tooling: **Render auto-deploys `master`, so merging to
`master` is a production release** — see the dependency-upgrade note under "Ongoing
maintenance" below.

- **Error tracking**: Sentry free tier (5k events/mo) for the frontend; catches both
  render errors and Supabase call failures.
- **Uptime**: a free check (UptimeRobot/BetterStack) against the deployed URL.
- **Legal surface** (new, doesn't exist today): a short Privacy Policy (what's
  stored — roster/plan data, email for auth — and that it's not affiliated with
  Pocketpair) and Terms of Service; an account-deletion flow that actually cascades
  deletes across `rosters`/`saved_plans`/`teams`/`settings` (Postgres `ON DELETE
  CASCADE` on the `user_id` FK makes this trivial once the schema exists).
- **Hosting**: static hosting on Vercel/Netlify/Cloudflare Pages (free tier covers
  this comfortably — it's a client-rendered SPA, no server-side rendering need).
  Supabase free tier (500MB DB / 50k MAU / 5GB egress) is enough to launch on.
- **Cost estimate**: **$0–15/month** to start (hosting + Supabase free tiers + domain
  ~$12/yr), climbing to ~$25–50/month only once past free-tier limits (Supabase Pro).
  No proxy/VM cost since the live-server feature isn't part of the public deploy.

---

## Phase 5 — Reference UI polish (independent, non-blocking) — **done, 2026-08-01**

More professional visual polish on the Pal/Perk Reference UI (`src/ui` — the Reference
tab/bubbles feature), particularly the icons — these previously read as
functional-but-rough rather than production-grade. Didn't depend on or block any
account/backend work above; landed before public launch since it's one of the more
visible/first-impression surfaces for a stranger landing on the app.

---

## Ongoing maintenance — dependency upgrades against a live site

With the app deployed and `master` auto-deploying, dependency bumps are no longer
free. Two standing rules, established 2026-08-01 while triaging a Dependabot backlog:

- **CI green is not a deploy gate for anything that changes the build output.** The
  test suite covers solver/ruleset logic, not the shipped bundle. A bundler or build
  tooling major (e.g. Vite 8, which swaps Rollup for Rolldown) needs a preview build
  verified for three things CI can't see: `@sentry/vite-plugin` still emitting and
  uploading source maps (only runs when `SENTRY_AUTH_TOKEN` is set, i.e. on Render
  only), no CSP violations under `render.yaml`'s `script-src 'self'` (those headers
  don't exist locally), and the PWA update path behaving when every chunk hash changes
  at once (`registerType: 'prompt'` + `PwaUpdateToast`).
- **Tailwind majors are pinned off** in `.github/dependabot.yml`. v3 → v4 carries
  silent visual regressions — `outline-none` changes meaning, the `rounded`/`shadow`
  scales shift down a step, the default border color becomes `currentColor` — roughly
  180 class instances across 21 files here. Nothing in `test/` would catch one, and
  with the UI finished and live the blast radius is real users. Revisit as scheduled
  work with a deliberate visual diff, not as a merged bot PR.

---

## Phase 0 (do first, cheap) — Reconcile the docs — **done, 2026-07-17**

Updated `CLAUDE.md` (Audience line, Status section, the stale "Phase 0 UI unstyled"
invariant removed, "Out of scope" caveated rather than deleted), `docs/UI_REQUIREMENTS.md`
§1/§7, and added a new standalone `docs/PALWORLD_BREEDING_OPTIMIZER_SPEC.md` §13 ("Public
launch track") that cross-references this plan.

Note on sequencing: the spec already had its own "Phase 0/1/2" numbering (§10,
breeding-mechanics build phases — unrelated to this plan's Phase 0-5). Rather than adding a
colliding "Phase 2: public launch" entry as originally sketched here, §13 is a separate,
non-numbered section that just points back to this document — the two phase sequences never
share a name.

---

## Suggested sequencing

1. **Phase 0** (docs) — half a day, do it first so nothing else contradicts it.
2. **Phase 1** (accounts/sync) — the bulk of the work; ships as its own feature
   behind the existing guest experience, so it can go live incrementally.
3. **Phase 3** (CI) can happen in parallel with Phase 1 — it's independent and cheap,
   and you want CI in place *before* the Supabase schema work lands, not after.
4. **Phase 2** (onboarding copy) — do once Phase 1's auth entry points exist, so the
   copy can reference real UI.
5. **Phase 4** (observability/legal/deploy) — last, immediately before flipping the
   public switch.

## Verification

- Phase 1: unit tests for the new `remoteStore.ts` against a local Supabase instance
  (`supabase start` via the Supabase CLI) or mocked client, following the existing
  `test/` conventions (e.g. `test/live/dataSource.test.ts` as a pattern for testing an
  async data-fetching module); manual pass — sign up, add a roster entry, sign out,
  sign back in on a different browser profile, confirm data round-trips; confirm a
  second browser with pre-existing localStorage guest data gets the import prompt;
  confirm the production build never reaches the `fixtures.ts` mock path.
- Phase 2: manual click-through of each view as a fresh signed-out user, confirm no
  view shows a bare empty table and jargon terms have tooltips.
- Phase 3: open a PR with a deliberate lint/type error, confirm CI fails; confirm CI
  passes on `master`.
- Phase 4: run Lighthouse/PWA audit against the deployed URL; trigger a test error to
  confirm it lands in Sentry; delete a test account and confirm cascade deletes rows
  in Supabase.
- Phase 5: side-by-side screenshot of the Reference UI before/after, confirm icons
  render cleanly across the existing views.

Performance findings and their remediation are tracked separately — see
`PERFORMANCE_FINDINGS.md` and `PERFORMANCE_REMEDIATION_PLAN.md` — not duplicated here.
