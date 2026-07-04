# Claude Design Brief — Palworld Breeding Path Optimizer

## How to use this
Hand this to Claude Design to design the app's frontend. It defines what the app does, the hard design problems, the constraints, and the priorities. Aesthetic direction is intentionally left open — exploring it is the point of the session. A functional but unstyled version of the app (from build session 0.5) exists to design against.

## The app in one paragraph
A personal breeding planner for Palworld. The user maintains a roster of Pals they own (species, gender, up to four passive perks each), then asks: "I want these target Pals carrying these perks — what's the most efficient way to breed them?" The tool returns ranked breeding plans optimized for the fewest distinct breeding steps, usually routing everything through one shared "hub" Pal. The user is a single technical power user working at a desk, not a mass audience.

## What makes this design non-trivial
The core challenge is making a breeding **plan** legible. A plan is a small tree/DAG: leaves are Pals the user owns or catches, internal nodes are breeding steps (parent + parent → child), the root is a target. With multiple targets, several trees share a hub. The design must make "put A + B in the farm → get C, then C + D → E …" instantly followable — including which perks ride along each branch and the odds of landing them. Get this one view right and the app succeeds.

## Primary design problems to solve
1. **Breeding-tree / DAG rendering** — draw a multi-step plan (and the shared-hub multi-target forest) so sequence and dependencies are obvious at a glance. This is the signature view; most of the design value is here.
2. **Ranked-plan presentation** — plans arrive as a small spectrum (a short chain with lower perk odds vs. a longer prep chain with higher odds). Make the tradeoff scannable: distinct-combination count leads; perk certainty and expected egg-rolls are secondary.
3. **Roster entry without tedium** — users may enter dozens of owned Pals, each with species + gender + up to four perks. Fast add/edit, plus JSON import/export.
4. **Target + perk selection** — picking target species and a shared perk set should be quick and reusable (saved perk sets).

## Views, in priority order
1. **Multi-target / hub planner** *(primary)* — pick several targets + a shared perk set → the union plan with its hub highlighted, plus ranked hub alternatives.
2. **Single-target planner** — one target + perks → ranked plans.
3. **Roster manager** — CRUD for owned Pals; import/export.
4. **Plan detail** — drill-in tree view for a chosen plan, with per-branch perk odds and any "need a rare anchor" warnings.
5. **Forward calculator** — two parents → child (quick utility).
6. **Reverse lookup** — a child → all parent pairs (utility).
7. **Settings** — allowed-catch policy, catch-cost weighting, saved perk sets, ruleset selector (for the post-1.0 fallback).

## Functional requirements the design must honor
- The plan/results view leads with the **distinct-combination count** and the ordered steps; perk probabilities, expected egg counts, and warnings are secondary detail.
- Plans must show which perks are being carried and where they get injected into the chain.
- "This target needs a rarer anchor than you own" is a first-class state, not an error toast.
- Rarity/rank is the binding constraint in every plan — consider surfacing it visibly.
- Elements (Fire, Water, Dragon, etc.) are core to Pal identity and useful for scanning and filtering.

## Constraints
- React + TypeScript + Tailwind, client-side only. Desktop-first (a planning tool used at a desk); responsive is nice-to-have, not required.
- Small data scale: ~150 Pals now, ~200 after the 1.0 update; plans are a handful of steps; rosters up to low hundreds of entries.
- No backend — everything renders from bundled JSON + localStorage.

## Aesthetic direction — open, to explore in-session
Deliberately unspecified, and it should **not** copy the FFXIV materia dashboard — this is a different kind of tool. Worth exploring: does it lean **game-companion** (Palworld's bright, rounded, creature-collector energy, element color-coding) or **power-tool** (dense, efficient, dark, IDE-like, for a technical user who lives in it)? Both are defensible; bring a couple of directions rather than committing blind. Palworld's own visual language is fair game as reference if leaning game-companion.

## Out of scope
- The solver, data pipeline, and breeding logic already exist — the design consumes their output, it doesn't change it.
- No auth, multiplayer, or sharing.

## Reference
Full product/architecture spec: `PALWORLD_BREEDING_OPTIMIZER_SPEC.md`. The exact data shapes the UI binds to — Pal record, owned-Pal roster entry, and ranked-plan output — are in spec §6–§7.
