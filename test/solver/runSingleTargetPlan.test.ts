import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { runSingleTargetPlan } from '../../src/solver/runSingleTargetPlan';
import type { RosterEntry } from '../../src/solver/types';

/**
 * End-to-end coverage for the single-target transparency pass: `runSingleTargetPlan` must always
 * produce a self-explanatory `guaranteedCarrierOutcome` alongside the baseline `result` whenever
 * perks were requested — never silently absent, regardless of how the baseline reached its
 * cheapest cost (owned, caught, or bred). This is the reported-live bug's exact shape (a Sekhmet
 * owned without the desired perks, missing the opposite gender, catching disabled) plus the other
 * corner cases identified alongside it.
 */
function synthetic(species: Partial<Species>[], specialCombos: Dataset['specialCombos'] = []): Dataset {
  return {
    meta: {
      version: 't',
      ruleset: 'combirank-0.6',
      provisional: false,
      source: 'test',
      generatedAt: '2026-01-01T00:00:00Z',
    },
    species: species.map((s, i) => ({
      id: s.id!,
      displayName: s.id!,
      index: s.index ?? i,
      standardBreedable: s.standardBreedable ?? true,
      wildCatchable: s.wildCatchable ?? true,
      otherObtainOnly: s.otherObtainOnly ?? false,
      rank: s.rank ?? null,
      genderRatio: s.genderRatio ?? { male: 0.5, female: 0.5 },
      elements: [],
    })),
    specialCombos,
    passives: [],
    passiveModel: { maxSlots: 4, inheritCountDist: [0, 0.5, 0.3, 0.15, 0.05], mutationDist: [0.8, 0.2], verified: false },
    partnerSkills: [],
  } as Dataset;
}

describe('runSingleTargetPlan: always-diagnosed transparency', () => {
  it('Sekhmet-shaped bug: owned mismatched, missing the opposite gender, catching off — reports blocked, never a false success', () => {
    const dataset = synthetic([
      { id: 'SEKHMET', rank: 50, standardBreedable: true, wildCatchable: true, genderRatio: { male: 0.3, female: 0.7 } },
      // Owns a desired passive but is structurally isolated (no rank => never a breeding
      // parent), distinguishing "someone owns a desired perk but no route reaches the target"
      // from "nobody owns it at all".
      { id: 'OTHER', rank: null, standardBreedable: false, wildCatchable: false, otherObtainOnly: true },
    ]);
    const ruleset = createCombiRank06(dataset);
    const roster: RosterEntry[] = [
      { species: 'SEKHMET', gender: 'female', passives: ['Junk'] },
      { species: 'OTHER', gender: 'male', passives: ['P1'] },
    ];

    const { result, guaranteedCarrierOutcome } = runSingleTargetPlan(ruleset, roster, 'SEKHMET', ['P1'], {
      allowCatching: false,
    });

    // Baseline stays honestly at cost 0 (you DO own one) but flags the mismatch instead of a
    // bare, misleading "0 combinations" success.
    expect(result.combinationCount).toBe(0);
    expect(result.passivePlan).toBeUndefined();
    expect(result.passiveNote).toEqual({ status: 'owned-partial-match', ownedPassives: ['Junk'] });

    // The section that used to be skipped entirely now always runs, and explains itself
    // precisely: SEKHMET can be bred in principle (standardBreedable), just not from this
    // roster/settings (no male anywhere, catching disabled).
    expect(guaranteedCarrierOutcome).toEqual({ status: 'infeasible', reason: 'unreachable-with-current-roster' });
  });

  it('owned mismatched with a real fallback route available: guaranteed-carrier finds and reports it', () => {
    const dataset = synthetic(
      [
        { id: 'A', rank: 1 },
        { id: 'B', rank: 2 },
        { id: 'TARGET', rank: 10, wildCatchable: false },
      ],
      [{ parents: ['A', 'B'], child: 'TARGET', genderRule: null }],
    );
    const ruleset = createCombiRank06(dataset);
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male', passives: ['P1'] },
      { species: 'A', gender: 'female', passives: ['P1'] },
      { species: 'B', gender: 'male', passives: ['P2'] },
      { species: 'B', gender: 'female', passives: ['P2'] },
      { species: 'TARGET', gender: 'male', passives: ['Junk'] },
    ];

    const { result, guaranteedCarrierOutcome } = runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1', 'P2'], {});

    expect(result.combinationCount).toBe(0);
    expect(result.passiveNote).toEqual({ status: 'owned-partial-match', ownedPassives: ['Junk'] });

    if (guaranteedCarrierOutcome.status !== 'routed') throw new Error(`expected 'routed', got '${guaranteedCarrierOutcome.status}'`);
    expect(guaranteedCarrierOutcome.alt.fullyRouted).toBe(true);
    const chosen = new Set(guaranteedCarrierOutcome.alt.sourceIndividuals.map((s) => s.species));
    expect(chosen).toEqual(new Set(['A', 'B']));
    expect(guaranteedCarrierOutcome.alt.plan.combinationCount).toBe(1);
  });

  it('cheapest route is a direct catch: baseline flags it, no perks can land for free there', () => {
    const dataset = synthetic(
      [
        { id: 'A', rank: 1 },
        { id: 'B', rank: 2 },
        { id: 'TARGET', rank: 10, wildCatchable: true },
      ],
      [{ parents: ['A', 'B'], child: 'TARGET', genderRule: null }],
    );
    const ruleset = createCombiRank06(dataset);
    const roster: RosterEntry[] = []; // nobody owns anything — catching TARGET directly (cost 1)
    // beats catching A+B then breeding (cost 3), so the cheapest route is a bare catch.

    const { result, guaranteedCarrierOutcome } = runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1'], {
      allowCatching: true,
      catchCost: 1,
    });

    expect(result.combinationCount).toBe(0);
    expect(result.catches).toHaveLength(1);
    expect(result.passivePlan).toBeUndefined();
    expect(result.passiveNote).toEqual({ status: 'cheapest-route-is-catch' });
    expect(guaranteedCarrierOutcome).toEqual({ status: 'no-owner' });
  });

  it('no perks requested: guaranteed-carrier outcome is a no-op, baseline carries no passiveNote', () => {
    const dataset = synthetic([{ id: 'TARGET', rank: 1 }]);
    const ruleset = createCombiRank06(dataset);
    const roster: RosterEntry[] = [{ species: 'TARGET', gender: 'male' }];

    const { result, guaranteedCarrierOutcome } = runSingleTargetPlan(ruleset, roster, 'TARGET', [], {});

    expect(result.passiveNote).toBeUndefined();
    expect(guaranteedCarrierOutcome).toEqual({ status: 'not-requested' });
  });
});

