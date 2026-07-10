# Handoff: Palgorithm UI — visual/interaction design pass (spec session 0.D)

## Overview
This package is the visual + interaction design for **Palgorithm**, a goal-driven Palworld
breeding-path planner. The functional, **unstyled** app already exists and drives the real
solver end-to-end (`dwyer94/Palgorithm`, branch `master`). This handoff covers the design
of three surfaces:

- **Hub planner** (flagship multi-target view) — union-vs-hub comparison + breeding-plan rendering
- **Server Pals** — live-box browser + a new **cross-player pal/trait search**
- **Settings** — policy, saved perk sets, live-connection config, name overrides, 1.0 seams

The single-target planner, roster, forward calc, reverse lookup, and saved plans are **not**
mocked separately — they reuse the components defined here (see "Reuse map").

## About the design files
The files in this bundle are **design references authored in HTML** (they open in a browser).
They are *not* production code to copy. Your task is to **recreate them in the existing
React + TypeScript + Tailwind codebase**, using the app's established patterns and — critically —
**wiring them to the solver hooks and data types that already exist**. The prototypes hard-code
sample data (a worked example: targets Anubis + Grizzbolt sharing an intermediate Rayhound) and
fake the interactive state locally; in the real app that state comes from the existing hooks.

The `.dc.html` prototypes use a small runtime to render (a `<script src="support.js">` and
`{{ }}` template holes). **Ignore the runtime.** Read them for layout, exact styling values,
copy, and interaction behavior. This README is the source of truth and is self-sufficient.

## Fidelity
**High-fidelity.** Final colors, typography, spacing, radii, shadows, and interactions are all
specified below and should be reproduced faithfully. Recreate pixel-for-pixel using Tailwind
(extend the theme with the tokens below) or CSS — your call, but match the values.

---

## Codebase map (what to change, what to keep)
All UI lives in `src/ui/`. Keep every hook/import; replace only the markup.

| Design surface | Existing file(s) to restyle | Hooks / functions it already calls (do not change) |
|---|---|---|
| Hub planner | `src/ui/HubView.tsx` + `src/ui/shared.tsx` (`UnionPlanView`, `HubList`, `PassivePlanView`) | `planUnion`, `findHubs` (`src/solver/hubFinder.ts`); `useRoster`, `useSettings`; `useLiveContext`; `buildRosterForSolver`; `annotateUnionPlan`; `resolvePlayerDisplayName`; `useRulesetContext` |
| Single-target planner | `src/ui/SingleTargetView.tsx` + `shared.tsx` (`SpeciesPlanView`) | `planSpecies` (`src/solver/speciesPlanner.ts`); same hooks as above; `annotateSpeciesPlan` |
| Server Pals (Players tab) | `src/ui/ServerPalsView.tsx` | `useLiveContext` (`players`, `palsByPlayer`, `palsLoading`, `selectedPlayerIds`, `setSelectedPlayerIds`, `refreshPlayers`, `refreshPlayerPals`, `status`, `isUsingMock`, `lastRefreshedAt`, `error`); `resolvePlayerDisplayName`; `useSettings().live.nameOverrides` |
| Server Pals (Find a pal tab) | **new** sub-view inside `ServerPalsView.tsx` | derive from `live.palsByPlayer` across selected players; `speciesById`, `passives` from `useRulesetContext`; reuse `resolvePlayerDisplayName` for owner tags |
| Settings | `src/ui/SettingsView.tsx` | `useSettings` (`allowCatching`, `catchCost`, saved perk sets, `live.*`, `nameOverrides`); `useRulesetContext` |
| Saved plans (unmet spec) | new view/panel | `useSavedPlans` (already exists) — add "★ Save plan" on planner results, a list view, re-open (re-render stored result), delete |
| App shell / nav | `src/App.tsx` | replace the flat tab row with the sidebar below |

