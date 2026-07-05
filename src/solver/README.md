# /solver

Ruleset-agnostic planning (spec §7). `speciesPlanner` (min-combination AND/OR derivation),
`hubFinder` (multi-target + optional perk-carrier hub), `passivePlanner` (per-egg odds,
expected eggs), and shared `types`. Consumes only `BreedingEdge.outcomes` (a distribution),
`reverse()`, `rankTable`, and `genderRatio()` — never assumes a single deterministic child
(CLAUDE.md invariant 2). Sessions 0.3–0.4.

`speciesPlanner` (session 0.3, done) — Knuth-generalized Dijkstra over an AND/OR
hypergraph of `(species, gender)` nodes. Gender is part of the node identity because a
combination needs a fielded male *and* female (spec §7.1): a species stuck in one gender
is a real dead end, not cosmetic. A combo's cost is charged once even when its output
feeds multiple downstream branches (memoized per node) or is needed in both genders for a
self-cross (deduped by species-pair+child on reconstruction) — see the exactness caveat in
speciesPlanner.ts for why the raw Dijkstra distance isn't the same number as the deduped
plan's combination count. When a target is unreachable, `findAnchorHints` tests each
candidate species as a hypothetical zero-cost anchor and reports which ones would unlock
it, instead of a bare "no path found".
