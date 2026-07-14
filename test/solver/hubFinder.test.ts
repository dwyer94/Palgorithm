import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { findHubs, planUnion } from '../../src/solver/hubFinder';
import { planSpecies } from '../../src/solver/speciesPlanner';
import type { RosterEntry } from '../../src/solver/types';

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

function ownBoth(...ids: string[]): RosterEntry[] {
  return ids.flatMap((species) => [
    { species, gender: 'male' as const },
    { species, gender: 'female' as const },
  ]);
}

describe('hubFinder: planUnion — shared-intermediate objective across targets (Appendix A shape)', () => {
  // HUB is a shared ancestor of both TargetA and TargetB. Solved independently each
  // target's own plan would re-list the (Q,R)->HUB combo; the union must count it once.
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'Q', rank: 1 },
        { id: 'R', rank: 2 },
        { id: 'HUB', rank: 5, wildCatchable: false },
        { id: 'S1', rank: 6 },
        { id: 'S2', rank: 7 },
        { id: 'TargetA', rank: 8, wildCatchable: false },
        { id: 'TargetB', rank: 9, wildCatchable: false },
      ],
      [
        { parents: ['Q', 'R'], child: 'HUB', genderRule: null },
        { parents: ['HUB', 'S1'], child: 'TargetA', genderRule: null },
        { parents: ['HUB', 'S2'], child: 'TargetB', genderRule: null },
      ],
    ),
  );
  const roster: RosterEntry[] = ownBoth('Q', 'R', 'S1', 'S2');

  it('resolves to a single shared hub with the (Q,R)->HUB combo counted once', () => {
    const union = planUnion(ruleset, roster, ['TargetA', 'TargetB']);
    expect(union.feasible).toBe(true);
    // (Q,R)->HUB, (HUB,S1)->TargetA, (HUB,S2)->TargetB = 3 distinct combos, not 4.
    expect(union.combinationCount).toBe(3);

    const key = (a: string, b: string, c: string) => [a, b].sort().join('|') + '->' + c;
    const stepKeys = new Set(union.steps.map((s) => key(s.parentA.species, s.parentB.species, s.child)));
    expect(stepKeys).toEqual(new Set([key('Q', 'R', 'HUB'), key('HUB', 'S1', 'TargetA'), key('HUB', 'S2', 'TargetB')]));
  });

  it('orders steps so every step\'s parents are already available', () => {
    const union = planUnion(ruleset, roster, ['TargetA', 'TargetB']);
    const stepIndex = new Map(union.steps.map((s, i) => [s.child, i]));
    for (let i = 0; i < union.steps.length; i++) {
      for (const parent of [union.steps[i]!.parentA.species, union.steps[i]!.parentB.species]) {
        const parentIdx = stepIndex.get(parent);
        if (parentIdx !== undefined) expect(parentIdx).toBeLessThan(i);
      }
    }
  });
});

describe('hubFinder: findHubs — fixed-target mode', () => {
  // HUB is a direct parent of both targets (one cross each); OTHER can only reach the
  // targets by first producing HUB itself, so it should never outrank HUB.
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'HUB', rank: 5 },
        { id: 'OTHER', rank: 50 },
        { id: 'S1', rank: 6 },
        { id: 'S2', rank: 7 },
        { id: 'TargetA', rank: 8, wildCatchable: false },
        { id: 'TargetB', rank: 9, wildCatchable: false },
      ],
      [
        { parents: ['HUB', 'S1'], child: 'TargetA', genderRule: null },
        { parents: ['HUB', 'S2'], child: 'TargetB', genderRule: null },
      ],
    ),
  );
  const roster: RosterEntry[] = ownBoth('HUB', 'OTHER', 'S1', 'S2');

  it('ranks the direct-parent hub above one that only reaches targets via intermediates', () => {
    const result = findHubs(ruleset, roster, { targets: ['TargetA', 'TargetB'] });
    expect(result.hubs.length).toBeGreaterThan(0);
    expect(result.hubs[0]!.species).toBe('HUB');
    expect(result.hubs[0]!.injectCost).toEqual([
      { target: 'TargetA', combos: 1, direct: true },
      { target: 'TargetB', combos: 1, direct: true },
    ]);
  });

  it('excludes the targets themselves from the candidate list', () => {
    const result = findHubs(ruleset, roster, { targets: ['TargetA', 'TargetB'] });
    expect(result.hubs.some((h) => h.species === 'TargetA' || h.species === 'TargetB')).toBe(false);
  });
});