Data shapes to bind to are defined in `src/solver/types.ts` (`SpeciesPlanResult`,
`UnionPlanResult`, `HubCandidate`, `PlanIndividual`, `SpeciesPlanStep`, `AnchorHint`,
`PassivePlanResult`), `src/data/schema.ts` (`Species`, `Passive`, `Element`), `src/store/types.ts`
(`RosterEntry`, `SavedPlan`), and `src/live/types.ts` (live player/pal). **Don't invent fields.**

---

## Design tokens

### Fonts (Google Fonts)
- **UI / sans:** `Space Grotesk` — weights 400/500/600/700. Labels, headings, body.
- **Mono / technical:** `JetBrains Mono` — weights 400/500/600/700. **All numerics, species names,
  identifiers, passive names, IVs, ranks, costs.** This mono-for-data rule is a core part of the look.

### Type scale (px)
| Use | Family | Size / weight | Extra |
|---|---|---|---|
| Headline combo count | JetBrains Mono | 52 / 700 | letter-spacing −3px, line-height .85 |
| Secondary count (compare cards) | JetBrains Mono | 34–52 / 700 | letter-spacing −1 to −3 |
| Page title | Space Grotesk | 22 / 700 | letter-spacing −.4 |
| Card/section title | Space Grotesk | 15 / 700 | |
| Node species name | JetBrains Mono | 12.5 / 600 | |
| Body / control label | Space Grotesk | 13–13.5 / 400–600 | |
| Uppercase section label | Space Grotesk | 10–11 / 600 | letter-spacing .5–.8, uppercase, color `#8a8378` |
| Small meta / mono detail | JetBrains Mono | 10–12 / 500 | |

### Colors
```
Canvas / app bg        #eceae4
Panel white            #ffffff
Panel subtle           #f6f4ef   (rails, inset)  /  #faf8f3, #f4efe6 (headers)
Ink (primary text)     #211e18   /  #1a1712  /  #4a453c
Muted text             #8a8378  →  #a89f8f  →  #b3aa99 (lightest)
Borders                #ddd6ca (card)  #e3ddd0 (inner)  #cfc7ba (input)  #efe9dd (divider)

Sidebar bg             #191712    hover row #241f18    section label #6b665c    body text #c8c2b6

Brand orange (active nav, add-affordances)   #e8813a   hover/emphasis #c9662a
Shared-intermediate    #d2691e   on bg #fdf2ea  border #e8c2ab   (edges + shared node)

Primary / selected / "best" / hub   #2a6bdb
  darker text ramp     #2a6bbf → #1c4f9e ;  passive-chip text #41539e
  tints                #eef4fc, #f4f8fe (hub card), #eef1fb (passive chip)
  borders              #cdd6f2, #b8d0ee, #cdddf5

Success / online       #2f9e5b (dot)  #2f6f4a (text)   bg #e7f4ec  border #bfe0cc
Offline dot            #c4bbaa

Provisional / estimate  text #8a6d1a  bg #fff3d6  border #e6cf8a
Unresolved (live data)  text #8a6d1a  bg #f4e6bf / #fdf7e6
Error (row-local)       text #b8541f  border #e8c2ab  bg #fdf5f0
Shiny star              #e0a72a
```

### Element colors (species identity — the dot on every species)
```
Neutral #9a938a   Fire #e0592a   Water #2b7fd4   Electric #e0a72a   Grass #4a9d3f
Dark #7b5ea8      Dragon #a34bd6 Ground #b07a3c   Ice #3fb0c9
```
Render as an 8–9px circle before the species name. Species can have multiple elements
(`Species.elements[]`); the prototype shows the first — for production, two overlapping dots or
a small dot cluster is acceptable if you want to show all.

### Radii / shadow / spacing
```
Radius:  card 14px · panel/input 9–11px · node 10px · chip 5–6px · pill/toggle 20px
Shadow:  card 0 1px 2px rgba(0,0,0,.04)
         node 0 1px 2px rgba(0,0,0,.05)
         elevated-blue 0 2px 8px rgba(42,107,219,.10–.16)
         dropdown 0 6px 20px rgba(0,0,0,.12)
Layout:  sidebar 212px · input rail 260–266px · content max-width 860–1080px
         card padding 18–22px · row padding 11–16px · gaps 6–14px
```

