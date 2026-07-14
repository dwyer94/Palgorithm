# PalCalc Performance Remediation Plan

> Status: **Phases 1–5 implemented (2026-07-14).** Phase 6 still drafted, not yet
> approved. Turns the measurements in `PERFORMANCE_FINDINGS.md` into concrete
> engineering work — file-level designs, sequencing, and done-when criteria — rather
> than restating the findings. **A post-Phase-5 code review (2026-07-14) found 10
> issues in that work; all 10 are now fixed** — the last one (`useSolverTask` hook
> extraction, #7), deliberately deferred to its own pass, landed later the same day —
> see "Post-Phase-5 code review" below.

## Context

`PERFORMANCE_FINDINGS.md` (measured 2026-07-13) identified two P0 UX-breaking
freezes — an infeasible single-target solve (~8.6s frozen tab) and a hub-finder
sweep (7–19s frozen tab) — both rooted in one cause: **the solver runs synchronously
on the main thread; there is no Web Worker anywhere in the codebase.** It also flagged
two P1/P2 items: unvirtualized reference lists, and a single unsplit JS bundle.

This doc commits to concrete designs for each, naming real files and line numbers so
the next session can start implementing without re-deriving the ground truth.

## Ground truth (from code, not the findings doc's generalities)

- **5 solver call sites**, all UI-thread-blocking: `SingleTargetView.tsx:61-70`,
  `TeamDetailView.tsx:49-58`, `HubView.tsx:86-105`, `HubView.tsx:119-134` (this one
  has **no** `setTimeout`/loading state at all — worse than the others, a bug to fix
  as part of Phase 1), `HubView.tsx:144-154`. `ruleset` itself isn't
  postMessage-serializable (it carries live functions + `Set`s); a worker must
  rebuild it via `createRuleset(dataset)` rather than transfer the live object.
- **Infeasibility path**: `findAnchorHints` (`speciesPlanner.ts:730`) runs one full
  Dijkstra graph-solve per candidate species (`Object.keys(ruleset.rankTable)`,
  hundreds of them) just to probe reachability. No multi-hop reachability-closure
  helper exists yet in `src/solver/` — `buildDirectChildIndex` (`hubFinder.ts:118`)
  is one-hop only. One needs to be written.
- **Reference lists**: the dense/bubble mode (`ReferenceBubbles.tsx`) already has a
  fixed `max-h-[420px] overflow-y-auto` container — easy virtualization target. The
  full-screen mode (`ReferenceView.tsx`) is page-scrolled with no bounded container —
  virtualizing it cleanly needs a small layout change (giving results their own
  scroll container), which touches the already-completed 0.D visual design, so it's
  flagged rather than assumed.
- **No existing Worker infra**: no `new Worker(`, no `?worker` imports, no comlink
  dependency anywhere. Vite has no special worker config to fight.
  `vite-plugin-pwa`'s `globPatterns` already includes `**/*.js`, so a worker chunk
  will be swept into the PWA precache by default — a deliberate call, not an
  oversight, but nothing blocks it.

---

## Phase 1 — Solver off the main thread (Web Worker) · P0, do first · **DONE**

Implemented 2026-07-14: `src/solver/worker/{protocol.ts,solver.worker.ts,client.ts}` +
call-site migrations in `SingleTargetView.tsx`, `TeamDetailView.tsx`/`TeamSlotCard.tsx`,
`HubView.tsx`. `RulesetContext.tsx`'s cache-warm effect now warms the worker instead of
the (now solver-idle) main thread. Verified: `tsc -b`, full `npm run test` (150 passed),
`npm run build` (worker emitted as its own chunk), and a live browser pass exercising
all 5 call sites through the worker with zero console errors. Design below kept as
historical record of what was built.

- New `src/solver/solver.worker.ts`. On worker startup, rebuild the ruleset from the
  bundled dataset via `createRuleset(dataset)` (same construction the app already
  does) — never postMessage the live `ruleset` object.
- Typed request/response protocol keyed by a request id (roster, target/targets,
  desiredPassives, options in; plan/hubs result or error out), so in-flight requests
  can be cancelled (`worker.terminate()` + id-based ignore of stale responses).
- A `useSolverWorker` hook wrapping this, replacing the `setTimeout(..., 0)` pattern
  at all 5 call sites listed above. Fixes the `HubView.tsx:119-134` missing-loading-
  state bug as a byproduct of the migration (every call site gets the same async
  wrapper).
- Adds a real **Cancel** button, now meaningful since the worker isn't blocking the
  tab.
- Warms the worker with a throwaway solve on load (subsumes findings-doc item #6,
  cold-start JIT warmup) off the main thread.

## Phase 2 — Infeasibility short-circuit · P0 · **DONE (partial win — see numbers)**

Implemented 2026-07-14 in `src/solver/speciesPlanner.ts`. **The originally-planned
design (a cheap BFS pre-filter run before each candidate's real solve) was tried first
and measured as a *regression*** (~13.5s, worse than the ~8.3s baseline) — most
candidate anchors in this dataset actually succeed (the breeding graph is densely
connected), so paying for both a BFS check *and* a real solve on the common path cost
more than the original single solve. Reverted in favor of what actually shipped:

- `anchorProbeCost()` — an **incremental, warm-started Dijkstra** reusing the base
  solve's already-finalized `dist` map (`ctx.state`, passed into `findAnchorHints`
  instead of being reconstructed) rather than re-deriving the roster's whole
  base-reachable region from scratch for every one of ~289 candidates. Mutates
  `baseState.dist` directly and undoes every touched entry before returning (copying
  ~580 entries per candidate cost about as much as the redundant work it removed), and
  early-exits the instant either target-gender node is finalized (Dijkstra finalizes in
  non-decreasing cost order, so the first target node reached already has the true
  `min(male, female)` cost — no need to drain the rest of the reachable closure the way
  a full `solve()` always does).
- Sound by construction (not an approximation): reuses the exact same hyperedge
  relaxation `solve()` uses, just warm-started and undone per call, so results are
  byte-identical to before — confirmed by the full 150-test suite (including the
  oracle/fixture tests covering anchor hints) passing unchanged.
- **Measured (PERF harness, same infeasible fixture)**: ~8.3s baseline → **~6.0s**, a
  ~28% reduction — real, but not the "near-instant" originally hoped for. The remaining
  cost is genuine per-candidate work (most candidates *do* unlock a meaningful chunk of
  the graph, so there isn't a large "redundant re-derivation" left to cut without an
  unsound multi-candidate-shared computation — see rejected approaches below).
- Verified end-to-end in the browser (worker + this fix together): a heartbeat timer
  ticking every 100ms stayed on-time (max gap ~110ms) through the whole ~6s solve,
  confirming Phase 1's non-blocking property holds with Phase 2's solver change in
  place, and the result (`Frostallion ⚠ not reachable`) was correct.
- **Rejected approach, for the record**: a backward closure computed once from the
  target (instead of once per candidate) was considered — it would be a much bigger
  win, but is **unsound** in general: it only catches anchors that unlock the target in
  a single hop where the edge's other input is already base-reachable, and silently
  misses multi-hop chains where the *same* candidate must bridge two not-yet-reachable
  intermediates before they combine. Since `AnchorHint`s are a first-class, "never
  silent failure" result (CLAUDE.md), this was not shipped.
- Hub-sweep timing (Phase 3's problem) is untouched by this phase, as expected —
  `hubFinder.ts` already calls `resultFromContext` with `withAnchorHints: false`, so it
  never hits `findAnchorHints` at all.

## Phase 3 — Hub-sweep pruning · P0/P1 · **DONE (with a documented tradeoff)**

Implemented 2026-07-14 in `src/solver/speciesPlanner.ts` (`injectProbe`) and
`src/solver/hubFinder.ts`. The originally-planned primary fix below (pre-filtering
the candidate set to rank-proximate species) was **not** used — it would silently
drop candidates that could legitimately be the best hub, the same soundness objection
Phase 2 raised against its own rejected backward-closure approach. Shipped instead:

- `injectProbe` extends Phase 2's `anchorProbeCost` trick (incremental, warm-started
  Dijkstra reusing an already-solved base fixpoint) from "cost only" to "deduped
  combination count": it now also tracks `from` pointers alongside `dist`, so
  `reconstruct()` can walk the mutated state and return the true distinct-combo count
  (not the raw additive `dist`, which double-counts shared intermediates — see
  `reconstruct`'s doc comment) before undoing the mutation. It keeps relaxing until
  every wanted target's both gender-nodes are finalized (not just the first, since a
  hub candidate is scored against several targets at once), unlike `anchorProbeCost`
  which only ever needed one answer.
- `hubFinder.ts`'s fixed-target sweep now solves the non-augmented roster's base
  fixpoint **once** (shared across all ~260 candidates, plus once per target needing
  its own dedicated catching-exclusion base), then for each candidate seeds just that
  candidate's two individuals into the shared base via `injectProbe` and reads off
  every variable target's combo count from one warm-started pass — instead of a full
  `solveContext` over the augmented roster per candidate. The existing coarse
  branch-and-bound pre-check (skip a candidate entirely if even its best-case floor
  can't beat the current `worst()`) is kept as a zero-cost filter before any probing.
- **Measured (PERF harness, 3-target sweep, 130-species roster)**: ~7740ms baseline
  → **~1319ms**, a **~5.9x reduction**.
- **The tradeoff, found during verification (not assumed) — read before touching this
  code again**: a keyed (species-matched, not positional) diff of every candidate's
  exact score against the pre-change code, across several scenarios, found:
  - **`allowCatching: true`**: zero divergence — every one of 259 candidates' scores
    matched byte-for-byte in every scenario tested.
  - **`allowCatching: false`** (the app's current default,
    [catching-default-flipped-roster-only]) — real divergence: 51/256 and 126/258
    candidates got a *different* combo count than the pre-change code, in **both**
    directions (sometimes fewer combos than before, sometimes more), which occasionally
    changes which species land in the final top-`maxHubs` list.
  - Root cause: raw Dijkstra `dist` is provably identical either way (Phase 2 already
    established this is order-independent), but when a node's minimum cost is
    achievable via more than one equal-cost derivation tree, *which* tied tree gets
    recorded in `from` depends on traversal order. Warm-starting from an
    already-fully-solved base roster resolves every tie *before* the candidate's
    seed is introduced, whereas a fresh solve on the augmented roster resolves the
    same ties with the candidate already in the mix — a structural difference, not a
    bug, and not fixable without abandoning the warm-start (i.e. the thing that makes
    this fast). Catching-enabled graphs are shallower (many nodes reachable at cost 1
    via a direct catch) with far fewer multi-hop tied paths to begin with, which is
    almost certainly why no divergence showed up there.
  - Every reported result, old or new, is still a real, achievable breeding plan —
    this is a **different equally-valid tied answer**, not a fabricated or unreachable
    one. It also means `combinationCount` was never a canonical "the" global minimum
    even before this change; ties were always resolved by whatever order `solve()`'s
    linear-scan queue happened to process them in. This phase's warm-start just
    resolves a different (still arbitrary) subset of those same ties.
  - **Decision (2026-07-14, user-approved)**: ship it. The speedup applies
    unconditionally (`allowCatching` true or false); the ranking-drift risk is
    accepted and documented here rather than left undiscovered.
- Verified: `tsc -b` clean, full `npm run test` (150 passed, including every existing
  hub fixture in `test/solver/hubFinder.test.ts` and `test/pipeline/suggestHubs.test.ts`
  unchanged), and the differential comparison above (ad hoc, not checked in as a
  permanent test — the point was establishing the tradeoff, not guarding it, since
  guarding it would mean asserting today's arbitrary tie-break is the required
  target forever).

Original plan (superseded, kept for context):

- `findHubs` (`hubFinder.ts:253`) currently does a full `solveContext` per candidate
  (~260 of them) whenever any target is "variable." Primary fix: pre-filter the
  candidate set (already sorted by `obtainPlan.cost`) to rank-proximate species
  before entering the expensive per-candidate loop, directly shrinking N. Secondary,
  if needed: tighten the `worst()`/branch-and-bound seed so pruning isn't stuck at
  `Infinity` for the first `maxHubs` candidates.
- Must produce identical hub rankings to today's exhaustive sweep (tiebreak at
  `hubFinder.ts:304` depends on this) — verify against existing hub fixtures, not
  just the PERF harness timing.

## Phase 4 — Reference list virtualization · P1 · **DONE**

Implemented 2026-07-14. The live profile confirmed the cost first, per this phase's own
caveat: a React `<Profiler>` temporarily wrapped `ReferenceView`'s results and measured
real commits while typing a single broad-match character into the search box (291
species, dev build, so StrictMode-doubled and unminified — real numbers are lower, but
the frame-budget violation is real either way): **table (compact) mode ~33ms/keystroke,
"Full" card-grid mode ~82ms/keystroke**, both well past the 16ms budget. Instrumentation
was removed before shipping (`ReferenceView.tsx` has no trace of it).

- `@tanstack/react-virtual` added as a dependency. `VirtualizedList` (`components.tsx`)
  virtualizes the dense/bubble panels' existing `max-h-[420px] overflow-y-auto`
  container directly — only ~15-20 rows are ever mounted regardless of the ~291-item
  dataset, confirmed via `[data-index]` DOM counts and scroll-position spot checks in
  the browser.
- Full-screen mode's layout change (giving results their own scroll container, instead
  of the whole page scrolling) went through **explicit user sign-off** as this doc
  required, before any code changed — user picked "pin filters, scroll results."
  Implemented as: `ReferenceView.tsx`'s `<main>` becomes `md:flex md:h-full md:flex-col
  md:overflow-hidden` (title/tabs `md:flex-none`, results `md:min-h-0 md:flex-1`); each
  list component's own filter chrome (search/chips/sort) is `md:flex-none` and only its
  results section is `md:min-h-0 md:flex-1 md:overflow-y-auto`. All of this is
  `md:`-gated (matching Tailwind's `min-width: 768px`, same breakpoint the new
  `useIsDesktop()` hook checks) — **below `md:`, every changed element has no active
  class, so mobile is byte-for-byte the pre-existing plain-stack/whole-page-scroll
  layout.** This was deliberate, not laziness: `AppShell` itself only bounds view height
  at `md:` (`overflow-y-auto` at the outer level below it), so an unconditional bounded
  results panel would compute height against an unbounded ancestor on mobile and
  silently collapse — verified this stays a non-issue by loading fresh at 375px width
  and confirming the plain unvirtualized `<table>` renders all 291 rows exactly as
  before.
- The default (compact/table) full-screen view now virtualizes via a new
  `VirtualizedTable` (`components.tsx`) — a CSS-grid stand-in for `<table>`, since
  absolutely-positioning virtualized rows for the windowing trick isn't compatible with
  real table layout. Both `PalReferenceList` and `PerkReferenceList` pass an explicit
  `grid-template-columns` string shared by the sticky header row and every body row, so
  header/body columns stay pixel-aligned (verified in-browser: identical cell left-edge
  offsets after scrolling). Desktop-only via `useIsDesktop()`
  (`window.matchMedia('(min-width: 768px)')` + a `change` listener); mobile keeps the
  original unvirtualized `<table>` untouched.
- The "Full" card-grid mode (`isFull`) got the bounded/pinned-filters scroll container
  too, but **not** DOM virtualization — a wrapping multi-column grid needs a
  columns-per-row calculation `@tanstack/react-virtual` doesn't do out of the box, and
  that felt like a separate, deliberately-scoped follow-up rather than folding into this
  pass. Not a regression: this mode already rendered all rows unvirtualized before this
  phase, and it's not the default (`compact` is).
- Verified: `tsc -b` clean, full `npm run test` (150 passed, unchanged), `npm run lint`
  (no new errors — the only errors are pre-existing ones in the unrelated `dev-dist/`
  build artifact). Browser-verified end to end: dense/bubble mounted-row counts via
  `[data-index]` DOM queries (~15-20 of 291 mounted), full-screen table sticky header +
  column alignment + scroll-position row updates, mobile fallback confirmed on a fresh
  375px load (plain table, all 291 rows, matching pre-change behavior exactly).

## Phase 5 — Bundle code-splitting · P2 · **DONE**

Implemented 2026-07-14.

- `vite.config.ts` gained `build.rollupOptions.output.manualChunks` splitting
  `react`/`react-dom` into a `vendor` chunk, separate from app code.
- `ReferenceView` and `SettingsView` are now `React.lazy()`-loaded from `App.tsx`
  (`VIEWS` map still holds the lazy-wrapped components; each visited tab's `<View />`
  is now inside a `<Suspense>` with a small text fallback) — neither is needed for the
  default landing tab (`single`), so they no longer cost first-load bytes.
- `graphLayout.ts` has no component boundary of its own to hang `React.lazy` off
  (it's a plain layout-math module, not a component), so the split targets its only
  consumer instead: `PlanView.tsx` (which statically imports it) is now dynamically
  imported from `shared.tsx` as `const PlanRenderer = lazy(() => import('./PlanView')...)`,
  wrapped in `<Suspense>` at both of `shared.tsx`'s two `PlanRenderer` call sites. Since
  `PlanRenderer` only ever renders after a plan has actually solved (never on initial
  mount), this defers `graphLayout.ts` (and the rest of `PlanView.tsx`) out of every
  view's initial render, not just Reference/Settings.
- **Measured (`npm run build`, prod bundle, worker chunk unaffected/excluded from these
  numbers since Phase 1 already isolated it)**: the single monolithic `index.js` —
  717.88 kB / 158.13 kB gzip before — is now `index.js` (551.96 kB / 108.19 kB gzip,
  the initial-load chunk) `+ vendor.js` (140.74 kB / 45.21 kB gzip, cacheable across app
  deploys since react/react-dom rarely change) `+ ReferenceView.js` (0.94 kB / 0.49 kB),
  `SettingsView.js` (13.73 kB / 3.27 kB), and `PlanView.js` (12.53 kB / 4.35 kB), each
  loaded only on first visit/first solve.
  - **Initial-load bytes** (what every user pays before touching anything): dropped
    from 158.13 kB gzip to 108.19 kB + 45.21 kB vendor = 153.4 kB gzip on first visit —
    modest here because `vendor` still loads eagerly (it's imported by the eagerly-
    mounted `single` view), but `vendor` is now a stable, independently-cacheable
    chunk across future app updates, and users who never open Reference/Settings/a
    solved plan save that ~19 kB gzip entirely.
  - **Total gzip across all chunks** ticked up slightly (~158.1 kB → ~161.5 kB, +~2%) —
    expected and accepted: splitting a bundle into more chunks loses a little
    cross-chunk compression efficiency (each chunk gzips its own dictionary). This is
    the known, standard tradeoff of code-splitting; the win is in what loads *first*
    and what's *cacheable*, not raw total bytes.
- Verified: `tsc -b` clean, full `npm run test` (150 passed, unchanged), `npm run lint`
  (same pre-existing `dev-dist/` errors as before this phase, no new ones — confirmed
  by diffing lint output against a stash of this phase's changes). Browser-verified
  against the production build (`vite preview`): confirmed via `read_network_requests`
  that `ReferenceView-*.js` and `SettingsView-*.js` only fetch on first visiting those
  tabs, and `PlanView-*.js` only fetches once a plan actually solves (a Foxparks catch
  plan, `allowCatching` toggled on for the test) — the graph rendered correctly with no
  console errors in all three cases.
  - Hit a false-positive along the way: the PWA service worker precaches the JS/CSS
    bundle, so testing a fresh `npm run build` output against an already-visited
    `localhost` origin served stale pre-Phase-5 assets and looked like a sidebar
    layout regression until `caches.keys()` + `serviceWorker.getRegistrations()` were
    cleared — a known gotcha ([[pwa-service-worker-needs-storage-clear]]), not a real
    bug in this phase's changes.

## Post-Phase-5 code review (2026-07-14) — findings before first public deploy

The owner now plans to let other (non-owner) users use this app once deployed — a material
change from the "personal, single-user" framing elsewhere in this repo's docs (see
`PRODUCTION_READINESS_PLAN.md`'s guest-first direction). Before that first deploy, a full code
review (8 finder angles + manual verification of each candidate) was run over the entire
Phases 1–5 working-tree diff (worker infra, Dijkstra probes, hub-sweep pruning, list
virtualization, bundle splitting — ~1,200 lines). 10 findings survived verification. **9 are
fixed; 1 is deliberately deferred.** This section is the handoff for whichever session picks up
the deferred item — it intentionally repeats enough detail that a fresh session doesn't need to
re-derive it.

### Fixed in this pass (2026-07-14, first sub-pass — worker/client correctness)

1. **Global `cancelAll()` cross-view/cross-slot cancellation** — `src/solver/worker/client.ts`
   was rewritten from a single `cancelAll()` (rejects every pending request app-wide) to a
   queue where each `solverWorker.runX()` call returns `{ promise, cancel }`. Only one request
   is ever posted to the worker at a time; cancelling a still-queued request just removes it
   from the array, cancelling the one actually executing terminates+recreates the worker (the
   only way to interrupt a synchronous solve) and the fresh instance continues the queue.
   Updated `SingleTargetView.tsx`, `HubView.tsx` (3 call sites), `TeamDetailView.tsx` to track
   and cancel only their own task(s) instead of calling the removed `cancelAll()`.
2. **`TeamDetailView.tsx` silent error swallowing** — `runSlot`'s `.catch()` now distinguishes
   `SolverCancelledError` from real failures, `console.error`s the latter (matching
   `HubView`/`SingleTargetView`), and `TeamSlotCard.tsx` renders a per-slot "⚠ Plan failed"
   message via a new `error?: string` prop instead of just clearing the spinner with no trace.
3. **New finding, caught live while verifying fix #1**: a stale-closure race in
   `TeamDetailView.tsx`'s `updateSlot`/`onUpdateTeam` silently dropped a team slot's plan
   whenever two slots solved concurrently — the slower slot's resolution would overwrite the
   *whole* `team` object using the `team` prop snapshot from whenever its own solve started,
   discarding whatever a faster slot had already committed. **This was unreachable before
   Phase 1**: synchronous main-thread solving froze the tab, so a second slot's Run button
   literally couldn't be clicked while the first was solving — the worker migration is what
   made two slots overlap in the first place. Reproduced live (localStorage showed slot 1's
   plan vanish after running slots 1 and 2 back-to-back), fixed with a `teamRef` kept current
   every render so `updateSlot` always patches the latest team regardless of which promise
   settles last.

All three: `tsc -b` clean, full `npm run test` (150 passed, unchanged), browser-verified live
(reproduced the pre-fix failure via localStorage inspection, confirmed both slots retain
correct plans post-fix, zero console errors).

### Fixed in this pass (2026-07-14, second sub-pass — the remaining 6 of 8 open findings)

4. **`solver.worker.ts` `onmessage` switch had no default arm.** A stale/mismatched
   `req.kind` used to leave `response` unassigned, sending `undefined` and hanging that
   request's promise forever (realistic trigger: a stale PWA-cached worker chunk after a
   deploy, per [[pwa-service-worker-needs-storage-clear]]). Added a `default` arm posting
   `{ id, ok: false, error: 'Unknown request kind: ...' }`; TS narrows the exhaustive union to
   `never` in that arm, so `req` is cast defensively rather than typed as unreachable.
5. **`speciesPlanner.ts`'s `anchorProbeCost` and `injectProbe` now restore shared Dijkstra
   state in `finally`.** Both mutate `baseState.dist`/`.from` in place, seeding a candidate at
   cost 0 and relaxing from there; the undo loop that puts every touched entry back now runs
   inside `finally` (wrapping the relax loop *and* `injectProbe`'s `reconstruct()` calls, since
   a broken `from`-chain there was one of the two cited failure modes) instead of only after a
   normal return — an exception mid-probe can no longer leave the shared base state, reused by
   up to ~260 hub candidates per sweep, corrupted for whoever probes it next.
6. **Added a fixture exercising `injectProbe`'s multi-hop dedup path** —
   `test/solver/hubFinder.test.ts`'s new "injectProbe multi-hop dedup" `describe` block builds a
   candidate hub that only unlocks two targets through a shared 2-hop intermediate
   (`HUB+X->MID`, then `MID+S1/S2->TargetA/B`) and asserts both targets report the correctly
   deduped `combos: 2` (not the base 3-combo path, not an overcount). Every other `findHubs`
   fixture in that file only covered the trivial direct-parent (`combos: 1`) shape.
7. **`VirtualizedTable` (`components.tsx`) now carries ARIA table semantics** —
   `role="table"`/`"row"`/`"columnheader"`/`"cell"` on the CSS-grid stand-in, so desktop
   screen readers get row/column announcement in the compact Reference view the same way the
   mobile fallback's real `<table>` already provides. Browser-verified: `role="table"` query
   found 17 rows / 11 header cells / 176 body cells matching the virtualized DOM, zero console
   errors.
8. **`ReferenceBubbles` is now `React.lazy()`-loaded from `App.tsx`**, the same pattern Phase 5
   used for `ReferenceView`/`SettingsView` — user picked this over extracting a shared
   list-rendering module, since the bubbles render on first paint regardless (they're not
   gated behind `visited` like the tab views) and the win is moving their weight into a
   separately cacheable chunk, not skipping the fetch. Confirmed with `npm run build`:
   `PalReferenceList`+`PerkReferenceList` (the actual weight, `@tanstack/react-virtual`
   included) now live in their own chunk instead of `index.js`; `index.js` dropped from
   551.96 kB/108.19 kB gzip (Phase 5's number) to 533.61 kB/104.53 kB gzip. Browser-verified
   live: bubbles still open and render the full Pal list with zero console errors.
9. **`speciesPlanner.ts`'s duplicated `costA + costB + 1` formula is now one
   `combinationCost(costA, costB)` helper**, called from all 5 former sites (`solveMasked`,
   `solve`, `tiedFinalEdges`, `anchorProbeCost`, `injectProbe`) instead of each reimplementing
   it — two of those sites used an `edge.inputs.reduce(...)` form over the same 2-tuple, now
   unified to direct indexing. Pure refactor; full 151-test suite unchanged confirms no
   behavior change.
10. **`hubFinder.ts`'s dedicated-target `injectProbe` calls now run after an early
    feasibility check, not unconditionally before it.** Previously, with
    `excludeTargetsFromCatching: true` and 2+ dedicated targets, an already-infeasible
    candidate still paid for every remaining dedicated target's full relaxation pass before
    the viability check could bail. Now the shared-batch probe's results are checked first
    (skipping every dedicated probe entirely if any non-dedicated variable target already
    failed), and the dedicated loop itself breaks on the first infeasible target instead of
    always running to completion. Pure perf reordering — same final `hubs`/`injectCost`
    output, confirmed by the unchanged 151-test suite.

Items 4–10: `tsc -b` clean, full `npm run test` (151 passed, including the new fixture),
`npm run lint` (same pre-existing `dev-dist/` errors only, no new ones), and live browser
verification for the two UI-facing changes (7, 8) with zero console errors in a fresh tab.

### 7. `useSolverTask` hook extraction — DONE (2026-07-14, its own pass)

`HubView.tsx`/`SingleTargetView.tsx`/`TeamDetailView.tsx`'s worker-call lifecycle (set-loading,
request, distinguish `SolverCancelledError`, `console.error`/track error on real failure,
clear-loading in `finally`) was hand-copied across 5 call sites instead of one shared hook —
exactly what caused fixed-finding #2 above (`TeamDetailView`'s copy had silently dropped the
error-distinguishing logic the other 4 copies have).

Implemented as `src/ui/useSolverTask.ts`, two hooks sharing one internal implementation:

- `useKeyedSolverTasks<K>()` — the core: tracks any number of concurrent in-flight `SolverTask`s
  keyed by `K`, exposing `isPlanning(key)`, `error(key)`, `run(key, start, handlers)`,
  `cancel(key)`. `run`'s `start` callback returns a `SolverTask<T>`-shaped `{ promise, cancel }`
  (duck-typed, so a combined multi-task call — e.g. `Promise.all` of a union+hubs pair with a
  cancel that cancels both — plugs in without any special-casing). `onError` is a side-effect-only
  callback (logging, extra state resets); the hook's own `error` state is always the source of
  truth for what to render, never suppressed by providing one.
- `useSolverTask()` — `useKeyedSolverTasks` with the key fixed to one slot, for the 4 call sites
  that only ever have a single request in flight at once.
- Call sites: `SingleTargetView.tsx` (dropped its own `isPlanning`/`planError` state, now reads
  `task.isPlanning`/`task.error` directly), `HubView.tsx` (`planTask` shared by `runPlan` +
  `applySuggestion` — unchanged from before, they were already sharing one `isPlanning`/
  `activeCancel`; `searchTask` for `searchAllHubsFromSuggestion`), `TeamDetailView.tsx`
  (`useKeyedSolverTasks<number>()` keyed by slot index, replacing its own
  `planningIndices`/`slotErrors` state + `activeCancels` ref map — `TEAM_SLOT_COUNT` slots can
  solve concurrently, which is exactly the scenario fixed-finding #3 was about).
- Verified: `tsc -b` clean, full `npm run test` (151 passed, unchanged — no test touches UI hook
  internals), `npm run lint` (same pre-existing `dev-dist/` errors only). Live browser
  verification of all 5 former call sites: single-target run → correct infeasible-result render;
  Hub `runPlan` (combined union+hubs task); Hub `applySuggestion` (quick-pick) →
  `searchAllHubsFromSuggestion` (upgrades quick pick to full sweep, scope label flips from
  "Quick pick · 3 checked" to "Ranked hubs · 287 checked"); Team Detail — re-ran two slots
  (Nyafia, Lamball) back-to-back to deliberately re-trigger fixed-finding #3's concurrency
  scenario, confirmed **both** slots landed their own "New re-run result" independently (no
  dropped plan). Zero console errors throughout.

## Phase 6 — Perf harness wired into CI · nightly/opt-in

- Wire `test/perf/solver.perf.test.ts` (already `PERF=1`-gated) into a scheduled
  nightly job, not per-PR. Add a clean Lighthouse run on a quiet machine/CI, and flag
  a stretch goal: a Lighthouse user-flow/INP audit that actually clicks "Run plan" —
  the only way Lighthouse would catch a Phase 1–3 class regression.
- **Depends on `PRODUCTION_READINESS_PLAN.md` Phase 3 (CI)** landing first — no
  GitHub Actions exists yet.

---

## Suggested sequencing

1. **Phase 1 (Worker)** — biggest UX win, unblocks the thread for everything else. DONE.
2. **Phase 2 (Infeasibility short-circuit)** — cheap, algorithmic, hits the single
   most likely first-time-user scenario (small roster + rare target). DONE.
3. **Phase 3 (Hub-sweep pruning)** — more involved, same file family as Phase 2. DONE
   (ships a documented ranking-drift tradeoff for `allowCatching: false` — see above).
4. **Phase 4 (Reference virtualization)** — after a live profile, independent of 1–3.
   DONE.
5. **Phase 5 (Bundle splitting)** — independent, cheap, slot in anytime. DONE.
6. **Phase 6 (CI perf gate)** — after readiness-plan Phase 3 lands.

## Out of scope

- No changes to breeding rules/ruleset math (`CLAUDE.md` invariant #1) — every fix
  here is UI/threading/algorithmic-search, not domain logic.
- No accounts/backend work — that's `PRODUCTION_READINESS_PLAN.md` Phase 1,
  unrelated.

## Verification

- **Phase 1**: manual — tab stays interactive during a solve, Cancel works; existing
  solver unit tests pass unchanged (logic moved, not rewritten).
- **Phase 2**: `PERF=1` harness shows the infeasible case collapse from ~8.3s; oracle
  tests unchanged.
- **Phase 3**: `PERF=1` harness shows the hub-sweep case drop from ~7.7s to ~1.3s; hub
  fixture tests pass unchanged. Rankings are identical for `allowCatching: true`
  (verified by an ad hoc keyed diff, not a permanent test); for `allowCatching: false`
  rankings can drift from a Dijkstra tie-break difference, a known and accepted
  tradeoff — see the Phase 3 section above, not a regression to chase.
- **Phase 4**: React `<Profiler>` before/after on the Reference tab confirmed the cost
  (~33-82ms/keystroke dev-build before, see Phase 4 section); `tsc -b`, `npm run test`
  (150 passed), `npm run lint` all clean; browser-verified mounted-row counts, sticky
  header/column alignment, and a fresh mobile-width load matching pre-change behavior.
- **Phase 5**: `npm run build` output confirms chunk split, gzip totals don't
  regress.
- **Phase 6**: a PR with a deliberate perf regression confirms the nightly job would
  catch it, then revert.
