# /solver

Ruleset-agnostic planning (spec §7). `speciesPlanner` (min-combination AND/OR derivation),
`hubFinder` (multi-target + optional perk-carrier hub), `passivePlanner` (per-egg odds,
expected eggs), and shared `types`. Consumes only `BreedingEdge.outcomes` (a distribution)
and `reverse()` — never assumes a single deterministic child (CLAUDE.md invariant 2).
Sessions 0.3–0.4.