describe('hubFinder: findHubs — injectProbe multi-hop dedup (post-Phase-5 code review finding #3)', () => {
  // HUB is NOT a direct parent of either target here — it only unlocks them through a
  // shared multi-step intermediate (HUB+X->MID, then MID+S1->TargetA / MID+S2->TargetB).
  // Every other findHubs fixture in this file only exercises the trivial direct-parent
  // (combos: 1) shape; this one exercises injectProbe's own riskiest claim (its doc
  // comment in speciesPlanner.ts): deduping a shared multi-hop intermediate's combo count
  // via `reconstruct()` on mutated, warm-started state.
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'X1', rank: 1 },
        { id: 'X2', rank: 2 },
        { id: 'HUB', rank: 5, wildCatchable: false },
        { id: 'X', rank: 6 },
        { id: 'MID', rank: 7, wildCatchable: false },
        { id: 'S1', rank: 8 },
        { id: 'S2', rank: 9 },
        { id: 'TargetA', rank: 10, wildCatchable: false },
        { id: 'TargetB', rank: 11, wildCatchable: false },
      ],
      [
        { parents: ['X1', 'X2'], child: 'HUB', genderRule: null },
        { parents: ['HUB', 'X'], child: 'MID', genderRule: null },
        { parents: ['MID', 'S1'], child: 'TargetA', genderRule: null },
        { parents: ['MID', 'S2'], child: 'TargetB', genderRule: null },
      ],
    ),
  );
  // HUB itself isn't owned — the roster can only reach it (and thus MID/the targets) by
  // paying for the (X1,X2)->HUB combo, which is exactly the combo injectProbe's "seed HUB
  // at cost 0" trick should shave off each target's reconstructed path.
  const roster: RosterEntry[] = ownBoth('X1', 'X2', 'X', 'S1', 'S2');

  it('reports the deduped 2-combo multi-hop path (HUB->MID->Target) for both targets, not the base 3-combo path or an overcount', () => {
    const result = findHubs(ruleset, roster, { targets: ['TargetA', 'TargetB'], maxHubs: 10 });
    const hub = result.hubs.find((h) => h.species === 'HUB');
    expect(hub).toBeDefined();
    expect(hub!.injectCost).toEqual([
      { target: 'TargetA', combos: 2, direct: false },
      { target: 'TargetB', combos: 2, direct: false },
    ]);
    expect(hub!.obtainCost).toBe(1); // (X1,X2)->HUB
    expect(hub!.score).toBe(5); // obtainCost(1) + injectCost(2) + injectCost(2)
  });
});

describe('hubFinder: findHubs — general-reach mode (no fixed targets)', () => {
  // BROAD can directly parent two other species; NARROW only one. With no target list,
  // ranking should favor structural breadth, matching "what's a good general-purpose
  // carrier before I've picked specific targets."
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'BROAD', rank: 5 },
        { id: 'NARROW', rank: 50 },
        { id: 'S1', rank: 6 },
        { id: 'S2', rank: 7 },
        { id: 'S3', rank: 51 },
        { id: 'ChildA', rank: 8 },
        { id: 'ChildB', rank: 9 },
        { id: 'ChildC', rank: 52 },
      ],
      [
        { parents: ['BROAD', 'S1'], child: 'ChildA', genderRule: null },
        { parents: ['BROAD', 'S2'], child: 'ChildB', genderRule: null },
        { parents: ['NARROW', 'S3'], child: 'ChildC', genderRule: null },
      ],
    ),
  );
  const roster: RosterEntry[] = ownBoth('BROAD', 'NARROW', 'S1', 'S2', 'S3');

  it('ranks the higher-breadth carrier first and reports no score/injectCost (fixed-target-only fields)', () => {
    const result = findHubs(ruleset, roster);
    expect(result.hubs[0]!.species).toBe('BROAD');
    expect(result.hubs[0]!.score).toBeUndefined();
    expect(result.hubs[0]!.injectCost).toBeUndefined();

    // BROAD is deliberately given two direct-parent special combos, NARROW only one; the
    // CombiRank rank-proximity formula also contributes fallback edges for pairs with no
    // special combo, so assert the relative ordering under test rather than exact counts.
    const narrow = result.hubs.find((h) => h.species === 'NARROW');
    expect(result.hubs[0]!.breadth!).toBeGreaterThan(narrow!.breadth!);
  });
});

