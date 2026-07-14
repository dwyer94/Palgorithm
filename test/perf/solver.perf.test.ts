/**
 * Solver performance harness (production-readiness — responsiveness).
 *
 * The solver runs **synchronously on the main thread** (see `SingleTargetView`/`HubView`,
 * which only wrap it in `setTimeout` to paint a spinner — the compute itself still blocks the
 * tab). So a solve's wall-clock time is, to first order, how long the UI freezes. This harness
 * measures that against the **real bundled 1.0 dataset** (291 species) at a few representative
 * points: a typical solve, a deep-but-feasible solve, an INFEASIBLE solve (the pathological
 * case — the solver exhausts the whole graph to prove no path), and the multi-target hub sweep.
 *
 * OPT-IN: gated behind `PERF=1` so it never slows the normal `npm test` run (the full pass is
 * ~30s today, dominated by the two known-slow paths). Run it explicitly:
 *
 *   PERF=1 npx vitest run test/perf/solver.perf.test.ts --reporter=verbose
 *
 * Each workload runs ONCE — these are wall-clock freezes, not micro-ops needing statistics.
 * The `CEIL_*_MS` constants are **regression ceilings** (a tripwire against getting *worse*),
 * NOT UX targets — today's numbers are themselves the problem, tracked in
 * docs/PERFORMANCE_FINDINGS.md. Tighten them as the underlying paths get fixed.
 */
import { describe, it, expect } from 'vitest';
import rawDataset from '../../src/data/dataset.1.0.json';
import { parseDataset } from '../../src/data/loader';
import { createRuleset } from '../../src/ruleset';
import { planSpecies } from '../../src/solver/speciesPlanner';
import { findHubs, planUnion } from '../../src/solver/hubFinder';
import type { RosterEntry, SpeciesId } from '../../src/solver/types';

// Regression ceilings (ms) — above these = a regression to investigate. NOT UX targets.
const CEIL_TYPICAL_MS = 500; //   typical single solve; should feel near-instant, guards drift
const CEIL_FEASIBLE_DEEP_MS = 8000; //  deep feasible solve on a modest roster
const CEIL_INFEASIBLE_MS = 20000; // KNOWN-BAD ~10s: exhaustive infeasibility proof
const CEIL_UNION_MS = 1500;
const CEIL_HUB_SWEEP_MS = 30000; //     KNOWN-BAD ~19s: full solve per candidate species

const suite = process.env.PERF === '1' ? describe : describe.skip;

const dataset = parseDataset(rawDataset);
const ruleset = createRuleset(dataset);
const breedable = dataset.species.filter((s) => s.standardBreedable && s.rank != null);
const byRank = [...breedable].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
const pick = (f: number): SpeciesId => byRank[Math.floor(f * (byRank.length - 1))]!.id;
const rarest = pick(0.02); // low rank = rare = hardest to breed
const common = pick(0.95);

/** N highest-rank (commonest / cheapest) breedable species, both genders — realistic fodder. */
const rosterOfCommonest = (n: number): RosterEntry[] =>
  [...byRank].reverse().slice(0, n).flatMap((s) => [
    { species: s.id, gender: 'male' as const },
    { species: s.id, gender: 'female' as const },
  ]);
const small = rosterOfCommonest(10);
const medium = rosterOfCommonest(40);
const large = rosterOfCommonest(130);

// Warm the JIT once. The very first solve in a fresh process (or a fresh page load) pays a
// ~2s one-time warmup on top of its own cost — a real cold-start cost worth knowing about, but
// not what the steady-state per-workload tripwires below should measure. See PERFORMANCE_FINDINGS.
planSpecies(ruleset, medium, common, { allowCatching: false });

interface Row { workload: string; ms: number; result: string }
const rows: Row[] = [];
function time(workload: string, fn: () => string): number {
  const t = performance.now();
  const result = fn();
  const ms = Math.round(performance.now() - t);
  rows.push({ workload, ms, result });
  return ms;
}

suite('solver performance (real 1.0 dataset, 291 species; main-thread freeze times)', () => {
  it('typical single-target (common target, medium roster) is near-instant', () => {
    const ms = time('single · typical (common target)', () => {
      const r = planSpecies(ruleset, medium, common, { allowCatching: false });
      return `feasible=${r.feasible} combos=${r.combinationCount}`;
    });
    expect(ms).toBeLessThan(CEIL_TYPICAL_MS);
  }, 30000);

  it('deep feasible single-target (rarest target, medium roster)', () => {
    const ms = time('single · deep-feasible (rarest target)', () => {
      const r = planSpecies(ruleset, medium, rarest, { allowCatching: false });
      return `feasible=${r.feasible} combos=${r.combinationCount}`;
    });
    expect(ms).toBeLessThan(CEIL_FEASIBLE_DEEP_MS);
  }, 30000);

  it('INFEASIBLE single-target (rarest target, small roster) — exhaustive proof, known-slow', () => {
    const ms = time('single · INFEASIBLE (small roster)', () => {
      const r = planSpecies(ruleset, small, rarest, { allowCatching: false });
      return `feasible=${r.feasible}`;
    });
    expect(ms).toBeLessThan(CEIL_INFEASIBLE_MS);
  }, 30000);

  it('multi-target union plan (3 targets, large roster)', () => {
    const targets = [pick(0.02), pick(0.35), pick(0.75)];
    const ms = time('union · 3 targets', () => {
      const r = planUnion(ruleset, large, targets, { allowCatching: false });
      return `feasible=${r.feasible} combos=${r.combinationCount}`;
    });
    expect(ms).toBeLessThan(CEIL_UNION_MS);
  }, 30000);

  it('hub-finder sweep (3 targets, large roster) — known-slow, ~full solve per candidate', () => {
    const targets = [pick(0.02), pick(0.35), pick(0.75)];
    const ms = time('hub sweep · 3 targets', () => {
      findHubs(ruleset, large, { targets, allowCatching: false, maxHubs: 5 });
      return 'ok';
    });
    expect(ms).toBeLessThan(CEIL_HUB_SWEEP_MS);
  }, 40000);

  it('prints the timing table', () => {
    console.table(rows);
    expect(rows.length).toBeGreaterThan(0);
  });
});
