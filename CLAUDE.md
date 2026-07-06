# CLAUDE.md

Guidance for Claude Code working in this repo. Read this first; full detail lives in `PALWORLD_BREEDING_OPTIMIZER_SPEC.md`, which is the source of truth. This file is the always-loaded quick reference and guardrails.

## Project

Palworld Breeding Path Optimizer — a personal, client-side tool that takes the Pals you own (species, gender, passives) and one or more target Pals (with a desired perk set) and returns the breeding plan reaching them in the **fewest distinct breeding combinations**. Built to survive Palworld's 1.0 breeding overhaul (Genetic Recombination, July 10 2026) by keeping all breeding rules behind a swappable interface.

Audience: one technical user, run locally / on a home server. Not a public product.

## Status

Phase 0 — build against the current CombiRank system. Sessions are defined in spec §10. Update the line below at the start of each working block:

> **Active session:** 0.6

## Stack

- React + TypeScript (strict) + Tailwind, built with Vite. No backend.
- Vitest for tests, ESLint + Prettier for lint/format.
- Game data bundled as static JSON; user data persisted via `localStorage`.

## Structure (established in session 0.1)

```
/src/data      dataset.<version>.json + loader
/src/ruleset   BreedingRuleset interface, combirank-0.6 impl, (later) genrecomb-1.0
/src/solver    speciesPlanner, hubFinder, passivePlanner, types
/src/store     localStorage roster/plans/settings
/src/ui        views + components (unstyled until session 0.D)
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
5. **Phase 0 UI is functional and unstyled.** Do not build visual design — that is session 0.D, with its own brief.

## Domain rules you'll get wrong without this

- Child species: `childRank = floor((rankA + rankB + 1) / 2)`; the eligible Pal with the closest rank wins; ties → lower game-file index.
- Lower rank = rarer. `childRank ≥ min(parentRanks)`, but the child is the *closest eligible* species so it can land modestly rarer than either parent (spec §3.2). Treat "you need a comparably-rare anchor" as strong reachability **guidance**, surfaced as a first-class result — never a silent failure. **Do not prune the search on "both parents rank > target"** — it drops valid paths; evaluate `forward()` instead (spec §7.1).
- ~60 species are capture/event/special-only — valid parents, never standard-breeding outputs.
- ~24–28 special combos override the formula; some depend on parent gender.
- Producing a species needs **both** parents → this is an AND/OR (hypergraph) derivation, not a simple shortest path. Use cheapest-derivation (Knuth–Dijkstra), memoizing produced intermediates at cost 0.
- Passives: 4 slots, an inheritance roll then a mutation roll; a passive can come from either parent; the odds of a specific set of 4 are maximized when the two parents jointly hold exactly those 4 and nothing else.

## Testing

Ruleset forward/reverse are unit-tested against the oracle repos (spec §11). **Keep these green** — the same harness is the divergence detector when the 1.0 ruleset lands. New solver logic gets fixture-based tests per the done-when criteria in spec §10.

## Out of scope / don't

- No backend, no server calls, no analytics, no auth.
- No visual/aesthetic design in Phase 0.
- Don't invent passive-inheritance percentages — load them from data; if a value is unknown, keep it configurable and flag it.
- Don't optimize for any objective other than combination-count without asking first.