---

## Shared components to build (reuse everywhere)
These recur across all planners; build them once.

1. **`<Sidebar>`** — 212px, bg `#191712`. Brand mark (two outlined circles + one filled orange
   circle with connecting lines — see the inline SVG in any prototype) + "Palgorithm". Grouped
   nav: **Plan** (Hub planner, Single target, Saved plans) · **Data** (Roster w/ count, Server pals
   w/ "N on" badge) · **Utilities** (Forward calc, Reverse lookup) · **Settings** pinned bottom.
   Active item = solid `#e8813a` bg, ink text, weight 600. Hover = `#241f18`.
2. **`<ElementDot element>`** — the colored circle.
3. **`<PassiveChip>`** — mono 10px, bg `#eef1fb`, text `#41539e`, border `#cdd6f2`, radius 5–6px.
   Variant "matched" (search) = solid `#2a6bdb` bg, white text. Variant "pollution/warn" =
   `#f4ece0`/`#8a6d1a`.
4. **`<PalNode>`** — the plan graph/list atom. States by border:
   - **owned / catch (leaf):** 1.5px **dashed** `#b3aa99`, white bg. Sub-line shows `owned` (green
     `#2f6f4a`) / `catch · r58` (orange `#c9662a`), plus owner name when from a live player.
   - **bred intermediate:** 1.5px **solid** `#26241f`, white bg.
   - **shared intermediate:** 1.6px solid `#d2691e`, bg `#fdf2ea`, sub-line "shared · used ×2".
   - **hub:** 1.6px solid `#2a6bdb`, bg `#eef4fc`, tag "hub".
   - **target:** 2px solid `#14120e`, bg `#fbf3e0`, name gets a `✦`, shows perk chips.
   Each node: row1 = species name (mono 12.5/600) + gender glyph (♂/♀, muted); row2 = element dot +
   role/rank/passive meta. Width ~150px.
5. **`<ComboCount>`** — the giant headline number (JetBrains Mono 52/700, −3px tracking) with an
   uppercase label above and a secondary "cost N · M catches" line beside it.
6. **`<ProvisionalTag>`** — `est.` / "⚠ provisional estimate" pill in the amber ramp. **Must appear
   next to every passive-odds figure** (spec mandate — `passiveModel.verified === false`).
7. **`<Toggle>`** (settings) and **`<SegmentedControl>`** (graph/list tabs, view tabs).

---

## Screen 1 — Hub planner (flagship)  ·  `Palgorithm Hub Planner.dc.html`

### Purpose
Pick several target species + a shared perk set, then compare the **union plan** (baseline, always
valid) against ranked **hub** strategies, and read the resulting breeding plan.

### Layout
Three columns, full height: **Sidebar (212)** · **Input rail (266)** · **Result (flex, scroll,
max-width 1080, centered, padding 26/34)**.

**Input rail** (`bg #f6f4ef`, right border `#ddd6ca`):
- Title "Multi-target plan" + sub.
- **Targets** — removable list; each row = element dot + species (mono) + rank pill (`r42`) + "×".
  Dashed "＋ Add target species…" affordance (opens the searchable species picker — see §Controls).
- **Shared perks** — selected as blue passive chips with "×"; "＋ add perk · apply saved set ▾".
  Caption "Injected at the final cross only."
- **Pal pools** — card listing "Local roster (54)" + selected live players ("Nova, Quill +38").
  Bind to `live.selectedPlayerIds` / `buildRosterForSolver`.
- **▶ Run plan** — primary button `bg #191712`, white, radius 10.

**Result column** (top → bottom):
1. Header: uppercase context line ("Result · 2 targets · shared [Legend, Swift]") + "Union vs. hub
   strategy" title; right-aligned "★ Save plan" + "⤓ Export" outline buttons.
