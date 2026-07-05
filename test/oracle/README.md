# Breeding oracle fixture (ground truth for the ruleset)

Vendored **third-party** breeding data, used **only as an oracle** in the ruleset-vs-oracle test
harness (spec §11). This is the divergence detector: `combirank-0.6.forward()` must reproduce these
results, and the same harness flags where the 1.0 ruleset departs. It is **not** loaded by the app —
all app game-data comes from `src/data/dataset.<version>.json` (see the source-agnostic invariant in
CLAUDE.md). Quarantined here per the "community data is an oracle, not a schema driver" rule.

## Source & license

- Repo: **beckerfelipee/PalworldBreedingCalculator**
  <https://github.com/beckerfelipee/PalworldBreedingCalculator> (`Data/AllCombos.csv`, `Data/Pals.csv`).
- License: **MIT**, © 2024 Felipe Becker dos Santos — see `LICENSE.beckerfelipee`. Attribution
  required; keep that file alongside the data.
- Fetched 2026-07-04 from `main`.

## Files

- `Pals.csv` — 138 base-game species, **one per line, in the oracle's index order** (no header).
  The line number (0-based) is a species' index into the matrix.
- `AllCombos.csv` — a **138×138 semicolon-delimited, symmetric** child matrix, **no header row/col**.
- `LICENSE.beckerfelipee` — the upstream MIT license.

## Lookup semantics (from upstream `build.py`)

```
i = Pals.index(parentA)          # 0-based line number in Pals.csv
j = Pals.index(parentB)
child = AllCombos[i][j]          # symmetric: AllCombos[i][j] == AllCombos[j][i]
```

Cells are **English display names** → join to our data on `species.displayName`, not `id`.
The diagonal is self-breeding (`X × X → X`).

## Scope & caveats for the 0.2 harness

- **Base game only (138 species).** No Sakurajima/Feybreak Pals, so the harness tests the ruleset
  over the oracle's 138-species subset of our 223-species dataset — an inclusion check, not full
  coverage. Missing species are not failures.
- **Special combos:** confirm whether this matrix bakes in the ~28 special/unique combos or encodes
  only the standard CombiRank formula before wiring up `forward()` — the two must be compared on the
  same basis. Upstream treats "unique combos" as a separate list; verify against a couple of known
  specials (e.g. Relaxaurus + Sparkit → Relaxaurus Lux) when building the harness.
- **Name skew:** upstream display names may differ slightly from our EN extraction for a few Pals;
  build a small alias map in the harness if a join misses, rather than mutating either dataset.