describe('runSingleTargetPlan: next-best-when-owned (ownership never dead-ends the answer)', () => {
  const dataset = synthetic(
    [
      { id: 'A', rank: 1 },
      { id: 'B', rank: 2 },
      { id: 'TARGET', rank: 10, wildCatchable: false },
    ],
    [{ parents: ['A', 'B'], child: 'TARGET', genderRule: null }],
  );
  const ruleset = createCombiRank06(dataset);

  it('no perks, target owned outright: baseline is 0 combos, next-best breeds another (1 combo)', () => {
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male' },
      { species: 'A', gender: 'female' },
      { species: 'B', gender: 'male' },
      { species: 'B', gender: 'female' },
      { species: 'TARGET', gender: 'male' },
    ];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', [], {});
    expect(run.result.combinationCount).toBe(0); // you own one
    expect(run.nextBestWhenOwned).toBeDefined();
    expect(run.nextBestWhenOwned!.result.feasible).toBe(true);
    expect(run.nextBestWhenOwned!.result.combinationCount).toBe(1); // A×B → another TARGET
  });

  it('perks, owned exact match: next-best still routes the perks via carriers (not a 0-combo collapse)', () => {
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male', passives: ['P1'] },
      { species: 'A', gender: 'female', passives: ['P1'] },
      { species: 'B', gender: 'male', passives: ['P2'] },
      { species: 'B', gender: 'female', passives: ['P2'] },
      { species: 'TARGET', gender: 'male', passives: ['P1', 'P2'] },
    ];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1', 'P2'], {});
    expect(run.result.passiveNote).toEqual({ status: 'owned-exact-match' });
    const next = run.nextBestWhenOwned;
    expect(next).toBeDefined();
    expect(next!.result.combinationCount).toBe(1);
    // The next-best's own guaranteed-carrier is a REAL 1-combo route through A+B, not the
    // degenerate 0-combo "matches what you own" the full-roster search would have returned.
    if (next!.guaranteedCarrierOutcome.status !== 'routed') throw new Error('expected routed next-best carrier');
    expect(next!.guaranteedCarrierOutcome.alt.plan.combinationCount).toBe(1);
    expect(new Set(next!.guaranteedCarrierOutcome.alt.sourceIndividuals.map((s) => s.species))).toEqual(new Set(['A', 'B']));
  });

  it('owned but no other route reachable: next-best is attached and infeasible, so the UI can explain why', () => {
    // Own the only TARGET; nothing can breed another (no A/B), catching off.
    const roster: RosterEntry[] = [{ species: 'TARGET', gender: 'male' }];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', [], { allowCatching: false });
    expect(run.result.combinationCount).toBe(0);
    expect(run.nextBestWhenOwned).toBeDefined();
    expect(run.nextBestWhenOwned!.result.feasible).toBe(false);
  });

  it('target NOT owned: no next-best section (the normal plan already is the answer)', () => {
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male' },
      { species: 'A', gender: 'female' },
      { species: 'B', gender: 'male' },
      { species: 'B', gender: 'female' },
    ];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', [], {});
    expect(run.result.combinationCount).toBe(1);
    expect(run.nextBestWhenOwned).toBeUndefined();
  });

  it('does not throw on an over-long desired-perk set (picker is advisory; solver clamps)', () => {
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male', passives: ['P1'] },
      { species: 'A', gender: 'female', passives: ['P1'] },
      { species: 'B', gender: 'male', passives: ['P2'] },
      { species: 'B', gender: 'female', passives: ['P2'] },
    ];
    expect(() => runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1', 'P2', 'P3', 'P4', 'P5'], {})).not.toThrow();
  });
});

