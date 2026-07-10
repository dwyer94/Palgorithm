# UI Requirements

Everything the PalCalc UI must let a user **see, change, modify, and act on** to cover the
app's functions. This is the handoff document for the visual/interaction design pass
(spec session 0.D). The functional, unstyled Phase-0 app already exists and drives the real
solver end-to-end — this document tells the designer *what content and controls exist and
what they must accomplish*, not how they should look. **All aesthetic and layout decisions
are the designer's to make**; the constraints here are about capability, information, and
priority, not visual style.

Source of truth for mechanics/architecture is `PALWORLD_BREEDING_OPTIMIZER_SPEC.md` (same directory); this
doc is the UI-scoped companion. Where the two disagree on *mechanics*, the spec wins.

---

## 1. What this app is (context for the designer)

A **goal-driven Palworld breeding-path planner** for a single technical user, run locally or
on a home server. You tell it the Pals you own (species, gender, passive skills) and one or
more target Pals (optionally with a desired set of passives), and it returns the breeding
plan that reaches the target(s) in the **fewest distinct breeding combinations**.

Key ideas the UI has to make legible:

- The primary output is a **breeding plan**: an ordered list of "pair A × pair B → child"
  steps, forming a tree/DAG that bottoms out at Pals you own or can catch. The headline
  metric of any plan is its **distinct-combination count** (lower is better). Everything
  else (probabilities, warnings, catches) is secondary detail.
- The tool reasons about **two layers**: *species* (what breeds into what) and *passives*
  (the odds of a child inheriting a specific set of perks). Passive results are
  probabilistic — the UI shows odds and "expected eggs," not guarantees.
- It also connects to a **live game server** (via a self-hosted proxy) to pull in what pals
  you and your friends actually own, so plans can use real boxes as source material.

Scale: ~138 species today, growing to ~200 after the July 10 2026 "1.0" patch. ~120 passive
skills. A roster of dozens to low-hundreds of owned pals. Plans are typically 1–8 steps.

Audience of one, but not a toy — the user understands the domain deeply and wants
information density and correctness over hand-holding. Not a public product; no onboarding,
no marketing surface.

---

## 2. The seven views (current app shell)

Top-level navigation across seven views (today a flat row of tab buttons — the designer owns
the real navigation model). Listed with their spec section and one-line job:

| View | Spec | Job |
|---|---|---|
| **Roster** | §8.1 | Manage the Pals you own (add/edit/remove, import/export). |
| **Server Pals** | live feature | Browse live pals from the connected server; pick which players' boxes feed the planner. |
| **Single-target planner** | §8.2 | One target species (+ optional perks) → one ranked plan. |
| **Multi-target / hub planner** | §8.3 | Several targets (+ shared perks) → union plan + ranked hub suggestions. **The primary/flagship view.** |
| **Forward calculator** | §8.4 | Two parents → predicted child(ren). A sanity/inspection tool. |
| **Reverse lookup** | §8.5 | One child → every parent pair that makes it. The raw building block. |
| **Settings** | §8.6 | Catch policy, saved perk sets, live-connection config, ruleset info. |

There is also a **latent eighth surface — Saved Plans** (see §3.8) that the data layer
already supports but no screen yet exposes; the designer should give it a home.

Priority for design attention: the two **planners** (single + hub) and their **plan/result
rendering** are the heart of the product and deserve the most craft. Forward calculator and
reverse lookup are utilitarian. Roster and Server Pals are data-management surfaces.

---

## 3. Per-view requirements

### 3.1 Roster manager (§8.1)

The user's persisted collection of owned Pals. Persisted to `localStorage`.

Must let the user:
- [ ] **Add** an owned Pal: pick species, gender (male/female), optional passives (0–4+),
      optional freeform notes.
- [ ] **See** the full roster as a scannable list/table: species (display name), gender,
      passives, notes.
