# Palworld Breeding Path Optimizer — Requirements & Implementation Spec

**Status:** Draft for Claude Code handoff
**Target game version:** Palworld 0.6.x (current) → 1.0 (Genetic Recombination, launches July 10 2026)
**Deployment:** Personal use. Client-side React app, run locally / on home server.
**Author context:** Companion tool in the same family as the PoE2 inverse crafting calculator — goal-driven, "give it what I have and what I want, get ranked paths."

---

## 1. Objective

A goal-driven Palworld breeding planner. The user inputs the Pals they own (with passives and genders) and one or more target Pals (optionally with a desired passive/perk set), and the tool returns the plan that reaches the target(s) using the **fewest distinct breeding combinations**.

The tool must survive the 1.0 breeding overhaul with minimal rework: all breeding *rules* live behind a swappable interface so that when Genetic Recombination lands, we replace the rule implementation and dataset without touching the solver, storage, or UI.

**This is not a race against incumbent calculators.** It's a personal, well-architected tool the author fully understands and can adapt on patch day. Incumbents (paldb.cc, palworld.gg, pindrop.gg, XGamingServer, Game8) already do forward/reverse lookup and some shortest-chain search; we borrow their validated data as a correctness oracle, but the objective function and the hub-centric multi-target planning are ours.

---

## 2. Core problem statement

### 2.1 Definitions

- **Breeding combination:** an unordered pair of parent *species* placed in the farm to produce a child, e.g. `(Relaxaurus, Sparkit) → Relaxaurus Lux`. Distinct combinations are the unit we minimize.
- **Plan:** a set of breeding combinations that, starting from owned Pals (plus any Pals the user allows themselves to catch), produces all target species. For multiple targets the plan is a **forest/DAG**; a shared intermediate is one combination counted **once**.
- **Cost of a plan:** the number of *distinct* combinations in it. Re-breeding the same pair repeatedly to re-roll passives does **not** increase cost — that's egg-rolls, tracked separately as a certainty metric, not a combination count.

### 2.2 The two-stage decomposition

Species and passives are solved in two stages, because in the current game a passive can be inherited from *either* parent regardless of species, making the passive layer largely independent of the species path:

1. **Species stage (deterministic):** find the minimum-combination breeding DAG from the roster to the target species.
2. **Passive stage (probabilistic overlay):** decide where along that DAG to inject the desired perks, and report the per-egg probability and expected egg count to land them.

### 2.3 Single-target vs multi-target

- **Single target:** minimum-combination derivation of one species from the roster. When perks are desired, §7.3's two modes both apply — the cheapest derivation with perks landed opportunistically at the final cross where free, and (separately) a guaranteed-carrier derivation that forces the full desired set in, preferring the final cross but threading carriers upstream when that's not possible. No hub — if you know exactly where you're going, routing through a shared carrier adds work, not saves it.
- **Multi-target + shared perks:** produce N target species all carrying perk set P. Here a **hub** becomes worthwhile *as an option*: breed one individual loaded with P, then reuse that same perked Pal as a **direct parent** across the final cross toward each target, stamping the perks into many species with minimal rework. The hub is a convenience for "one good Pal I can breed in multiple directions," **not** a mandatory routing point — the optimizer always also offers the plain per-target plan and lets the combination count decide. See §7.2 for how the hub is chosen and §7.3 for why direct-parent injection keeps the perk odds simple.

---

## 3. Breeding mechanics — current (pre-1.0) baseline

Everything in this section is the **default ruleset** and is explicitly swappable (see §5). Values are extracted from game files, not hardcoded, and cross-checked against open-source data (see §11).

### 3.1 Species determination (CombiRank)

- Each Pal has a hidden breeding rank ("CombiRank" / breeding power), roughly **10–1500**; lower = rarer/stronger.
- `childRank = floor((parentA.rank + parentB.rank + 1) / 2)`
- Child = the eligible Pal whose own rank is **closest** to `childRank`. Ties → the Pal with the **lower game-file index**.
- **Special combos** (~24–28 pairs) override the formula entirely and always yield a fixed subspecies (e.g. `Relaxaurus + Sparkit → Relaxaurus Lux`). Some are gender-dependent (e.g. Katress/Wixen). ~12 Pals are produced only from two parents of the same species. The full list comes from extracted data / the reference repos.

### 3.2 Two consequences the solver must exploit