/**
 * Regression (live report, 2026-07-16): a user owned two individuals of a self-cross-capable
 * TARGET species, each carrying one of two desired passives, plus a broad roster of unrelated
 * species (some of which also happened to carry the same two passives). `nextBestWhenOwned`
 * used to solve against `roster` with every owned TARGET individual filtered out entirely — so
 * it never considered crossing the two owned TARGETs with each other, and instead built a
 * needlessly convoluted plan through the unrelated decoy carriers. Fixed by
 * `planSpeciesForAnotherCopy`/`excludeDirectOwnership`, which excludes only the trivial "you
 * already hold the finished answer" shortcut, never the roster itself.
 */
describe('runSingleTargetPlan: next-best-when-owned must not discard the target species as breeding stock', () => {
  // TARGET self-crosses into itself in 1 combo (its own cheapest source). A DECOY_A/DECOY_B
  // route also reaches TARGET, but only via an extra MID/FODDER generation (2 combos) — strictly
  // more expensive, so a correct solver must prefer the direct self-cross whenever it's actually
  // usable (opposite genders), and only fall back to the decoy route when it truly isn't
  // (same-gender TARGETs, which can never be crossed with each other).
  const dataset = synthetic(
    [
      { id: 'TARGET', rank: 1, wildCatchable: false },
      { id: 'DECOY_A', rank: 1, standardBreedable: false },
      { id: 'DECOY_B', rank: 2, standardBreedable: false },
      { id: 'MID', rank: 4, wildCatchable: false },
      { id: 'FODDER', rank: 6, standardBreedable: false },
    ],
    [
      { parents: ['TARGET', 'TARGET'], child: 'TARGET', genderRule: null },
      { parents: ['DECOY_A', 'DECOY_B'], child: 'MID', genderRule: null },
      { parents: ['MID', 'FODDER'], child: 'TARGET', genderRule: null },
    ],
  );
  const ruleset = createCombiRank06(dataset);

  it('opposite-gender owned TARGETs: crosses them directly (1 combo), not through the decoys', () => {
    const roster: RosterEntry[] = [
      { species: 'TARGET', gender: 'male', passives: ['P1'] },
      { species: 'TARGET', gender: 'female', passives: ['P2'] },
      { species: 'DECOY_A', gender: 'male', passives: ['P1'] },
      { species: 'DECOY_B', gender: 'female', passives: ['P2'] },
      { species: 'FODDER', gender: 'male' },
      { species: 'FODDER', gender: 'female' },
    ];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1', 'P2'], {});
    expect(run.result.combinationCount).toBe(0); // owns one already
    const next = run.nextBestWhenOwned;
    expect(next).toBeDefined();
    expect(next!.result.combinationCount).toBe(1);
    if (next!.guaranteedCarrierOutcome.status !== 'routed') throw new Error('expected routed');
    const alt = next!.guaranteedCarrierOutcome.alt;
    expect(alt.fullyRouted).toBe(true);
    expect(alt.plan.combinationCount).toBe(1);
    // Must use the two real TARGETs as the final cross, not the strictly-more-expensive
    // DECOY_A/DECOY_B/MID/FODDER route.
    expect(new Set(alt.sourceIndividuals.map((s) => s.species))).toEqual(new Set(['TARGET']));
    expect(new Set([alt.plan.steps[0]!.parentA.species, alt.plan.steps[0]!.parentB.species])).toEqual(new Set(['TARGET']));
  });

  it('same-gender owned TARGETs (cannot be crossed with each other): still finds the real 2-combo decoy route, not a false infeasible', () => {
    const roster: RosterEntry[] = [
      { species: 'TARGET', gender: 'male', passives: ['P1'] },
      { species: 'TARGET', gender: 'male', passives: ['P2'] },
      { species: 'DECOY_A', gender: 'male', passives: ['P1'] },
      { species: 'DECOY_B', gender: 'female', passives: ['P2'] },
      { species: 'FODDER', gender: 'male' },
      { species: 'FODDER', gender: 'female' },
    ];
    const run = runSingleTargetPlan(ruleset, roster, 'TARGET', ['P1', 'P2'], {});
    const next = run.nextBestWhenOwned!;
    expect(next.result.feasible).toBe(true);
    if (next.guaranteedCarrierOutcome.status !== 'routed') throw new Error('expected routed');
    expect(next.guaranteedCarrierOutcome.alt.fullyRouted).toBe(true);
    // Same-gender TARGETs genuinely can't be crossed with each other, so the honest cheapest
    // route here is the DECOY_A/DECOY_B/MID/FODDER chain — the important thing is it's found
    // and reported (2 combos), not silently blocked or reported as infeasible.
    expect(next.guaranteedCarrierOutcome.alt.plan.combinationCount).toBe(2);
  });
});