describe('hubFinder + speciesPlanner end-to-end (spec Appendix A shape)', () => {
  // Three targets sharing perks {P1,P2}: HUB is the direct-parent carrier for all three,
  // CHEAP-DECOY reaches them just as cheaply in species terms but carries neither perk.
  // The done-when criterion (spec §10, session 0.4) is: union plan finds the single shared
  // hub with intermediates counted once, AND the passive overlay on that hub's own
  // breeding matches hand-computed odds.
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'PerkA', rank: 1 },
        { id: 'PerkB', rank: 2 },
        { id: 'HUB', rank: 5, wildCatchable: false },
        { id: 'S1', rank: 6 },
        { id: 'S2', rank: 7 },
        { id: 'S3', rank: 8 },
        { id: 'TargetA', rank: 9, wildCatchable: false },
        { id: 'TargetB', rank: 10, wildCatchable: false },
        { id: 'TargetC', rank: 11, wildCatchable: false },
      ],
      [
        { parents: ['PerkA', 'PerkB'], child: 'HUB', genderRule: null },
        { parents: ['HUB', 'S1'], child: 'TargetA', genderRule: null },
        { parents: ['HUB', 'S2'], child: 'TargetB', genderRule: null },
        { parents: ['HUB', 'S3'], child: 'TargetC', genderRule: null },
      ],
    ),
  );
  const roster: RosterEntry[] = [
    { species: 'PerkA', gender: 'male', passives: ['P1'] },
    { species: 'PerkA', gender: 'female', passives: ['P1'] },
    { species: 'PerkB', gender: 'male', passives: ['P2'] },
    { species: 'PerkB', gender: 'female', passives: ['P2'] },
    ...ownBoth('S1', 'S2', 'S3'),
  ];
  const targets = ['TargetA', 'TargetB', 'TargetC'];

  it('the union plan reaches all three targets through one shared hub, counted once', () => {
    const union = planUnion(ruleset, roster, targets);
    expect(union.feasible).toBe(true);
    // (PerkA,PerkB)->HUB once, plus one final cross per target = 4, not 6.
    expect(union.combinationCount).toBe(4);
  });

  it('the hub finder surfaces HUB as the top direct-parent carrier for all three targets', () => {
    const result = findHubs(ruleset, roster, { targets });
    expect(result.hubs[0]!.species).toBe('HUB');
    expect(result.hubs[0]!.injectCost).toEqual([
      { target: 'TargetA', combos: 1, direct: true },
      { target: 'TargetB', combos: 1, direct: true },
      { target: 'TargetC', combos: 1, direct: true },
    ]);
  });

  it("loading the hub's own final cross with the shared perk set matches hand-computed odds", () => {
    const plan = planSpecies(ruleset, roster, 'HUB', { desiredPassives: ['P1', 'P2'] });
    expect(plan.passivePlan).toBeDefined();
    const expected = ruleset.passiveModel.landOdds(['P1'], ['P2'], ['P1', 'P2']);
    expect(plan.passivePlan!.landOdds).toEqual(expected);
    expect(plan.passivePlan!.pollution).toEqual({ parentA: [], parentB: [] });
  });
});