- **Rarest-parent bound (approximate, not strict):** because `childRank` is an average, `childRank ≥ min(parentRanks)` always holds. But the *child species* is the eligible Pal **closest to** `childRank`, not `childRank` itself, and the nearest breedable species can sit slightly *below* it — especially near the ~60 capture-only ranks that have no breedable species at them. So a child can end up modestly rarer than either parent (by up to ~half the gap to the next-lower breedable rank). Treat the bound as strong **guidance** ("to reach a rank-`r` target you almost certainly need an anchor of rank ≤ `r`-ish"), not as a hard filter. See §7.1 for how this constrains pruning.
- **Reachability is three-way, not binary.** The solver's cost base case and its anchor guidance both depend on *how* a non-owned species can be obtained, so classify every species as one of:
  - **`standardBreedable`** — can appear as a breeding output (a derivable node).
  - **`wildCatchable`** — obtainable in the wild at catch-cost (a valid, user-suggestable anchor). ~60 species are non-standard-breedable but many of *these* are wild-catchable.
  - **`otherObtainOnly`** — event / raid / tower-boss / shop-only, etc.: a valid *parent if already owned*, but **never** something the tool may tell you to "go catch." Recommending one of these as an anchor is a bug.
  A species can be both `standardBreedable` and `wildCatchable`. The critical distinction is `wildCatchable` vs `otherObtainOnly`: only the former may seed the "need an anchor of rank ≤ X" suggestion.

### 3.3 Passive (perk) inheritance

- 4 passive slots. Two rolls per egg: an **inheritance roll** (how many of the combined parent passives carry to the child) then a **mutation roll** (random passives added if slots remain; skipped if inheritance already filled all 4).
- A passive can pass from either parent; it doesn't matter which parent holds it; duplicates across parents are ignored.
- Landing a *specific* set of 4 is maximized when the two parents together hold exactly those 4 and nothing else (2+2 / 3+1 / 4+0 distributions are equivalent). Extra perks in the pool dilute the odds combinatorially.
- The exact inheritance-count probability distribution is **loaded from data** (community-verified table / extracted values), never hardcoded — 1.0 may change it.
- **Data-availability caveat.** Unlike the species tables, these odds are **not reliably present in the §11 oracles** — the community values are estimates and may not be cleanly extractable. So the passive distributions ship as **configurable, explicitly-flagged-`unverified` defaults** from day one (a best-known placeholder table), surfaced in the UI as provisional. This keeps the passive planner (§7.3, session 0.4) unblocked whether or not verified numbers ever materialize, and cleanly swappable when they do. Never present placeholder odds as authoritative.

---

## 4. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Data pipeline (offline, run per patch)                      │
│  UE4SS → Mappings.usmap → PalworldDataExtractor → raw JSON    │
│  → normalizer → dataset.<version>.json                       │
└───────────────────────────┬─────────────────────────────────┘
                            │  bundled as static asset
┌───────────────────────────▼─────────────────────────────────┐
│  BreedingRuleset  (the swap seam)                            │
│  forward() · reverse() · passiveModel · rankTable ·          │
│  specialCombos · reachability · isDeterministic              │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  Solver                                                      │
│  speciesPlanner (min-combination derivation, AND/OR graph)   │
│  hubFinder (multi-target)                                    │
│  passivePlanner (per-egg odds, expected eggs)                │
└───────────────────────────┬─────────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────────┐
│  React / TS / Tailwind UI   +   localStorage (roster, plans) │
└──────────────────────────────────────────────────────────────┘
```

### 4.1 Data pipeline (offline)

Per the original brief, unchanged and correct:

- **UE4SS** installed into `Palworld\Pal\Binaries\Win64`, console enabled via `UE4SS-settings.ini`. Generate `Mappings.usmap` from the running game (UE4SS Dumpers tab, or standalone `TheNaeem/UnrealMappingsDumper`). Regenerate on every patch — the mapping is build-specific.
- **PalworldDataExtractor** (`PalworldDataTools/PalworldDataExtractor`) pointed at `Palworld\Pal\Content\Paks` with the fresh `.usmap` and correct UE version. `.pak` needs no AES key; the mapping is the only blocker.
- Key tables: `DT_PalMonsterParameter.uasset` (stats + CombiRank), `DT_PalNameText.uasset` (internal ID → display name). Special-combo tables as identified.
- Output raw JSON → run through a **normalizer** into the clean schema (§6). On 1.0, diff the fresh export against the pre-1.0 export to spot new/renamed breeding fields fast.
- **Run extraction only in offline/single-player.** No online sessions during dumping.

### 4.2 BreedingRuleset — the swap seam

The one interface that isolates all game-version-specific breeding logic. TypeScript sketch:

```ts
interface BreedingEdge {
  parentA: SpeciesId;
  parentB: SpeciesId;
  // Deterministic rulesets emit one child at probability 1.
  // Two things can make outcomes a real distribution even in combirank-0.6:
  //   - gender-dependent special combos when parent genders are unknown (see below);
  //   - probabilistic / server-dependent rulesets (see §5).
  outcomes: { child: SpeciesId; p: number }[];
}