2. **Compare strip** — CSS grid `1fr 1fr 250px`, gap 14:
   - **Union card** (white): label "Union plan" + "baseline" pill; `<ComboCount>` = `UnionPlanResult.combinationCount`;
     "cost N · K catches"; caption.
   - **Hub card** (`bg #f4f8fe`, 1.5px `#2a6bdb`, blue shadow): "Hub · {name}" + "best" pill;
     count = best `HubCandidate` total (obtain + Σ inject); "−N combos vs union"; "obtain X · score Y";
     then per-target rows — each shows **direct · 1 cross** (blue chip, when `injectCost.direct`) vs
     "via N" (grey chip). Bind to the selected hub in `hubResult.hubs`.
   - **Ranked hubs rail** (white): one row per `HubCandidate` — name + total; "obtain N · A direct, B via".
     Selected row = left border `#2a6bdb` + `bg #f4f8fe`. Clicking re-renders the hub card. Footer:
     "Hubs are optional — compare, never forced."
3. **Selected plan panel** (white card): header "Selected plan" + mono note "via hub {name} ·
   Rayhound shared, counted once" + **segmented Graph / Steps toggle** (right).
   - **Graph view** (default): the layered DAG (see §Plan graph).
   - **Steps view**: ordered numbered rows — dark circle index, `parentA ♂ [chips] × parentB ♀ →
     child`. Catches get a "catch r58" amber chip; shared child an orange "shared" chip; hub a blue
     "hub" chip; targets a `✦`. This is the current `steps[]` list, styled.
4. **Perk overlay** (only when `desiredPassives` set → `passivePlan`): header "Perk landing · final
   cross" + **⚠ provisional estimate** tag. Two-col grid: **Exact set** `landOdds.exactSet` (%) +
   `expectedEggs.exactSet` ("≈ 5.4 eggs"), each with an `est.` tag; **Superset** likewise. Render
   `Infinity` eggs as **∞**. Footer "⚑ Pollution" strip listing `pollution.parentA/parentB` passives.
5. **Per-target breakdown** — one `<details>` per `perTarget[]`: element dot + species + "rN · Element"
   + right-aligned "feasible · N combos" (green) OR "⚠ not reachable" (orange). Open = the target's
   own steps. **Infeasible target** → show `anchorHints[]` as actionable rows: species + "rank R ·
   wild-catchable" + "→ cost C", nearest-rank-first (amber `#f6efe1` rows).

### Plan graph (the signature rendering)
A **layered, left→right dependency DAG**. Columns by dependency depth: **OWN/CATCH → STEP ① →
STEP ②–③ → TARGETS**. Nodes are `<PalNode>`; edges are SVG cubic paths behind them
(`M x1 y1 C x1+d y1, x2−d y2, x2 y2`) with an arrowhead marker. Neutral edges `#c4bbaa` (1.6px);
**edges leaving a shared node** are `#d2691e` (2.1px) — so "bred once, used twice" is *visible* as
one node with two outgoing edges. Column captions in mono 9.5px `#b3aa99`.

