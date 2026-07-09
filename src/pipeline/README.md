# /pipeline

Offline Node CLI (spec §4.1). Normalizer (raw UE4SS/PalworldDataExtractor export → §6
schema) + the per-patch diff script. Run offline, never in the browser. Session 0.6.

## suggestHubs.ts — "suggested hubs" precompute

Generates `src/data/suggestedHubs.0.6.json`, the static data behind the Hub planner's
"jump-start with a popular pick" cards (combat/worker/mount) in `src/ui/HubView.tsx`.
Reuses the existing `findHubs`/`planUnion` solver entry points against an empty roster —
no new breeding math lives here (CLAUDE.md invariant #1).

```
npm run data:hubs
```

**To update or add a role's target list:** edit `src/pipeline/popularTargets.json`
(`{ role: [speciesId, ...] }`), then re-run `npm run data:hubs` and commit the
regenerated `suggestedHubs.0.6.json`.

Every species in the list must be:
- present in the current `dataset.<version>.json`,
- `standardBreedable: true`,
- **not self+self-only** in `ruleset.reverse(id)` — some apex/legendary species can only
  be bred by crossing two of themselves (they're catch-only to bootstrap; see the
  `apex-pals-self-only-breeding` memory note). One such species in a role's list makes
  *every* hub candidate infeasible for the whole batch, since a hub has to reach every
  target. `suggestHubs.ts` throws with a pointer to this check if a role comes back with
  zero hub candidates — if that happens, check `ruleset.reverse(id)` for whatever
  species you just added (the real dataset checks used to build the current lists are
  documented in git history for this file, or just re-run the same query: `reverse()`
  returning only `{parentA: id, parentB: id}` means self-only).

**To add a new role** (beyond combat/worker/mount): add a key to
`popularTargets.json`, and add a `{ label, icon }` entry to `ROLE_META` in
`src/ui/HubView.tsx` (falls back to the raw key + a ★ icon if omitted — the UI doesn't
need a code change to render a new role, just better to label it).

**Regenerate whenever `dataset.<version>.json` changes** (new game data, patch day) —
the suggestions are computed from the current dataset's ranks/reachability, so they go
stale otherwise. Not currently wired into `data:normalize`; run it manually as a
follow-up step.