interface PassiveModel {
  maxSlots: number;                       // 4 today
  inheritCountDist: number[];             // P(inherit k passives), loaded from data
  mutationDist: number[];                 // P(add m random passives)
  verified: boolean;                      // false = placeholder estimates (see §3.3); UI must flag as provisional
  // Returns P(child ends with exactly / at least the desired set)
  landOdds(parentA: Passive[], parentB: Passive[], desired: Passive[]): {
    exactSet: number; supersetContaining: number;
  };
}

interface BreedingRuleset {
  version: string;                        // e.g. "combirank-0.6", "genrecomb-1.0"
  isDeterministic: boolean;

  // genderA/genderB are optional: supply them to resolve gender-dependent special
  // combos to a single child; omit them and forward() returns the gender split as a
  // distribution in BreedingEdge.outcomes (e.g. 50/50 Katress vs Wixen-variant).
  forward(a: SpeciesId, b: SpeciesId, opts?: { genderA?: Gender; genderB?: Gender }, ctx?: ServerConfig): BreedingEdge;
  reverse(target: SpeciesId, ctx?: ServerConfig): { parentA: SpeciesId; parentB: SpeciesId }[];

  rankTable: Record<SpeciesId, number>;
  specialCombos: { parents: [SpeciesId, SpeciesId]; child: SpeciesId; genderRule?: GenderRule }[];
  // Three-way (see §3.2): only wildCatchable species may be suggested as a catch/anchor;
  // otherObtainOnly are valid parents only when already owned.
  reachability: {
    standardBreedable: Set<SpeciesId>;
    wildCatchable: Set<SpeciesId>;
    otherObtainOnly: Set<SpeciesId>;
  };

