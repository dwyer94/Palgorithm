import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { planSpecies } from '../../src/solver/speciesPlanner';
import type { RosterEntry } from '../../src/solver/types';

/**
 * Session 0.4a — the integrated species+passive solve (spec §7.3's final-cross-injection
 * overlay, folded into `planSpecies` via `desiredPassives`). Two real usage shapes drove
 * this design:
 *   - "I have pal A with perk X and pal B with perk Y, I want target Z with X+Y" — A and B
 *     are direct final parents; the planner should recognize their passives without any
 *     extra wiring.
 *   - "What should I use from my roster to get Z with these perks" — when more than one
 *     cost-tied final-parent pair exists, the planner should prefer whichever pair actually
 *     carries the desired passives over one that doesn't, without changing the
 *     combination count.
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

describe('speciesPlanner: passive-aware final-cross selection (spec §7.3)', () => {
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
  ];

  it('omitting desiredPassives leaves the plan exactly as 0.3 produced it (no passivePlan field)', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET');
    expect(plan.combinationCount).toBe(1);
    expect(plan.passivePlan).toBeUndefined();
  });

  it('recognizes the two direct-parent perks without any extra wiring ("A has X, B has Y, want Z with X+Y")', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(plan.combinationCount).toBe(1); // passives never change the species-cost answer
    expect(plan.passivePlan).toBeDefined();
    const pp = plan.passivePlan!;
    const parents = [pp.finalParentA, pp.finalParentB].sort((x, y) => x.species.localeCompare(y.species));
    expect(parents.map((p) => p.species)).toEqual(['A', 'B']);
    expect(parents.map((p) => p.passives)).toEqual([['P1'], ['P2']]);

    // Parity: the reported odds are exactly what a direct landOdds() call on those two
    // parents' passives would produce — the planner isn't inventing its own math (CLAUDE.md
    // invariant #3), just wiring roster passives into the ruleset's own function.
    const expected = ruleset.passiveModel.landOdds(['P1'], ['P2'], ['P1', 'P2']);
    expect(pp.landOdds).toEqual(expected);
    expect(pp.expectedEggs.exactSet).toBe(expected.exactSet > 0 ? 1 / expected.exactSet : Infinity);
    expect(pp.pollution).toEqual({ parentA: [], parentB: [] });
  });

  it('reports a desired passive absent from both final parents as unassigned, without touching pollution or landOdds', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2', 'Ghost'] });
    const pp = plan.passivePlan!;
    expect(pp.unassigned).toEqual(['Ghost']);
    expect(pp.pollution).toEqual({ parentA: [], parentB: [] });
    // landOdds still reflects whatever the ruleset computes for the full desired set — this
    // field only adds an explicit "no path" signal, it doesn't change the odds math.
    const expected = ruleset.passiveModel.landOdds(['P1'], ['P2'], ['P1', 'P2', 'Ghost']);
    expect(pp.landOdds).toEqual(expected);
  });

  it('flags pollution when a selected final parent carries a passive outside the desired set', () => {
    const pollutedRoster: RosterEntry[] = [
      { species: 'A', gender: 'male', passives: ['P1', 'Junk'] },
      { species: 'A', gender: 'female', passives: ['P1', 'Junk'] },
      { species: 'B', gender: 'male', passives: ['P2'] },
      { species: 'B', gender: 'female', passives: ['P2'] },
    ];
    const plan = planSpecies(ruleset, pollutedRoster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    const pp = plan.passivePlan!;
    const aSide = [pp.finalParentA, pp.finalParentB].find((p) => p.species === 'A')!;
    expect(pp.pollution.parentA.includes('Junk') || pp.pollution.parentB.includes('Junk')).toBe(true);
    expect(aSide.passives).toContain('Junk');
  });
});

describe('speciesPlanner: owning the target species does not short-circuit a passive-mismatched request', () => {
  // Regression for the "Already in your pools — no breeding required" false negative: owning
  // ANY individual of the target species used to report cost 0 regardless of that
  // individual's passives, even when the user explicitly asked for perks it doesn't carry.
  const dataset = synthetic(
    [
      { id: 'A', rank: 1 },
      { id: 'B', rank: 2 },
      { id: 'TARGET', rank: 10, wildCatchable: false },
      { id: 'CAPTURE_ONLY', rank: null, standardBreedable: false, wildCatchable: false, otherObtainOnly: true },
    ],
    [{ parents: ['A', 'B'], child: 'TARGET', genderRule: null }],
  );
  const ruleset = createCombiRank06(dataset);

  it('falls through to a real breeding plan when the owned individual lacks the desired perks', () => {
    const roster: RosterEntry[] = [
      { species: 'A', gender: 'male', passives: ['P1'] },
      { species: 'A', gender: 'female', passives: ['P1'] },
      { species: 'B', gender: 'male', passives: ['P2'] },
      { species: 'B', gender: 'female', passives: ['P2'] },
      { species: 'TARGET', gender: 'male', passives: ['Junk'] },
    ];
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(plan.feasible).toBe(true);
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.passivePlan).toBeDefined();
    const chosen = [plan.passivePlan!.finalParentA.species, plan.passivePlan!.finalParentB.species].sort();
    expect(chosen).toEqual(['A', 'B']); // prefers the perk-bearing pair over a TARGET self-cross
  });

  it('still reports "no breeding required" when an owned individual actually carries the desired perks', () => {
    const roster: RosterEntry[] = [{ species: 'TARGET', gender: 'male', passives: ['P1', 'P2'] }];
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(plan.feasible).toBe(true);
    expect(plan.steps.length).toBe(0);
    expect(plan.passivePlan).toBeUndefined();
  });

  it('keeps reporting "no breeding required" for an owned capture-only species with no breeding route at all', () => {
    const roster: RosterEntry[] = [{ species: 'CAPTURE_ONLY', gender: 'male', passives: ['Junk'] }];
    const plan = planSpecies(ruleset, roster, 'CAPTURE_ONLY', { desiredPassives: ['P1'] });
    expect(plan.feasible).toBe(true);
    expect(plan.steps.length).toBe(0);
  });
});

describe('speciesPlanner: passive-aware tie-break among equally-cheap final combos ("what should I use from my roster")', () => {
  // Both (A,B)->TARGET and (C,D)->TARGET cost exactly 1 combination (all four parents
  // owned at cost 0), so species-cost alone can't choose between them. Only A/B carry the
  // desired passives; C/D don't. The planner must pick A/B without inflating the
  // combination count, and must not just default to whichever edge Dijkstra found first.
  const dataset = synthetic(
    [
      { id: 'A', rank: 1 },
      { id: 'B', rank: 2 },
      { id: 'C', rank: 1 },
      { id: 'D', rank: 2 },
      { id: 'TARGET', rank: 10, wildCatchable: false },
    ],
    [
      { parents: ['A', 'B'], child: 'TARGET', genderRule: null },
      { parents: ['C', 'D'], child: 'TARGET', genderRule: null },
    ],
  );
  const ruleset = createCombiRank06(dataset);

  const roster: RosterEntry[] = [
    { species: 'A', gender: 'male', passives: ['P1'] },
    { species: 'A', gender: 'female', passives: ['P1'] },
    { species: 'B', gender: 'male', passives: ['P2'] },
    { species: 'B', gender: 'female', passives: ['P2'] },
    { species: 'C', gender: 'male', passives: ['P3'] },
    { species: 'C', gender: 'female', passives: ['P3'] },
    { species: 'D', gender: 'male' },
    { species: 'D', gender: 'female' },
  ];

  it('prefers the perk-bearing pair (A,B) over the equally-cheap perk-less pair (C,D)', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(plan.combinationCount).toBe(1);
    const pp = plan.passivePlan!;
    const chosen = [pp.finalParentA.species, pp.finalParentB.species].sort();
    expect(chosen).toEqual(['A', 'B']);
    expect(pp.landOdds.supersetContaining).toBeGreaterThan(0);
  });

  it('the chosen step in `steps` matches the passive-selected pair, not a stale Dijkstra pick', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    const finalStep = plan.steps.find((s) => s.child === 'TARGET')!;
    const stepSpecies = [finalStep.parentA.species, finalStep.parentB.species].sort();
    expect(stepSpecies).toEqual(['A', 'B']);
  });
});