Implementation for production: the prototype hard-codes node coordinates. For the real app, drive
positions from a **layered graph layout** (rank = longest-path depth from leaves; deterministic
ordering so the shape is stable across re-runs). Build the layers from `UnionPlanResult.steps`
(a step's `child` depends on its two parents). Keep it deterministic — no force/physics layout.
Container scrolls horizontally on narrow viewports.

---

## Screen 2 — Server Pals  ·  `Palgorithm Server Pals.dc.html`

Header: "Server Pals" + sub; right side = **connection status** (green dot + "Connected" + mono
"refreshed HH:MM:SS · auto-poll in M:SS") and a "⟳ Refresh" button. Then a **tab bar** (underline
segmented): **Players (6)** · **Find a pal**.

### Tab A — Players (restyle existing `ServerPalsView`)
- **Mock-data notice** (amber) when `live.isUsingMock` — "…falls back to demo/mock data — configure
  the proxy in Settings → Live connection."
- **Selection bar**: "6 players · Select all · None" + right pill "38 pals from 2 players feed the
  planner" (from `selectedPlayerIds` + counts).
- **Player rows** = `<details>`. Summary: checkbox (`selectedPlayerIds`; checked = solid `#2a6bdb`),
  online/offline dot, **resolved display name** (override → apiName → identifier, via
  `resolvePlayerDisplayName`), "✎ override" affordance, guild, right-aligned "N pals", show/hide.
  Handle all states:
  - **Selected** row = 1.5px `#2a6bdb` border + blue shadow.
  - **Expanded** → pals **table**: Species (element dot + name; **shiny ★**; **unresolved** rows in
    amber `bg #fdf7e6` showing `rawPalId (unresolved)`), Gender, Lvl, Passives (chips; "+N
    unresolved" amber chip from `unresolvedPassives[]`), **IVs H/A/D**, Location (Team / Palbox /
    Base Camp N). Lazy-load on expand (`refreshPlayerPals`).
  - **Inline override edit** = swap the name to an input + Save/Cancel; writes to
    `settings.live.nameOverrides`.
  - **Offline** = grey dot + "offline".
  - **Row-local error** = orange border, expanded shows "504 — proxy timeout…" + "⟳ Retry"
    (`error` per row; retry re-calls `refreshPlayerPals`).
  - **Loading** = shimmer skeleton bars + "Loading pals…" (`palsLoading.has(id)`).
  - **Raw-identifier player** (no override, no apiName) = show the PlayerUID in mono + amber
    "no name — add override".

### Tab B — Find a pal (NEW capability — "does anyone have X with Y traits?")
Full interactive behavior (the prototype implements it live; replicate the logic):
- **Search-in scope** (`bg #f6f4ef` card): toggle chips, one per connected player, + "All / None".
  On chip = blue filled w/ ✓; off chip = grey outline. Default all on. Scope = which players' boxes
  are searched (independent of the planner selection, though you may default it to the same set).
- **Species field**: a **typeahead** input ("Type a species… e.g. Anubis"). As the user types, a
  dropdown lists matching species (element dot + name, mono, hover `#f4f8fe`); picking one collapses
  the field to a **removable chip** (solid-border box + "×"). Source: `useRulesetContext().species`.
- **Must-have traits field**: a chip-input — selected traits render as removable blue chips inside
  the box; an inline input drives a **trait typeahead** dropdown (excludes already-selected).
  Source: `useRulesetContext().passives`.
- **Results**: header "`N` matches across `M` player(s)" (mono N). Each result = a card row:
  element dot + species (mono 13.5/700) + gender + "L{level}" + shiny ★ + passive chips (**matched
  traits highlighted solid blue**, others dimmed grey) + right-aligned location + **"owned by
  {resolvedName}"** pill (blue). 
  - Filter logic: `pal` is included iff owner in scope **AND** (no species filter OR species matches)
    **AND** every selected trait ∈ `pal.passives`. Derive the pal pool from
    `live.palsByPlayer` across in-scope players (lazy-load them). Tag owner via `resolvePlayerDisplayName`.
  - **Empty state**: dashed panel — "No pal matches these filters / Loosen a trait, or widen the
    player scope above." Default (no filters) = show all pals in scope.

---

## Screen 3 — Settings  ·  `Palgorithm Settings.dc.html`
Single scrolling column, max-width 860. Sub-line "Ruleset `combirank-0.6` · 138 species · 120
passives · all changes saved locally." Sections as white cards:

1. **Planning policy** — "Allow catching wild species" toggle (`allowCatching`; green when on) with
   caption "Off = roster-only planning. Anchors are never suggested." + **Catch-cost weight**
   stepper (− / number / +), caption "One catch = this many breeding combinations in the cost space."
   (`catchCost`, default 1).
2. **Saved perk sets** — "＋ New set" button; each set = name (min-width 96) + its passive chips +
   "edit / remove". These are quick-applied in the planners. (Add/list/remove via `useSettings`.)
3. **Live server connection** — "connected" pill; two-col: **Proxy base URL** (blank = mock) +
   **Bearer token** (password). "Test connection" button + inline result "✓ 200 OK · 6 players ·
   128ms". **Auto-refresh** toggle + interval (seconds) input (interval disabled when off).
4. **Display-name overrides** — table Identifier → Display name + remove "×", plus an add row (two
   inputs + "Add"). Seed data:
   `76561198000000001→Nova, …002→Ember, …003→Quill, …004→Rook,
   …005→Pixel, …006→Skye, …007→Juno, …008→Otto`. Editable inline
   from Server Pals rows too. (`settings.live.nameOverrides`.)
5. **Reserved for the 1.0 patch** (dashed panel, `opacity ~.65`, "available Jul 10" tag): **Active
   ruleset** select showing `combirank-0.6` (placeholder for `genrecomb-1.0`) + **Server-config
   preset** stub. These are intentional placeholders — style as disabled, not broken.

---

## Controls used across views
- **Species select** — replace the plain alphabetical `<select>` in `shared.tsx`'s `SpeciesSelect`
  with a **searchable typeahead** over ~138 (→200) species. Surface element dot + rank; filters by
  element and reachability (breedable / wild-catchable / other-obtain-only) are valuable. The
  "Find a pal" typeahead is a working reference for the interaction.
- **Passive multi-select** — replace `PassiveMultiSelect` (flat checkbox list) with a
  searchable/group-by-tier picker; render selections as blue chips.
- **Gender** — ♂ / ♀ everywhere; add "either / unspecified" **only** in the forward calculator
  (where it surfaces the special-combo distribution).

## Interactions & behavior
- **Graph ⇄ Steps toggle** — segmented control; persists per session. (Prototype: `defaultView` prop.)
- **Hub selection** — clicking a ranked-hub row swaps the hub compare card + drives which plan the
  "Selected plan" panel renders. The **union plan always stands alone**; hubs are comparison only.
- **Typeahead** — filter on each keystroke; dropdown on focus+query; click to commit; Esc/blur closes.
- **`<details>` expansion** — player rows + per-target breakdown. Lazy-load live pals on first expand.
- **Loading / error / empty** — every live surface and every list needs its designed state (specified
  per screen). Row-local pal-fetch failure is distinct from a whole-list failure.
- **Provisional odds** — never render passive odds without the estimate marker.
- Desktop-first; responsive is welcome (graph scrolls horizontally; columns can stack) but not required.

## State management (all already exists — bind, don't rebuild)
- Roster: `useRoster()` → `RosterEntry[]` (localStorage).
- Settings: `useSettings()` → `allowCatching`, `catchCost`, saved perk sets, `live.*`, `nameOverrides`.
- Live: `useLiveContext()` → players, palsByPlayer, palsLoading, selectedPlayerIds (+setter, session
  only, cross-view), refreshPlayers/refreshPlayerPals, status, isUsingMock, lastRefreshedAt, error.
- Ruleset: `useRulesetContext()` → ruleset, species, passives, speciesById.
- Saved plans: `useSavedPlans()` → list/add/remove `SavedPlan` (wire the "★ Save plan" + a Saved
  Plans view; re-open renders the stored `result` without recomputing).
- Local UI state (new): active tab (Server Pals), graph/list view, hub selection, search query +
  selected traits + scope. All plain `useState`.

## Assets
No image assets. Species art is **not** populated in the dataset today (`Species.icon` exists in the
schema but is empty), so the design is **badge-first** (element dots, gender glyphs, rank tags). If
`icon` gets populated later, species thumbnails can slot into `<PalNode>` and the pickers — design
already leaves room. The brand mark is a small inline SVG (in every prototype's sidebar). Icons in
the UI are unicode glyphs (◈ ◇ ★ ▤ ⛭ → ← ⚙ ⟳ ✦ ♂ ♀ ★) — swap for your preferred icon set if desired.

## Files in this bundle
- `Palgorithm Hub Planner.dc.html` — flagship planner + plan graph/steps + perk overlay + per-target.
- `Palgorithm Server Pals.dc.html` — Players tab (all live states) + Find-a-pal search (interactive).
- `Palgorithm Settings.dc.html` — all settings sections + 1.0 placeholders.

Open any file in a browser to see the live design and interactions. Read them alongside this README;
this document is authoritative for values and behavior.