- [ ] **Edit** an existing entry (today the functional app only supports add + remove — the
      designer should include inline or modal **editing** of species/gender/passives/notes;
      it's a real gap worth closing).
- [ ] **Remove** an entry.
- [ ] **Import / export** the whole roster as JSON (round-trips the persisted shape).
- [ ] **Empty state**: clear affordance when the roster has no entries yet.

Data available per roster entry: `id`, `species`, `gender`, `passives[]`, `notes?`.

Scale/UX notes: a roster can hold dozens–hundreds of entries. **Search/filter/sort** (by
species, by passive, by gender) becomes valuable at that size — not in the functional app,
but worth designing. Duplicate species are normal and expected (you own many of the same
Pal in different genders / with different perks).

Consider: the ability to **seed the roster from the live server** (copy a live pal into your
persisted roster) — currently the two pools are deliberately separate (§3.2), but a
one-way "add this live pal to my roster" affordance is a natural convenience. Flag as a
design option, not a requirement.

### 3.2 Server Pals / Live roster browser (live feature)

Browses pals owned across the connected game server. **Read-only, separate pool** — live
pals are *never* merged into the persisted roster; they feed the solver as an
owner-tagged, session-only source.

Context: a self-hosted Python proxy mirrors the real PalDefender REST API 1:1
(`GET /players`, `GET /pals/<id>`, `GET /player/<id>`, bearer-token auth, permission-gated),
reachable over Tailscale. No mutation endpoints — every connected user gets full read access
to every player's pals. See `docs/SETUP_admin_runbook.md` / `docs/SETUP_friends_guide.md`
for the server-side half.

Must let the user:
- [ ] **See a player list** — one row per player the server reports, showing **resolved
      display name** (override → API name → raw identifier, per §4.4), guild, online/offline
      status.
- [ ] **Set/edit a display-name override inline** from a player row (not only from Settings),
      so you don't round-trip to Settings mid-browse.
- [ ] **Expand/select a player to see their pals**: species, gender, level, passives,
      location (Team / Palbox / which Base Camp). Lazy-loaded per player on expand.
- [ ] **Select which players' pals feed the planners** — a checkbox per player, plus
      "select all / none". Selection is cross-view (survives tab switches) and **not**
      persisted (re-established each session).
- [ ] **Manually refresh** the player list and per-player pals; show a **last-refreshed
      timestamp**; if auto-poll is on, an indicator/countdown.
- [ ] Handle **all connection states** (see §4.5): unconfigured (no base URL → demo/mock
      data), connecting, connected, error (with retry).
- [ ] **Flag unresolved data**: a live pal whose species/gender/passive didn't resolve
      against the bundled dataset must be shown as unresolved (e.g. "`SheepBall` (unresolved)")
      — never silently guessed or dropped.

Data available per live player: `identifier` (PlayerUID), `userId`, `apiName`, `guildName`,
`status`. Per live pal: `species` (or `rawPalId` + unresolved flag), `gender` (or raw +
unresolved), `passives[]` + `unresolvedPassives[]`, `level`, `nickname`, `shiny`, `ivs`
(health / attackMelee / attackShot / defense), `location` (team | palbox | baseCamp+id).

Non-breeding fields (`level`, `nickname`, `shiny`, `ivs`) are **not** used by the solver but
are reasonable to surface for a human deciding which pal to actually use/trade for. Shiny in
particular is a nice-to-flag.

### 3.3 Single-target planner (§8.2)

Must let the user:
- [ ] **Pick one target species** (searchable select over ~138–200 species).
- [ ] **Pick an optional desired perk set** (0–4 passives) to inject at the final cross.
- [ ] Choose which **pal pools** feed the search: local roster (always) + any selected live
      players (see §3.2 / §4.6). Show which pools are active.
- [ ] **Run the plan** and see the ranked result (see §4.1 plan rendering).
- [ ] **Save/star** the resulting plan (see §3.8).

Result content: distinct-combination count (headline), ordered breeding steps, required
catches/anchors, and — when perks were requested — the per-egg perk-landing odds + expected
eggs at the final cross, plus pollution warnings. Infeasible targets show anchor hints
instead of a plan (§4.3).

### 3.4 Multi-target / hub planner (§8.3) — flagship view

The primary view. Produce N target species, optionally all carrying a shared perk set, and
compare the plain union plan against **hub** suggestions (load one carrier with the perks,
branch it to many targets).

Must let the user:
- [ ] **Build a target list** — add several target species, see them as a removable list.
- [ ] **Pick an optional shared perk set** applied across all targets.
- [ ] Choose which **pal pools** feed the search (as §3.3).
- [ ] **Run**, and see two things side by side / stacked:
  - The **union plan**: total distinct-combination count across all targets (shared
    intermediates counted once), the merged ordered step list, catches, and a
    **per-target breakdown** (expandable: each target's own sub-plan, including any
    per-target infeasibility + anchor hints).
  - The **ranked hub candidates**: each with its obtain-cost, and — in fixed-target mode —
    a per-target inject-cost showing how many combos from "hub in hand" to each target and
    whether the hub is a **direct parent** (one final cross, the good case) vs. reaching the
    target only through intermediates. Hubs carry an optional perk-overlay for loading the
    carrier.
- [ ] **Understand that the hub is optional** — the union plan always stands on its own; hubs
      are an alternative to compare, never forced. The UI should make "compare these two
      strategies" the mental model.
- [ ] **Save/star** either result (§3.8).

Design challenge: this view shows the most information at once (a union DAG + a per-target
breakdown + a ranked list of alternatives). Making that comparable and non-overwhelming is
the single biggest layout problem in the app.

### 3.5 Forward calculator (§8.4)

A sanity/inspection tool that validates the ruleset visually.

Must let the user:
- [ ] **Pick two parent species.**
- [ ] **Optionally set each parent's gender** (male / female / either). Leaving a gender as
      "either" is meaningful: gender-dependent special combos then return a **distribution**
      of possible children rather than one — the UI must show a multi-outcome result with
      per-child probabilities, not collapse it to one child.
- [ ] **See the predicted child(ren)** with probability per outcome; handle the
      "no valid outcome for this pair" case.

### 3.6 Reverse lookup (§8.5)

The raw building block behind the planners, exposed for manual inspection.

Must let the user:
- [ ] **Pick a child species.**
- [ ] **See every parent pair** that can produce it (unranked, raw list). Handle the
      "no known parent pairs" case (e.g. capture-only species).

### 3.7 Settings (§8.6)

Must let the user configure:
- [ ] **Allow catching** wild-catchable species (on/off). When off, planning is roster-only.
- [ ] **Catch-cost weight** — a number in the same unit as one breeding combination, so
      catches and combos trade off in the same cost space (default 1).
- [ ] **Saved perk sets** — name + a set of passives; add, list, remove. These are
      re-selectable across the planner views (a convenience so you don't re-pick the same 4
      perks each time). *(Design note: the planners should offer these saved sets as
      quick-apply options — the wiring point exists but isn't surfaced in the functional app.)*
- [ ] **Active ruleset** (display-only today) — shows `combirank-0.6`; a selector is a
      placeholder for the 1.0 swap when a second ruleset (`genrecomb-1.0`) exists.
- [ ] **Server-config preset** (placeholder for 1.0) — no server-dependence today; a stub
      section until 1.0 mechanics are known.
- [ ] **Live server connection** (see §3.2 / §4.5 for behavior):
  - Proxy **base URL** (blank = use demo/mock data).
  - Optional **bearer token**.
  - **Test connection / refresh** action, with inline status + error.
  - **Auto-refresh** toggle + interval (seconds); interval disabled when auto-refresh off.
  - **Display-name override table**: identifier → preferred name; add/update/remove. Seed
    data below. Also editable inline from Server Pals rows.

Seed data for the name-override table (SteamID64 → preferred name; may re-key to PlayerUID
once the real proxy `/players` response is inspected):

| Identifier | Display name |
|---|---|
| 76561198106031331 | Kit |
| 76561198061667425 | InputComet |
| 76561198146926388 | D-Wire |
| 76561198140338260 | Capn' Crain |
| 76561198053299466 | ScootScoot |
| 76561198253583281 | Kris |
| 76561198131149693 | Canter |
| 76561198074507245 | Wiggum |

### 3.8 Saved Plans (data exists, UI missing — needs a home)

The store already persists **starred plans** (`SavedPlan`: id, name, savedAt, kind
single/union, targets, desiredPassives, full result) and exposes a `useSavedPlans` hook, but
**no view surfaces it**. The designer should provide:
- [ ] A **"save this plan"** affordance on both planner results (name it, star it).
- [ ] A place to **list saved plans** and **re-open** one (re-render its stored result
      without recomputing), and **delete** it.

This can be its own view, a panel, or folded into the planners — designer's call. It's a
real spec requirement (§4.5, §8) currently unmet.

---

## 4. Cross-cutting UI concerns

These recur across views and are where most of the design nuance lives.

### 4.1 Plan / result rendering (the core artifact)

A plan is the app's primary output. Rendering it well is the top design priority.

Every plan result must lead with, in rough priority order:
1. **Distinct-combination count** — the headline number, biggest and first. "N distinct
   combinations." This is the objective being minimized; it must dominate.
2. **The ordered breeding steps** — each step is `parentA (gender) [passives] × parentB
   (gender) [passives] → child`. Steps are ordered so every step's parents are already
   available (owned, caught, or produced by an earlier step) by the time it runs. This is a
   tree/DAG; today it renders as a flat ordered list. **How to visualize the breeding
   tree/DAG is an explicitly open design question** (spec defers it here) — a genuine
   tree/graph rendering is welcome and probably better than a flat list, especially for
   multi-step and shared-intermediate plans.
3. **Required catches/anchors** — wild pals the plan assumes you'll go catch.
4. **Passive overlay** (only when perks were requested) — see §4.2.
5. **Warnings** — gender-feasibility, perk-survival-across-branches, pollution (§4.7).

Shared intermediates (a child bred once but used toward multiple targets) are **counted
once** and should read as shared, not duplicated — this is central to the objective and a
place where a real graph rendering pays off.

Total **cost** (combinations + weighted catches) is a secondary number alongside the
combination count.

### 4.2 Passive / perk results (probabilistic — present as odds, never guarantees)

When a plan carries a desired perk set, the final cross gets a perk overlay showing:
- The desired perk set.
- The two **final-cross parents** chosen, with their passives.
- **Exact-set odds** (child ends with exactly the desired perks, nothing else) — as a
  percentage — and the **expected eggs** (1/p) to hit it.
- **Superset odds** (child has at least the desired perks, maybe extras) + expected eggs.
- **Pollution**: any passives a parent carries *outside* the desired set, which lower the
  odds — surfaced, not auto-resolved (it's a cost-vs-certainty tradeoff the user decides).
- Expected-egg values can be **infinite** (odds 0) — render as ∞, not a crash or "NaN."

**Provisional-data flag (important):** the passive-inheritance odds ship as
`verified: false` estimates (the real numbers may never be cleanly extractable). Wherever
these odds are shown, the UI **must mark them as provisional/estimated** — never present
placeholder odds as authoritative. This is a spec mandate (§3.3), not a nicety.

### 4.3 Infeasibility & anchor hints

A target can be unreachable from the current pools. When so, instead of a plan the result
shows:
- A clear **"infeasible / not reachable"** state (not an error, not empty).
- **Anchor hints**: candidate species that, if owned, would unlock the target — each with its
  rank and the resulting combination cost, nearest-rank-first. Only *wild-catchable* species
  are ever suggested here (never event/raid/shop-only). This is guidance the user acts on
  ("go catch one of these"), so it should read as actionable, not as a dead end.

In the multi-target view, infeasibility is **per-target** — the union plan can be partly
feasible, with some targets showing anchor hints inside their per-target breakdown.

### 4.4 Display-name resolution (live players)

Resolve a player's shown name in this order: **manual override** (if set) → **API name**
(if non-empty) → **raw identifier** (PlayerUID) as last resort. Apply this consistently
everywhere a player is named (Server Pals list, provenance tags on plans, Settings table).

### 4.5 Live-connection states

Every live-data surface must handle:
- **Unconfigured** — no base URL set → transparently uses demo/mock data; the UI says so
  ("using demo/mock data — configure a proxy base URL in Settings").
- **Connecting** — request in flight.
- **Connected** — with a last-refreshed timestamp.
- **Error** — proxy unreachable / timeout / bad response, with a code + message and a
  **retry** action. Per-player pal-fetch failures are row-local (that row shows no pals +
  retry), distinct from a whole-list failure.

### 4.6 Pal-pool selection (which pals feed the search)

Planners search over a **combined pool**: the persisted local roster (always in) plus the
live pals of whichever server players are currently selected (§3.2). The planner views must
make it clear which pools are active ("including pals from N connected players"). Selection
is made in Server Pals and is global/cross-view.

### 4.7 Provenance tags (whose pal is this?)

When a suggested parent/catch in a plan comes from a **specific server player's** box, tag
it with the owner's resolved display name (e.g. "owned by Kit", or "possibly Kit's" when the
match is only best-effort/ambiguous). The user acting on a plan needs to know whose pal to
actually use or trade for. Tags are best-effort and never a guaranteed claim — absent when
nothing matched or no live players are selected.

### 4.8 Species & passive selection controls (used everywhere)

- **Species select**: appears in nearly every view, over ~138 (→~200) species. The
  functional app uses a plain alphabetical `<select>`; at this size a **searchable/typeahead**
  picker is strongly preferred. Species carry data the picker could surface: display name,
  paldex number, elements, rank, and reachability class (breedable / wild-catchable /
  other-obtain-only). Element/type and "can I even catch this" are the kinds of filters that
  matter.
- **Passive multi-select**: over ~120 passives, each with a display name and optional tier
  and category. Today a flat scrolling checkbox list. Search/group-by-tier/group-by-category
  would help. Desired-perk sets cap at the 4 slots' worth in practice (the model has 4
  slots), though the control needn't hard-block more.
- **Gender**: male / female, plus an "either / unspecified" option specifically in the
  forward calculator (where omitting gender surfaces the special-combo distribution).

### 4.9 Empty / loading / error states (general)

Every list and result surface needs a designed empty state (no roster, no targets picked, no
results yet, no players, no parent pairs) and, for anything touching the live proxy, loading
and error states. These are called out per-view above; collected here as a global
requirement so none are skipped.

---

## 5. Data the UI has to display (reference for content design)

So the designer knows what real content exists to lay out. All loaded from the bundled
dataset unless noted.

**Species record:** `id`, `displayName`, `paldexNo`, `index` (game-file order), `rank`
(CombiRank — lower = rarer), `elements[]` (Neutral/Fire/Water/Electric/Grass/Dark/Dragon/
Ground/Ice), `genderRatio` {male, female}, reachability flags (`standardBreedable`,
`wildCatchable`, `otherObtainOnly`), `obtain` routes, optional `rarity`,
`workSuitabilities[]`, `baseStats` {hp, attack, defense}, `icon` (image path — present in
schema, usable for thumbnails if populated).

**Passive record:** `id`, `displayName`, optional `tier`, optional `category` (freeform —
not a reliable role taxonomy), optional `lotteryWeight`.

**Roster entry (user data):** `id`, `species`, `gender`, `passives[]`, `notes?`.

**Live player:** `identifier`, `userId`, `apiName`, `guildName`, `status`.
**Live pal:** `species` (+ unresolved raw), `gender` (+ unresolved raw), `passives[]` +
`unresolvedPassives[]`, `level`, `nickname`, `shiny`, `ivs` {health, attackMelee,
attackShot, defense}, `location` (team | palbox | baseCamp+id).

**Plan result:** `combinationCount`, `cost`, `feasible`, `steps[]` (each: parentA, parentB,
child — parents carry species/gender/passives), `catches[]`, `anchorHints[]` (species, rank,
gender, resultingCost), `passivePlan?` (desired[], landOdds {exactSet, supersetContaining},
expectedEggs, finalParentA/B, pollution {parentA[], parentB[]}).
**Union plan adds:** `targets[]`, `perTarget[]` (each target's own plan), merged
`steps`/`catches`.
**Hub candidate:** `species`, `obtainCost`, `obtainPassivePlan?`, `injectCost[]` (per target:
combos, direct?), `score?` (fixed-target), `breadth?` (general-reach).

Note the `icon` field: the dataset schema carries a per-species image path. If populated,
**species thumbnails/art** are available and would meaningfully lift the roster, pickers, and
plan rendering. Whether it's populated today should be verified before relying on it, but the
design can assume art is a possibility, not forbidden.

---

## 6. Global qualities & priorities

- **Information density over hand-holding.** One expert user who wants correctness and
  substance. Lead with the numbers that matter (combination count first).
- **Legibility of substance is the one hard functional requirement** carried over from
  Phase 0: results must foreground the combination count and step list; probabilities and
  warnings are secondary detail.
- **Correctness signaling.** Provisional passive odds flagged as estimates; unresolved live
  data flagged, not guessed; infeasibility stated plainly with actionable anchors rather than
  a silent empty result.
- **The two planners are the product.** Spend the design budget there and on plan rendering.
- **Future-proofing is invisible to the UI** except two seams the designer should leave room
  for: a **ruleset selector** (a second ruleset arrives on the 1.0 patch) and a
  **server-config input** (only if 1.0 outcomes prove server-dependent). Both are Settings
  placeholders today.
- **Platform:** desktop-first web app (local / home-server use). Responsive is welcome but
  mobile is not a driving constraint.

---

## 7. Explicitly out of scope

- **No backend, no analytics, no auth, no accounts.** Fully client-side; data in
  `localStorage`.
- **Live feature:** no write/mutation endpoints, no per-user identity scoping (everyone on
  the tailnet reads everyone's pals), no live Steam Web API — name mapping is manual override
  only.
- **No game-mechanics changes in the UI** — the UI never computes breeding math; it only
  displays what the solver/ruleset return.
- Visual style, color, type, motion, and the specific breeding-tree rendering are **the
  designer's to define** — this document constrains capability and content, not aesthetics.
