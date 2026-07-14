# PalCalc Performance Findings

> Status: **measured 2026-07-13**, feeding the "Do we need performance testing?" open
> question in `PRODUCTION_READINESS_PLAN.md`. Numbers below are from a dev machine
> (Node 25, the bundled 1.0 dataset, 291 species); treat them as ratios/orders-of-magnitude,
> not absolutes. Reproduce with the harness in `test/perf/solver.perf.test.ts`.
>
> See `PERFORMANCE_REMEDIATION_PLAN.md` for the phased, file-level plan to fix these.

## TL;DR

The app is **fast to load but can freeze hard on compute.** Load and layout are genuinely
good (FCP/LCP ~0.7s desktop, CLS 0, interactive in ~290ms real-time). The problem is entirely
on the *interaction* side: two solver paths block the main thread for **7–19 seconds** on
completely ordinary inputs. Before going public, the freezes are the thing to fix — they're not
edge cases, they're "modest roster, asks for a rare Pal." The JS bundle (698 kB raw, ~150 kB
gzip) is a secondary caching-hygiene item, not a web-vitals problem.

| # | Area | Severity | One-line |
|---|------|----------|----------|
| 1 | Infeasible single-target solve freezes the tab ~9s | **P0** | Small roster + rare target → ~8.6s frozen, then "not possible" |
| 2 | Hub-finder sweep freezes the tab 7–19s | **P0** | Multi-target hub search runs a full solve per candidate species |
| 3 | Solver runs on the main thread at all | **P0 (root)** | No Web Worker; every solve blocks paint/input. Fixing this neutralizes #1 and #2's UX impact |
| 4 | Reference lists render all ~291 rows unvirtualized | **P1** | `results.map` over the full dex every keystroke |
| 5 | Single 698 kB JS chunk, no code-splitting | **P2** | Only ~150 kB gzip over the wire; a caching/growth-hygiene item, **not** a current web-vital problem (see Lighthouse below) |
| 6 | ~2s cold-start on the first solve | **P2** | One-time JIT warmup on the first plan after load |
| Load / Web Vitals | — | **Good** | FCP/LCP ~0.7s desktop, CLS 0, interactive ~290ms real-time. The problem is *interaction*, not load |
| Memory | — | OK | Nothing alarming; dataset + icons are modest |

---

## How this was measured

- **Solver timings**: `test/perf/solver.perf.test.ts` — a Vitest harness that builds the
  real ruleset from `dataset.1.0.json` (same `parseDataset` + `createRuleset` path the app
  uses) and times representative solves. It's **opt-in** (gated on `PERF=1`) so it never
  slows the normal `npm test`:

  ```
  PERF=1 npx vitest run test/perf/solver.perf.test.ts --reporter=verbose
  ```

  Rosters are "own the N commonest breedable species, both genders" (realistic fodder);
  targets sample the rank range from rarest (hardest) to commonest.
- **Bundle size**: `npm run build` output.
- **Web Vitals**: Lighthouse (headless Chrome) against the production build served by
  `npm run preview`, cross-checked against the real browser's Navigation Timing API. See the
  Web Vitals section below — with an important caveat about lab-run contamination.