  passiveModel: PassiveModel;
}
```

**Design mandate:** the solver consumes only `BreedingEdge.outcomes` (a distribution) and `reverse()`. The CombiRank ruleset's species outcome is deterministic *given both parent genders* (`isDeterministic: true` is scoped to that) — but for the handful of **gender-dependent special combos**, `forward()` with genders omitted legitimately returns a multi-outcome distribution, so even combirank-0.6 exercises the distribution path. The solver must be written against the distribution form from day one. This is the single most important future-proofing decision: if Genetic Recombination turns out non-deterministic or server-dependent, we swap the ruleset and pass a `ServerConfig`, and the solver already handles it.

### 4.3 Solver

Three cooperating modules, all ruleset-agnostic (§7).

### 4.4 Frontend

React + TypeScript + Tailwind, fully client-side, dataset bundled as a static JSON asset. The 138×138 (→ ~200×200 post-1.0) combination space is trivial to search in-browser; no backend.

**Visual design is explicitly out of scope for Phase 0 and gets its own session (§10).** This tool will not resemble the FFXIV materia dashboard — a breeding-path planner is a different interaction model (graph/tree output, roster management, ranked plans) and deserves its own design pass. Phase 0 ships a deliberately minimal, unstyled functional UI whose only job is to exercise the solver end-to-end; the design session replaces it later.

### 4.5 Storage

`localStorage`, JSON-serialized:
- `roster` — the user's owned Pals (§6.3).
- `savedPlans` — starred plans for reference.
- `settings` — allowed-catch policy, preferred perk sets, server-config presets (for the 1.0 contingency).

(IndexedDB is the upgrade path only if roster/plan history outgrows localStorage, which is unlikely for personal use.)

---

## 5. The 1.0 migration plan

Build the entire app now against the CombiRank ruleset and validate it against the open-source repos as ground truth. On/after July 10:

1. Patch the game → regenerate `Mappings.usmap` (confirm UE4SS attaches; if Pocketpair bumped the UE5 point version, UE4SS may need a maintainer update — check first thing, it's outside our control).
2. Re-run extraction → produce `dataset.1.0.json`.
3. **Diff** against the pre-1.0 dataset and read the 27-page patch notes to classify what changed.
4. Implement a new `BreedingRuleset` (`genrecomb-1.0`) reflecting the change. Keep `combirank-0.6` as a selectable fallback.
5. Cross-check against Palworld Modding Discord findings as the community reverse-engineers in parallel.

**What we already know about the 1.0 change (informs contingency design):** Genetic Recombination is described consistently as a system for fusing high-tier/Legendary Pals into variant offspring that inherit specific traits, with outcomes that appear to vary by **server settings**. Full mechanics are unknown until launch. Two open possibilities the architecture must absorb:

- **Layer, not replacement.** Ordinary "parent + parent → child species" breeding may survive largely intact, with Genetic Recombination added on top for Legendary variants. If so, the CombiRank ruleset stays mostly valid and we add a *second* ruleset/mode for the fusion system rather than replacing the first.
- **Server-dependent / non-deterministic outcomes.** If the same pairing yields different results by server config, `forward()` takes a `ServerConfig` and returns a real distribution — which is exactly why the solver is built on the distribution form. The UI then needs a server-config input (presets in settings).

Map of likely-change → code touchpoint:

| If 1.0 changes… | Touchpoint |
|---|---|
| Rank values / new Pals | `dataset.*.json` only (pipeline re-run) |
| The species formula | `forward()` / `reverse()` in the new ruleset |
| Special-combo list | `specialCombos` data |
| Passive slot count or inheritance odds | `passiveModel` data + `inheritCountDist` |
| Determinism (server-dependent) | `isDeterministic=false`, `ServerConfig` plumbing, UI config input |
| A wholly new fusion mechanic | new ruleset + new UI mode; solver unchanged if it emits standard edges |

---

## 6. Data schema

### 6.1 Pal (species) record

```jsonc
{
  "id": "Relaxaurus_Lux",          // stable internal id
  "displayName": "Relaxaurus Lux",
  "paldexNo": "096B",
  "rank": 470,                      // CombiRank / breeding power
  "elements": ["Dragon", "Electric"],
  "genderRatio": { "male": 0.5, "female": 0.5 },
  "standardBreedable": true,        // can appear as a breeding output
  "wildCatchable": true,            // obtainable in the wild → may be suggested as an anchor
  "otherObtainOnly": false,         // event/raid/boss/shop-only → valid parent only if owned, never "go catch"
  "obtain": ["breed", "capture"],   // human-readable acquisition routes (freeform)
  "index": 812                      // game-file index, for tie-breaks
}
```

### 6.2 Special combo record

```jsonc
{
  "parents": ["Relaxaurus", "Sparkit"],
  "child": "Relaxaurus_Lux",
  "genderRule": null                // or e.g. { "femaleParent": "Wixen", "child": "Wixen_Noct" }
}
```

### 6.3 Owned Pal (roster entry — user data, localStorage)

```jsonc
{
  "uid": "u_00187",                 // local unique id
  "species": "Rayhound",
  "gender": "male",
  "passives": ["Swift", "Runner", "Nimble"],
  "notes": "caught, lvl 1"          // optional
}
```

### 6.4 Passive/perk record

```jsonc
{ "id": "Legend", "displayName": "Legend", "tier": 3, "category": "combat" }
```

---

## 7. Solver design

### 7.1 Species planner — minimum-combination derivation

This is **not** a plain shortest path. A combination has *two* required inputs, so producing a species is a derivation in an **AND/OR graph** (equivalently, cheapest derivation in a grammar). Use the Knuth generalization of Dijkstra for AND/OR / hypergraph shortest derivations:

- `cost(species)` = 0 if owned; = catch-cost (default small constant, configurable, ∞ if the user disallows catching it) **only if `wildCatchable`** — `otherObtainOnly` species are never a catch base case, they enter a plan solely by being on the roster; otherwise `min` over all combinations `(A,B) → species` of `cost(A) + cost(B) + 1`.
- Relax to a fixpoint with a priority queue keyed on current best cost (monotone because combination cost is +1 and parent costs are non-negative). Memoize produced intermediates at cost 0 once produced so shared subderivations aren't double-counted.
- Reconstruct the derivation DAG for the plan.
- **Gender feasibility (a real constraint, not cosmetic).** Every breed needs a **male and a female**. The species cost above is necessary but not sufficient: a node is only truly *producible* if, at each combination, both an eligible male and an eligible female can be fielded. Two failure modes the planner must catch:
  - *Single-gender holding / dead pair:* you own or can produce a species but only in one gender and can't obtain the other (e.g. it's breed-only and every route yields the same gender you already have) → that branch is infeasible, surface it rather than emitting an impossible plan.
  - *Skewed `genderRatio`:* producing the needed gender of a heavily-skewed species (e.g. 90/10) inflates expected eggs; carry the ratio into the expected-egg estimate (§7.3/§7.4), don't assume 50/50.
  Model this as a feasibility check + gender-aware base case: a roster entry supplies exactly its own gender at cost 0; a wild catch can supply either gender (subject to the species' ratio) at catch-cost. Keep it a first-class result, not a silent prune.

> **Exactness caveat — read before writing the tests.** Knuth–Dijkstra minimizes the *additive* derivation cost (a tree). Our objective is *distinct combinations, shared intermediates counted once* (a DAG). Those coincide only when the optimal derivation has no internal reuse. When a single target's derivation reuses an intermediate across two sub-branches, additive cost double-counts it — this is the same sharing/Steiner problem §7.2 flags for multi-target, and it exists **within a single target** too. The "memoize produced intermediates at cost 0" step is the mitigation, but it makes the result **order-dependent** (which combo you realize first changes later costs), so it is a **greedy heuristic, not a proven optimum**. Given the graph size (~138 species), a single-target *exact* optimum via brute force / ILP over sub-hypergraphs is feasible if we want it; otherwise treat §7.1 output as minimal-or-near-minimal and rely on the fixtures to catch regressions.
- **Pruning (must stay sound):** the rarest-parent bound guides pruning but does **not** license the naïve rule "ignore combinations whose both parents have rank > `r`." Because the child is the *closest eligible* species, two parents both slightly rarer-side of `r` can still round to a target at `r`, so that rule would discard valid paths. Prune by actually evaluating `forward()` on candidate pairs (cheap at this graph size), or, if you want a rank filter, apply it with a margin ≥ the largest adjacent breedable-rank gap. The bound's legitimate use is *reachability guidance*: if no owned/catchable anchor is anywhere near rare enough, return the explicit "need an anchor of rank ≤ X" result instead of failing silently.

### 7.2 Hub finder — multi-target

The hub is an **optional** overlay on the multi-target species plan, offered only when the targets share a perk set P. It is the *perk carrier* of §7.3 — one individual you load with P once and reuse as a **direct parent** toward several targets — not a separate species intermediate the DAG must pass through. Its value is saving perk-injection work, not saving species combinations.

Given targets `T1..Tn` (+ shared perk set P):

- **Baseline species plan (always produced).** Exact minimum-combination for a *set* of targets is a directed Steiner forest (NP-hard). At this graph size a good heuristic is more than sufficient: compute each target's cheapest derivation (§7.1) sharing a global memo, so intermediates reused across targets are free after first production. The union DAG's distinct-combination count is the plan cost. This plan stands on its own; the hub is additive.
- **Candidate hubs (the optional overlay).** Score each plausible carrier species `H` by `obtainCost(H) + Σ_i injectCost(H → Ti)`, where `injectCost` strongly prefers hubs that can be a **direct parent** of `Ti` (a single final cross), since that is what lets one perked individual serve many targets. Penalize hubs that only reach a target through intermediates: perks would then have to survive extra inheritance rolls (§7.3), so those branches are worth less. Surface the top hubs as "load P onto one of these, then branch to each target in one cross."
- Return the baseline union plan **plus** the ranked hub suggestions as an alternative, and let the user compare. Never force the hub — for a single target, or when no carrier reaches the targets in short branches, the plain per-target plan wins.

### 7.3 Passive planner — two explicit modes

*(Revised session — see git history for the prior single-mode text this replaces. The rewrite was triggered by a concrete bug: with two desired perks each carried by a different owned Pal, the guaranteed-carrier overlay returned two separate single-perk trees — an OR — instead of one tree carrying both — an AND. Root cause: the overlay's forced-carrier search was scoped to one carrier / one passive from the start (session 0.4c) and never generalized when multi-perk targets showed up. This section now specifies the two-mode split explicitly so that generalization is a requirement, not an afterthought.)*

Given a species DAG (§7.1) and a desired perk set P (≤ 4):

**Mode 1 — no desired perks.** Cheapest species derivation only (§7.1). No passive computation at all.

**Mode 2 — desired perk set P given.** Compute and display **both** of the following side by side, always, whenever P is non-empty — never gated behind a separate user action, and never silently collapsed into one answer:

- **2a. Opportunistic (zero added cost).** The cheapest species derivation, unmodified — identical combination count to Mode 1. Among final-cross parent choices *tied* at minimum cost, prefer whichever supplies the most of P for free (existing tie-break logic — this never adds a combination, it only chooses among already-equal-cost options). Per perk in P, report either "lands here for free, X% odds" or "not present in this plan — only obtainable by chance during breeding, or by re-rolling/relocating afterward." This is always the cheapest possible answer; any certainty it offers is incidental, not engineered.

- **2b. Guaranteed-carrier.** Explicitly force owned carrier(s) into the derivation's ancestry so P's presence is structural rather than luck (still probabilistic per egg — "in the tree" means the inheritance/mutation roll happens with real odds, not that the perk is certain). **Must combine all of P into one lineage/tree whenever a route exists** — a set of desired perks is an AND requirement on the result, never split into independent per-perk trees.
  - **Partial routing.** If the full set P can't be jointly routed (no combination of owned carriers reaches the target together), report the single largest jointly-routable subset as one tree, and separately list the rest of P as infeasible with a reason: "no owner" (nothing in the roster carries it) vs "owned but no feasible breeding route." *(Future option, not built now: instead of collapsing to one largest-subset tree, rank several partial-subset trees by combination cost and let the user choose which subset to guarantee. Documented here as a known extension point, deferred until there's a concrete case that needs it.)*
  - **Prefer combining at the final cross.** When two (or more) carriers each hold a disjoint useful part of P and can each reach the target's final cross directly, use them as the two final parents — single-cross odds, no compounding, matches the "inject at the final cross, not upstream" principle below.
  - **Multi-carrier search.** When final-cross combination isn't possible, thread carriers together upstream by generalizing the existing single-carrier tainted-graph search (`findForcedCarrierRoute`) from one taint bit ("is this node on the forced carrier's lineage") to a **bitmask over the perks in P**: each carrier seeds the bits for the perks it holds (a single Pal holding two of P seeds both bits at once), each breeding combination ORs its two input bitmasks together, and the search targets the cheapest node reaching the fullest bitmask achievable. This one mechanism covers both "one Pal already has multiple desired perks" and "different Pals each have different desired perks" — no separate code paths.
  - **Carrier selection.** When multiple owned individuals could each serve as carrier for the same perk (or overlapping subsets of P), auto-pick whichever combination yields the lowest total combination cost — consistent with the planner's cost-driven design throughout §7. *(Future option, not built now: let the user pin a specific individual as the forced carrier, e.g. to preserve a particular IV/gender they care about.)*
  - **No cost cap.** Guaranteed-carrier plans are never hidden for being "too expensive" — always surface the real combination delta (2b's count minus 2a's) and let the user judge, consistent with this codebase's "surface, don't silently prune" philosophy (§7.1's anchor-hint guidance).
  - Flag any branch where the combined carrier survives more than one breeding step as a certainty risk, showing per-step odds, not just the final compounded number.

**Shared mechanics (both modes read the same odds model):**

- **Inject at the final cross, not upstream** is the default strategy for 2b, not a hard rule — see "prefer combining at the final cross" above. The carrier *is* the multi-target hub of §7.2 when several targets share P.
- **If perks must ride through intermediates,** the survival probability **compounds per step** (a fresh inheritance roll each breed) — multiply the odds along the branch, and flag it as a certainty risk per above.
- Compute per-egg landing probability via `passiveModel.landOdds()` from the two parents' perk pools, and derive **expected eggs** to hit the target set. Report both, for both 2a's opportunistic parents and 2b's guaranteed carriers.
- Flag pollution: if a parent carries perks outside P, show how much they lower the odds and suggest breeding a cleaner parent first (a cost-vs-certainty tradeoff, surfaced not auto-decided).

**UI requirement (both modes).** Every displayed tree states outright which mode produced it (opportunistic vs. guaranteed) and what its guarantee actually is. No case silently drops a desired perk without saying why (no owner / owned-but-no-route / available-but-not-chosen).

### 7.4 Output — ranked plans

Each returned plan reports: distinct-combination count (the primary sort key), the ordered breeding steps (which pair → which child), required catches/anchors, per-branch perk-landing probability and expected eggs, and any "rare anchor needed" warnings. Where a shorter chain trades away perk certainty, present the alternatives as a small ranked spectrum rather than a single answer.

---

## 8. Frontend views

1. **Roster manager** — add/edit/remove owned Pals (species, gender, passives, notes). Persisted to localStorage. Import/export JSON.
2. **Single-target planner** — pick a target species + optional desired perks → ranked plans (§7.4).
3. **Multi-target / hub planner** *(primary view)* — pick several targets + a shared perk set → union plan + ranked hub suggestions.
4. **Forward calculator** — pick two parents → predicted child (sanity tool; validates the ruleset visually).
5. **Reverse lookup** — pick a child → all parent pairs (raw, unranked; the building block behind the planners).
6. **Settings** — allowed-catch policy, catch-cost weighting, saved perk sets, and (for the 1.0 contingency) server-config presets + active ruleset selector.

For Phase 0 these are **functional, unstyled** — the goal is to drive the solver, not to look finished. The one functional requirement for the results view is legibility of substance: lead with the combination count and the step list; put probabilities and warnings as secondary detail. All visual/interaction design (layout, how the breeding tree is drawn, styling) is deferred to the dedicated design session in §10.

---

## 9. Project structure & stack

```
/src
  /data        dataset.<version>.json (bundled), loader
  /ruleset     BreedingRuleset interface, combirank-0.6 impl, (later) genrecomb-1.0
  /solver      speciesPlanner, hubFinder, passivePlanner, types
  /store       localStorage roster/plans/settings
  /ui          views + shared components (Tailwind)
  /pipeline    normalizer + diff scripts (Node CLI, run offline)
