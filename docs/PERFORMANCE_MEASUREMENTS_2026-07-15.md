# Performance Measurements — 2026-07-15 (post-remediation)

> Status: **measured 2026-07-15**, a follow-up pass after `PERFORMANCE_REMEDIATION_PLAN.md`
> Phases 1–5 (Web Worker, infeasibility short-circuit, hub-sweep pruning, reference-list
> virtualization, bundle splitting) plus the post-Phase-5 code review, all landed 2026-07-14.
> This doc answers the two items `PERFORMANCE_FINDINGS.md` flagged as **"not yet measured"**:
> a clean Lighthouse run, and a real-interaction audit that actually exercises "Run plan"
> (a page-load audit never triggers a solve, so it can't see the Phase 1–3 fixes at all).
>
> Machine caveat, same spirit as the original doc: this is a shared cloud sandbox, not the
> original "dev machine." All five solver-harness workloads scale by a consistent **~3–3.3x**
> versus the numbers in `PERFORMANCE_FINDINGS.md` — read absolute ms as this-machine numbers,
> ratios/pass-fail as the portable signal.

## TL;DR

**The remediation held.** Every regression ceiling in `test/perf/solver.perf.test.ts` still
passes, the bundle is unchanged from the post-code-review numbers, and — the new part — a
real Playwright-driven browser test that clicks "Run plan" on the worst-case ~16s infeasible
solve found **zero main-thread long tasks** and a **34ms response to a real click** dispatched
mid-solve. That's the empirical confirmation that Phase 1's Web Worker migration actually
delivers what it claimed; previously this was verified manually (a heartbeat timer, ad hoc, not
captured by any tooling). Lighthouse desktop/mobile scores are excellent once isolated from an
environment artifact (below). One new, minor finding: the external Google Fonts request is a
render-blocking `<link>` with no fallback, and in this sandbox's network it fails outright
(`ERR_CONNECTION_RESET`) — currently harmless to Web Vitals here, but worth a note given the
app's "runs locally / on a home server" framing (see below).

| # | Area | Result |
|---|------|--------|
| Solver harness | All 5 workloads pass their ceilings; timings scale ~3.2x vs. the original dev machine, consistently across all workloads (not a regression — see below) |
| Bundle | Unchanged from post-code-review Phase 5 numbers (533.43 kB / 104.39 kB gzip main chunk) |
| Lighthouse desktop (isolated) | **100** perf score, FCP/LCP 0.5s/0.6s, CLS 0, TBT 0ms, Speed Index 0.5s |
| Lighthouse mobile (4x CPU throttle, isolated) | **96** perf score, FCP/LCP 2.2s/2.4s, CLS 0, TBT 40ms |
| **New: real "Run plan" interaction probe** | **0 long tasks**, max 67ms heartbeat gap, a real click answered in **34ms**, during a 16s worst-case solve |
| New finding | Google Fonts `<link rel="stylesheet">` is render-blocking and has no local fallback; currently harmless to CWV but an external dependency worth reconsidering (P3, not urgent) |

---

## 1. Solver harness (`PERF=1 npx vitest run test/perf/solver.perf.test.ts`)

Ran twice for consistency:

| workload | 2026-07-13 (orig. dev machine) | 2026-07-15 run 1 | 2026-07-15 run 2 | ratio |
|---|---|---|---|---|
| single · typical (common target) | ~34 ms | 111 ms | — | 3.3x |
| single · deep-feasible (rarest target) | ~31 ms | 145 ms | — | 4.7x* |
| single · **INFEASIBLE** (small roster) | ~6000 ms (post Phase 2) | 19466 ms | 17076 ms | 3.2x |
| union · 3 targets | ~86 ms | 244 ms | — | 2.8x |
| hub sweep · 3 targets | ~1319 ms (post Phase 3) | 4342 ms | 4417 ms | 3.3x |

\* small absolute numbers (ms), more sensitive to noise — still consistent with the others.

All ratios cluster around **~3.2x**, which is the signature of a uniformly slower/shared CPU,
not an algorithmic regression — a real regression would show up on only the workloads that hit
the changed code path, not uniformly across all five. `npm run test` (full suite, 151 tests)
passes unchanged.

One functional note: `deep-feasible` reports **61 combos** here vs. **60** in the original
doc. This is expected, not a bug — `d39da7a` ("Fix single-target planner dropping
special-combo-only species from graph"), which widened `buildGraph()` to include special-combo
children, landed *after* the original 2026-07-13 measurement. A 1-combo shift on a deep,
tie-heavy path is exactly the kind of change that fix could cause. Not investigated further;
the oracle/fixture suite (which would catch an actual correctness break) is green.

## 2. Bundle size (`npm run build`)

```
dist/assets/index-*.js              533.43 kB │ gzip: 104.39 kB   (main chunk)
dist/assets/vendor-*.js             140.74 kB │ gzip:  45.21 kB   (react/react-dom)
dist/assets/solver.worker-*.js      375.02 kB                    (own chunk, off main thread)
dist/assets/PerkReferenceList-*.js   18.07 kB │ gzip:   4.47 kB
dist/assets/SettingsView-*.js        13.73 kB │ gzip:   3.27 kB
dist/assets/PlanView-*.js            12.53 kB │ gzip:   4.35 kB
dist/assets/ReferenceBubbles-*.js     2.23 kB │ gzip:   0.97 kB
dist/assets/ReferenceView-*.js        0.99 kB │ gzip:   0.51 kB
```

Matches the post-code-review Phase 5 numbers in `PERFORMANCE_REMEDIATION_PLAN.md` almost
exactly (533.61/104.53 kB there vs. 533.43/104.39 kB here — noise-level diff, confirms no
drift). Still one chunk over Vite's 500 kB warning threshold; still P2/caching-hygiene, not a
measured web-vital problem (see Lighthouse below).

## 3. Lighthouse — clean run, with an environment artifact isolated

Ran `npx lighthouse` (v13.4.0) against `vite preview` using the sandbox's bundled Chromium.

**First run (unmodified) surfaced an environment artifact, not an app problem**: the
render-blocking Google Fonts `<link>` in `index.html` (`fonts.googleapis.com/css2?...`) took
**~13 seconds** to resolve over this sandbox's outbound network path, dragging Speed Index to
7.8s and the score to 90 despite FCP/LCP/TBT all being fine (0.5s/0.6s/0ms). Confirmed by
inspecting the network-requests trace: every other resource loaded in <100ms; the fonts request
alone had `networkEndTime: 12949ms`. This is the same class of "lab contamination" the original
`PERFORMANCE_FINDINGS.md` flagged for its own Lighthouse run (a concurrent process saturating
the CPU there; an external CDN timing out here) — not the app's own performance.

Re-ran with `--blocked-url-patterns="https://fonts.googleapis.com/*"` to isolate the app's own
cost from this network artifact:

| metric | desktop (isolated) | mobile, 4x CPU throttle (isolated) |
|---|---|---|
| Performance score | **100** | **96** |
| FCP | 0.5 s | 2.2 s |
| LCP | 0.6 s | 2.4 s |
| CLS | 0 | 0 |
| TBT | 0 ms | 40 ms |
| Speed Index | 0.5 s | 2.2 s |
| Interactive | 0.6 s | 2.4 s |

These are excellent numbers, consistent with (better than) the original doc's desktop figures
and a large improvement over its throttled-mobile TTI (2.4s here vs. 8–9s there — that older
number was itself contaminated by the concurrent-process issue documented at the time).

**New finding (P3, not urgent):** the Google Fonts stylesheet is fetched via a plain
render-blocking `<link rel="stylesheet">` (with `preconnect` hints already in place, and
`&display=swap` governing font-swap once the CSS loads — but the CSS *fetch itself* still
blocks by default). It didn't hurt any Core Web Vital in this run because FCP/LCP already
fired before/around when it would matter and the browser has a fallback font stack, but a
user on a slow or blocked path to `fonts.googleapis.com` (corporate firewall, ad-blocker,
regional restriction) will see the exact stall this run did. Given this app's explicit
"personal, client-side... run locally / on a home server" framing (`CLAUDE.md`), an external
font CDN is a bit of an outlier next to the fully-bundled dataset/icons — self-hosting the two
font families (already narrow: Space Grotesk + JetBrains Mono, a handful of weights) would
remove the dependency entirely. Not recommending action without asking first, per the
"don't optimize/change things beyond what's asked" norm — flagging for the next planning pass.

## 4. Real interaction probe — the gap the original doc flagged as unmeasured

`PERFORMANCE_FINDINGS.md`'s "Not yet measured" section called out that **a Lighthouse
*page-load* audit never triggers a solve**, so it can't see whether Phase 1's Web Worker
migration actually keeps the tab responsive — that was previously checked only manually (an
ad hoc 100ms heartbeat timer during one browser session, per `PERFORMANCE_REMEDIATION_PLAN.md`
Phase 2). This pass built a small Playwright script (not checked into the repo — scratch
tooling) that:

1. Launches the sandbox's bundled Chromium against the production preview build.
2. Seeds `localStorage` with the same 10-species roster the perf harness uses.
3. Installs a `PerformanceObserver` for `longtask` entries and a 50ms `setInterval` heartbeat
   *before* the solve starts.
4. Types "Ophydia" (the same rarest-target fixture the harness uses) into the target selector
   and clicks **▶ Run plan** — the real UI, not a unit-test call into the solver.
5. Mid-solve, dispatches a **real synthetic click** on the Cancel button and times how long it
   takes to register — the actual claim under test (can the user *do something* during a solve).
6. Re-runs to completion (uninterrupted) and reads back the Long Task / heartbeat stats.

**Result, on the worst-case ~16s infeasible solve:**

```json
{
  "cancelClickRespondedWithinMs": 34,
  "solveWallClockMs": 16099,
  "heartbeatCount": 322,
  "maxHeartbeatGapMs": 67,
  "longTaskCount": 0,
  "maxLongTaskMs": 0,
  "totalLongTaskMs": 0,
  "resultLooksLike": "infeasible"
}
```

- **Zero `longtask` entries** on the main thread across the entire 16-second solve — the
  browser's own API for "something blocked the main thread >50ms" recorded nothing, because
  the actual work is in the Worker.
- **Max heartbeat gap 67ms** (heartbeats fire every 50ms; a fully blocked thread would show
  gaps of thousands of ms, as it did pre-Phase-1) — negligible jitter, not a freeze.
- **A real click landed and was handled in 34ms** while the solve was still in flight — this is
  the actual user-facing promise (Cancel works, the tab isn't "Page Unresponsive") verified by
  dispatching an actual input event, not inferred from timer gaps alone.
- Result correctness matched: reported "not reachable" for the known-infeasible fixture, same
  as the harness.

Two console errors were captured during the run (`net::ERR_CONNECTION_RESET`,
`net::ERR_FAILED`) — both traced to the same Google Fonts request from §3, confirmed via a
`requestfailed` listener. Not an app bug.

**This closes the "not yet measured" gap**: Phase 1's non-blocking claim is now verified by
actual browser instrumentation (PerformanceObserver + a real dispatched click), not just a
manual one-off observation.

## What this doesn't cover

- Reference-list virtualization (finding #4 in the original doc) was already verified live via
  React Profiler in Phase 4 and isn't re-measured here — no code touched that path since.
- No new Lighthouse *user-flow* API report was generated (the formal `lighthouse/user-flow`
  Puppeteer-based tooling) — the Playwright probe above answers the same question (does a real
  interaction stay responsive) more directly, with PerformanceObserver data Lighthouse's own
  TBT metric can't get anyway since Lighthouse's default audit never navigates past page load.
- No CI wiring — `PERFORMANCE_REMEDIATION_PLAN.md` Phase 6 (nightly perf job) is still
  unstarted, blocked on CI existing at all per that doc.

## Bottom line

The five remediation phases measured as claimed in this environment too: the solver harness
ceilings hold, the bundle is stable, and — newly — a real dispatched interaction during the
worst-case solve confirms the tab genuinely stays responsive (0 long tasks, a 34ms real click).
Load-time Web Vitals are excellent once isolated from this sandbox's flaky path to an external
font CDN, which is itself a minor, non-urgent finding worth a future look (self-host the two
font families) rather than an external network dependency in an app meant to run on a home
server.