- **Render cost (#4)** is *identified from code* but **not yet profiled live** — see "Not yet
  measured".

### Solver harness results (warm, single run each)

| workload | freeze (ms) | result |
|---|---|---|
| single-target · typical (common target, 40-species roster) | ~34 | feasible |
| single-target · deep-but-feasible (rarest target, 40-species roster) | ~31 | feasible, 60 combos |
| **single-target · INFEASIBLE (rarest target, 10-species roster)** | **~8300** | infeasible |
| multi-target union · 3 targets, 130-species roster | ~86 | feasible, 29 combos |
| **hub-finder sweep · 3 targets, 130-species roster** | **~7200** (up to ~19000 cold) | 5 hubs |
| *(separately)* cold-start first solve after process/page load | **~2000 one-time** | — |

The gap is stark: a *successful* solve is tens of milliseconds, but proving a target
**impossible** or running a **hub sweep** is thousands.

---

## Findings in detail

### 1 & 2 — The two multi-second freezes (P0)

Both come from the same shape: work proportional to the whole 261-node breeding graph, run
synchronously.

- **Infeasible solves are exhaustive.** When a target genuinely can't be reached from the
  roster, `planSpecies` explores the entire reachable closure before it can conclude "no
  path," costing ~9s. A user with a small/new roster asking for a rare Pal — the single most
  likely first thing a stranger tries — hits this and waits ~9 frozen seconds for a "not
  possible" answer. **This is the worst UX in the app right now.**
- **The hub sweep runs a full solve per candidate.** `findHubs`
  ([hubFinder.ts:253](../src/solver/hubFinder.ts)) loops over every obtainable candidate
  species (~260) and, whenever any target is "variable" (the rarest target essentially always
  is), calls `solveContext` on an augmented roster — a complete breeding fixpoint — inside the
  loop ([hubFinder.ts:277-280](../src/solver/hubFinder.ts)). ~260 candidates × ~30–75 ms per
  solve ≈ 7–19 s. The branch-and-bound cutoff (`worst()`) helps little because with
  `maxHubs = 5` it stays at `Infinity` until five hubs are accepted.

### 3 — Solver runs on the main thread (P0, and the highest-leverage fix)

`SingleTargetView` wraps the solve in `setTimeout`
([SingleTargetView.tsx:61](../src/ui/SingleTargetView.tsx)) purely so React can paint a
spinner first — the compute itself still runs on the main thread and freezes the tab (no
input, no scroll, "page unresponsive" dialog on slow machines). `HubView`/Team Builder are
the same. There is **no Web Worker anywhere** in the codebase.

**Recommendation (do this first):** move the solver behind a Web Worker. This is the single
change with the most leverage — it doesn't make the algorithms faster, but it makes every
freeze above *non-blocking*: the UI stays responsive, you can show real progress, and you can
offer a **Cancel** button. The solver is already pure and dependency-light (`ruleset` +
`roster` + options in, plan out), so it's a clean thing to move off-thread. Combine with #1/#2
below for the actual speed wins.

Then, to also make the numbers smaller (worth doing, but secondary to un-blocking the thread):

- **#1**: short-circuit infeasibility. Precompute the roster's reachable-species closure once
  (a forward BFS over `forward()` edges) and answer "infeasible" for anything outside it
  immediately, instead of running the full cheapest-derivation search to exhaustion.
- **#2**: avoid the per-candidate full solve — precompute each candidate's marginal
  contribution, or tighten the bound so pruning kicks in before ~260 solves. Even capping the
  candidate set to plausibly-useful hubs (e.g. rank-proximate to a target) would cut it a lot.

### 4 — Unvirtualized reference lists (P1)

`PalReferenceList` and `PerkReferenceList` filter with `useMemo` (good) but then
`results.map(...)` render **all** matching rows — up to ~291 Pal cards/rows — as real DOM
nodes ([PalReferenceList.tsx:296,327,364](../src/ui/reference/PalReferenceList.tsx)), on every
filter/search keystroke. This is the likely source of the "reference search lag" already
touched in git history. Not a freeze like #1/#2, but it taxes INP on the Reference tab.
**Recommendation:** windowing (`react-window`/`@tanstack/virtual`, or a manual "render first N
+ IntersectionObserver"). Measure with a live profile first (below) to confirm it's worth the
dependency.

### 5 — Single un-split bundle (P2 — downgraded after live measurement)

`npm run build` emits one chunk:

```
dist/assets/index-*.js   697.86 kB │ gzip: 154.15 kB   ← one chunk, everything
dist/assets/index-*.css   33.27 kB │ gzip:   6.57 kB
```

Vite warns (`chunks are larger than 500 kB`), and the 482 kB `dataset.1.0.json` is inlined into
it. **But the live Web-Vitals measurement (below) shows this is not currently hurting load**:
over the wire it's ~150 kB gzip, Lighthouse measured app script *bootup at ~0 s*, and the real
browser reaches interactive in ~290 ms. So this is a **caching-hygiene and future-growth** item,
not a web-vitals emergency — worth doing, but P2, not P1:

- `build.rollupOptions.output.manualChunks` to split React/vendor from app code, so a vendor
  change doesn't bust the app-code cache entry (and vice-versa).
- `React.lazy` + route-level `Suspense` for heavy, not-on-first-paint views (Reference, the SVG
  graph layout in `graphLayout.ts`, Settings) — keeps the chunk from growing unbounded as the
  app adds the accounts/onboarding surfaces in the readiness plan.

### Web Vitals (Lighthouse + real Navigation Timing)

**Load and layout are good; the caveat is lab contamination.** Measured against `npm run
preview` (production build):

| metric | desktop (no CPU throttle) | mobile (default 4× throttle) | real browser (unthrottled) |
|---|---|---|---|
| FCP / LCP | **0.7 s / 0.7 s** | 2.7 s | — |
| CLS | **0** | **0** | — |
| Time to Interactive | 2.0 s | 8–9 s | domInteractive **~290 ms** |
| Total Blocking Time | 1.3 s | 5.3–6.7 s | — |
| App JS bootup (script eval) | **~0 s** | 68 ms | 14 ms transfer |
| Lighthouse Perf score | 70 | 61 | — |

**Do not take the 61/70 scores at face value.** This dev machine was running a *second* Claude
session concurrently (a `tsx` dataset-parse process plus an `npx serve dist`), saturating the
CPU. Under Lighthouse's throttling, the single **longest main-thread task in every run was
Lighthouse's own instrumentation script `_lighthouse-eval.js`** (7.4 s mobile, 1.9 s desktop) —
i.e. its FID/TBT probe being CPU-starved, **not app code**. The app's own attributable work is
tiny (bootup ~0 s; real-browser interactive ~290 ms; CLS a perfect 0). On a quiet machine or in
CI, the load score should land high — **re-run it there before quoting a number.**

The genuinely important point: **a Lighthouse *page-load* audit doesn't exercise this app's real
performance risk at all.** The freezes (#1–#3) happen on a *user interaction* ("Run plan"), which
a cold-load audit never triggers. To catch them in Lighthouse you'd need a **user-flow / INP
audit** that navigates, selects a target, and clicks Run — that's where TBT would legitimately
spike. Load performance is not the launch blocker; interaction latency is.

### 6 — Cold-start (P2)

The first solve in a fresh process/page load costs ~2 s of one-time JIT warmup on top of its
own work (subsequent identical solves are ~30 ms). Minor and partly unavoidable, but once the
solver is in a Worker (#3) you can warm it with a throwaway solve on load, off the main thread,
so the user's first real plan is already warm.

### Memory — OK

Nothing alarming. The parsed dataset + ruleset structures and ~290 runtime-cached Pal icons
are modest for a browser tab; no leak pattern observed and no growth-over-time workload here.
Not a launch blocker — revisit only if live profiling (below) shows otherwise.

---

## Not yet measured (recommended next)

- **A clean Lighthouse run.** The lab scores above were contaminated by a concurrent process on
  this machine (see Web Vitals). Re-run `npx lighthouse http://localhost:4173 --preset=desktop`
  on a quiet machine or in CI to get a trustworthy load score. Expected to be high given the
  real numbers.
- **A Lighthouse *user-flow* / INP audit** that clicks "Run plan" — the only way a Lighthouse
  run will actually surface the #1–#3 freezes (a page-load audit never triggers a solve).
- **Live render profiling** of the Reference tab (React DevTools Profiler / Performance panel)
  to quantify #4 before spending a dependency on virtualization.

## Suggested sequencing

1. **Web Worker for the solver (#3)** — biggest UX win, unblocks the thread for #1/#2/#6 at
   once. Do first.
2. **Infeasibility short-circuit (#1)** — cheap, high-impact, most-likely-hit case.
3. **Hub-sweep bound/candidate pruning (#2)** — more involved algorithmic work.
4. **Reference virtualization (#4)** — after a live profile confirms the cost.
5. **Bundle code-splitting (#5)** — independent and cheap, but P2: it's caching hygiene, not a
   measured web-vital problem. Fold in when touching the build for the readiness plan anyway.
6. Wire the harness into CI as an **opt-in / nightly** job (it's ~20 s and PERF-gated, so keep
   it out of the per-PR `npm test`), and add a clean Lighthouse check to the deploy pipeline.