/test          ruleset correctness vs oracle data, solver unit tests
```

- React + TypeScript + Tailwind, Vite. No backend.
- **Testing is load-bearing for the swap strategy:** unit-test the `combirank-0.6` ruleset's `forward()`/`reverse()` against known combinations extracted from the reference repos (§11) so that, post-1.0, the same test harness immediately tells you how far the new ruleset diverges from the old.

---

## 10. Build phases

Phase 0 is deliberately split into small, independently-shippable Claude Code sessions. Each has a single focus, a clear dependency, a concrete deliverable, and an explicit done-when so a session can be started and closed cleanly. Sessions are ordered by dependency; 0.1 and 0.2 can bootstrap on oracle data so app work isn't blocked on the local extraction.

### Phase 0 — build against the current (CombiRank) system

**Session 0.1 — Project scaffold + schema + dataset bootstrap**
- *Goal:* stand up the repo and lock the data schema (§6), producing a first working `dataset.0.6.json`.
- *Depends on:* nothing.
- *Deliverable:*
  - **Scaffold first:** `git init`; Vite + React + TypeScript (strict) + Tailwind; Vitest, ESLint, Prettier; the `/src` skeleton (§9); the four `npm` scripts (`dev`/`test`/`build`/`lint`). This is the setup CLAUDE.md already assumes happened here.
  - Schema types + a dataset populated from the MIT-licensed oracle repos (§11) as a stand-in, plus a JSON-schema validator.
- *Done when:* the project builds, lints, and runs an empty test; a validated `dataset.0.6.json` loads and every record conforms; the **three-way reachability** (`standardBreedable`/`wildCatchable`/`otherObtainOnly`, §3.2), per-species `genderRatio`, and special combos are all represented; and a placeholder **`verified:false` `passiveModel`** table (§3.3/#4) is present so 0.4 isn't gated on passive-odds data.
- *Note:* uses oracle data so later sessions aren't gated on the local UE4SS extraction (which happens in 0.6). Confirm each vendored oracle repo's license before bundling.

**Session 0.2 — Ruleset + data layer**
- *Goal:* the swap seam and the current ruleset.
- *Depends on:* 0.1.
- *Deliverable:* `BreedingRuleset` interface (§4.2) + `combirank-0.6` implementation (forward/reverse/passiveModel/rankTable/specialCombos/reachability) + dataset loader.
- *Done when:* unit tests pass forward and reverse against a fixture of known combinations from the oracle repos, including special-combo overrides and tie-breaks. No UI, no solver.

**Session 0.3 — Species planner**
- *Goal:* minimum-combination derivation.
- *Depends on:* 0.2.
- *Deliverable:* `speciesPlanner` — the AND/OR cheapest-derivation solver (§7.1) with rarest-parent pruning and the "need an anchor of rank ≤ X" result.
- *Done when:* given a fixture roster + single target, it returns a minimal-or-near-minimal combination DAG that matches the hand-computed optimum on the fixtures (see the exactness caveat in §7.1); unit tests cover owned-at-cost-0, unreachable targets, rare-anchor cases, and at least one shared-intermediate case that exercises the counted-once objective.

**Session 0.4 — Hub finder + passive planner**
- *Goal:* multi-target planning and the probabilistic perk overlay.
- *Depends on:* 0.3.
- *Deliverable:* `hubFinder` (§7.2, union plan + ranked hub scoring) and `passivePlanner` (§7.3, per-egg odds + expected eggs from `passiveModel`).
- *Done when:* the Appendix A worked example resolves to a single shared hub with counted-once intermediates, and passive odds match hand-computed values for a few fixtures. Could be split into 0.4a/0.4b if it runs long.

**Session 0.5 — Storage + functional UI shell (unstyled)**
- *Goal:* wire everything into a usable-but-ugly end-to-end app.
- *Depends on:* 0.2–0.4.
- *Deliverable:* localStorage roster/plans/settings + the six views (§8) as minimal unstyled components, driving the real solver on the real dataset.
- *Done when:* you can enter a roster, pick target(s) + perks, and get correct ranked plans in the browser. Explicitly no visual design.

**Session 0.6 — Real extraction pipeline**
- *Goal:* replace oracle-bootstrapped data with your own extraction.
- *Depends on:* 0.1 (schema); parallelizable with 0.2–0.5.
- *Deliverable:* UE4SS + PalworldDataExtractor run notes, the normalizer (raw export → schema), and the diff script. Produces a from-source `dataset.0.6.json`.
- *Done when:* your extracted dataset matches the oracle-bootstrapped one within a documented tolerance (any diffs explained). This session proves the pipeline works *before* patch day, when it has to run under time pressure.

**Session 0.D — Visual design (separate, deferred)**
- *Goal:* design the actual look and interaction model — breeding-tree rendering, roster UX, ranked-plan presentation.
- *Depends on:* 0.5 (needs the functional app to design against).
- *Deliverable:* the styled UI. Owns all aesthetic decisions this spec deliberately leaves open. Handled in its own dedicated session with its own brief.

### Phase 1 — July 10 (patch day)
Patch → regenerate `.usmap` (verify UE4SS compatibility *first*) → extract → diff against the 0.6 dataset → read patch notes → classify changes → implement `genrecomb-1.0` ruleset (keep `combirank-0.6` as selectable fallback) → re-run the 0.2 test harness to quantify divergence. Because 0.6 already proved the pipeline, this is a data + ruleset swap, not new infrastructure under pressure.

### Phase 2 — post-launch
Cross-check the formula against the Palworld Modding Discord; add the server-config UI if outcomes prove server-dependent; iterate on hub heuristics; fold in the styled UI from 0.D.

---

## 11. Data sources & validation oracles

Use these to seed/cross-check extraction and to unit-test the current ruleset (all extract from the same game files, so they're a correctness reference, not a dependency):

- `beckerfelipee/PalworldBreedingCalculator` (MIT) — breeding table from CombiRank tables.
- `blaynem/paldex` — extracted Pal data incl. breeding power + special-combo overrides.
- `palworld.wiki.gg/wiki/Breeding` — formula, tie-break, and passive-inheritance mechanics reference.

Note: the data is Pocketpair IP extracted from the game; keep it as a bundled local dataset for personal use.

---

## 12. Risks & open questions

- **UE4SS compatibility on patch day** — if the UE5 point version shifts, UE4SS may need a maintainer update before it attaches. Check first thing on the 10th; it gates the whole extraction step.
- **Formula uncertainty** — if Genetic Recombination isn't table-driven, time-to-correct-ruleset depends on empirical reverse-engineering speed, not build speed. The app is designed to remain useful (browser + current-system fallback) while that's in progress.
- **Server-dependence** — if confirmed, needs the `ServerConfig` path and a UI input; the solver already tolerates distributions.
- **Passive-model change** — 1.0 may alter slot count or inheritance odds; isolated to `passiveModel` data.
- **Anchor availability** — the rarest-parent bound means some targets are simply unreachable without a specific rare catch; the tool should state this plainly rather than return nothing. Only `wildCatchable` species may be suggested as anchors (§3.2/#5).
- **Gender feasibility** — every breed needs both genders; single-gender holdings and heavily-skewed `genderRatio` species can make an otherwise cheap species path infeasible or egg-expensive (§7.1/#3). Surfaced as a first-class result, factored into expected eggs.
- **Perk survival across branches** — perks injected upstream of the final cross must survive an inheritance roll per intermediate breed (odds compound); the guaranteed-carrier mode prefers final-cross injection and flags multi-step carries (§7.3, mode 2b).

---

## Appendix A — worked example of the objective

Targets: three combat Pals `{Anubis, Faleris, Beakon}`, all wanting perks `{Legend, Musclehead, Ferocious, Runner}`.

Naïve approach: three independent chains, each separately bred up with the four perks → many distinct combinations, perks re-rolled per chain.

Optimizer approach: (1) breed one **clean carrier** holding the four perks with the minimum combinations; (2) the hub finder identifies a species central to the three targets' rank spread that the carrier's perks can ride through in short branches; (3) branch the hub to each target, reusing shared intermediates counted once. Result: fewest distinct combinations, perks injected a single time, each branch reporting its per-egg odds. That's the "one good Pal I can breed in multiple directions" outcome, chosen by the cost metric rather than by hand.
