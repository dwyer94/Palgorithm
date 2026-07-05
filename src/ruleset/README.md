# /ruleset

The swap seam (spec §4.2). `BreedingRuleset` interface + `combirank-0.6` impl now;
`genrecomb-1.0` later. All version-specific breeding logic (forward/reverse/passiveModel/
rankTable/specialCombos/reachability) lives ONLY here (CLAUDE.md invariant 1). Landed in
session 0.2.

## Files

- `types.ts` — the `BreedingRuleset` interface and its supporting types (`BreedingEdge`,
  `PassiveModel`, `ServerConfig`, …). The solver/UI depend only on this.
- `combirank.ts` — `createCombiRank06(dataset)`: the current (pre-1.0) ruleset.
- `index.ts` — `createRuleset(dataset)`: picks the impl from `dataset.meta.ruleset`; the
  central place the 1.0 swap plugs into.

## combirank-0.6 species algorithm (verified against PalCalc + the oracle harness)

Resolution order in `forward()`:

1. **Special combo** override. Gender-dependent combos return a `genderRatio`-weighted
   distribution when genders are omitted, or collapse to one child when both are given.
2. **Same-species shortcut**: `X × X → X` (matters when another species shares X's exact
   rank at a lower index).
3. **Formula**: `childRank = floor((rankA + rankB + 1) / 2)`; closest eligible rank wins;
   ties → lowest game-file `index`, then non-variant over variant.

Two non-obvious rules the harness pinned down:

- **Special-combo children are excluded from the formula pool** — "a Pal produced by a
  special combo can only be produced by that combo." Without this, special-only variants
  (e.g. Bastet_Ice / Mau Cryst) corrupt the closest-rank search.
- The tie-break is **`index`**, not "rarer rank" — but you only see genuine index ties once
  the special-only variants are removed from the pool.

## Testing

`test/ruleset/` holds the ruleset-vs-oracle harness (spec §11) against the vendored
beckerfelipee 138×138 matrix, plus unit tests for the formula, tie-breaks, special/gender
combos, `reverse()`, and `passiveModel`. The oracle is **base-game only**, so the harness
runs the algorithm over the oracle's 138-species universe to isolate formula correctness
from our 223-species dataset's DLC coverage. Keep it green — it is the 1.0 divergence
detector.
