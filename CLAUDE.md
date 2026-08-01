# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first; full detail lives in `docs/PALWORLD_BREEDING_OPTIMIZER_SPEC.md`, which is the source of truth. This file is the always-loaded quick reference and guardrails.

## Project

Palworld Breeding Path Optimizer — a client-side web app that takes the Pals you own (species, gender, passives) and one or more target Pals (with a desired perk set) and returns the breeding plan reaching them in the **fewest distinct breeding combinations**. Built to survive Palworld's 1.0 breeding overhaul (Genetic Recombination, July 10 2026) by keeping all breeding rules behind a swappable interface.

**This is a live product**, deployed at https://palgorithm.dev with real users — not a
personal tool on one machine. Treat user-facing changes accordingly.

Audience: guest-first. The app works fully client-side with zero sign-in (local/home-server
use, unchanged), and an opt-in account layer (Supabase auth + cloud sync) lets a user's data
follow them across devices. The route from solo tool to public product is recorded in
`docs/PRODUCTION_READINESS_PLAN.md` as its own phase sequence, now complete (distinct from
the breeding-mechanics phases below, which this Status section tracks). The self-hosted
PalDefender-proxy live feature stays out of the public product either way — see that plan's
"explicitly out of scope."

## Status

Phase 1 — July 10 patch day (spec §5/§10) — **ingestion complete**. 1.0 shipped;
`combirank-0.6` confirmed unchanged post-launch (childRank formula, special combos, and
reachability all held), so it stays the live ruleset — `dataset.1.0.json` carries
`meta.ruleset: 'combirank-0.6'`. That dataset (**302 species**, including the Yakushima
additions) is wired in as the live data via `src/ui/RulesetContext.tsx` and
`src/solver/worker/solver.worker.ts`. `dataset.0.6.json` is retained for the oracle tests
only. The one open item is `genrecomb-1.0`: still unscaffolded, and there's nothing to
encode until Mutation/passive odds are published. Update the line below at the start of
each working block:

> **Active session:** none — Phase 1 ingestion done, `genrecomb-1.0` blocked on published odds

**Production readiness** (separate track, see `docs/PRODUCTION_READINESS_PLAN.md`): **all
phases done** — 1–3 (accounts/cloud sync, onboarding, CI/hardening) 2026-07-17; 4–5
(observability/legal/deploy, Reference UI polish) 2026-08-01. The app is live at
https://palgorithm.dev.

## Stack

- React + TypeScript (strict) + Tailwind, built with Vite. No backend of our own; Supabase (auth + RLS-scoped Postgres) backs the opt-in account layer only.
- Vitest for tests, ESLint + Prettier for lint/format. Sentry for error tracking.
- Game data bundled as static JSON; user data persisted via `localStorage`, synced to Supabase when signed in.
- **Deploy: Render static site, blueprint in `render.yaml`, auto-deploys `master`.** Merging to `master` ships to production — `render.yaml` also owns the CSP and security headers, which exist only in prod, so a build can pass CI and still break live.

## Structure (established in session 0.1)

```
/src/data      dataset.<version>.json + loader
/src/ruleset   BreedingRuleset interface, combirank-0.6 impl, (later) genrecomb-1.0
/src/solver    speciesPlanner, hubFinder, passivePlanner, types; worker/ runs it off the main thread
/src/store     roster/plans/settings — localStore (guest) + remoteStore (Supabase sync), both behind hooks.ts
/src/ui        views + components, incl. reference/ (Pal/Perk Reference)
/src/live      PalDefender-proxy connection: mock + HTTP data sources, normalizer, LiveContext
/src/pipeline  normalizer + diff scripts (Node CLI, run offline)
/test          ruleset-vs-oracle + solver unit tests
```

## Commands

`npm run dev` · `npm run test` · `npm run build` · `npm run lint` (scaffolded in 0.1; keep this list current if they change).

## Invariants — do not violate

1. **Breeding rules live only behind `BreedingRuleset`.** Never hardcode CombiRank math, special combos, or passive odds into the solver or UI.
2. **The solver consumes edge outcomes as a probability distribution.** `combirank-0.6` is deterministic *given both parent genders*, but gender-dependent special combos with genders omitted return a multi-outcome split, so even today an edge isn't always one outcome at p=1. Never assume a single deterministic child. This is precisely what lets the 1.0 ruleset swap in without a solver rewrite.
3. **All game data is loaded from the dataset JSON** — ranks, special combos, reachability, passive-inheritance odds. 1.0 will change these values; hardcoding them defeats the design.
4. **Objective = fewest _distinct_ breeding combinations.** Shared intermediates are counted once. Re-breeding the same pair to re-roll passives is not a new combination.

## Domain rules you'll get wrong without this

- Child species: `childRank = floor((rankA + rankB + 1) / 2)`; the eligible Pal with the closest rank wins; ties → lower game-file index.
- Lower rank = rarer. `childRank ≥ min(parentRanks)`, but the child is the *closest eligible* species so it can land modestly rarer than either parent (spec §3.2). Treat "you need a comparably-rare anchor" as strong reachability **guidance**, surfaced as a first-class result — never a silent failure. **Do not prune the search on "both parents rank > target"** — it drops valid paths; evaluate `forward()` instead (spec §7.1).
- ~60 species are capture/event/special-only — valid parents, never standard-breeding outputs.
- Being *obtainable* and being a *legal parent* are different axes. A couple of Pals (Panthalus, Astralym) carry a real rank but can't be assigned to a breeding station at all → `breedingParentEligible: false` in the dataset, `ruleset.canBeParent()` behind the seam. Absent = eligible. Never enumerate parents from `rankTable` without filtering on it.
- ~24–28 special combos override the formula; some depend on parent gender.
- Producing a species needs **both** parents → this is an AND/OR (hypergraph) derivation, not a simple shortest path. Use cheapest-derivation (Knuth–Dijkstra), memoizing produced intermediates at cost 0.
- Passives: 4 slots, an inheritance roll then a mutation roll; a passive can come from either parent; the odds of a specific set of 4 are maximized when the two parents jointly hold exactly those 4 and nothing else.

## Testing

Ruleset forward/reverse are unit-tested against the oracle repos (spec §11). **Keep these green** — the same harness is the divergence detector when the 1.0 ruleset lands. New solver logic gets fixture-based tests per the done-when criteria in spec §10.

## Out of scope / don't

- The local/guest path stays backend-free and unauthenticated by design — no server calls, no
  analytics for that path. On top of it, `docs/PRODUCTION_READINESS_PLAN.md`'s opt-in account
  layer (Supabase auth + RLS-scoped sync) now exists (Phases 1–3 done); still no analytics
  anywhere in the app.
- Don't invent passive-inheritance percentages — load them from data; if a value is unknown, keep it configurable and flag it.
- Don't optimize for any objective other than combination-count without asking first.
