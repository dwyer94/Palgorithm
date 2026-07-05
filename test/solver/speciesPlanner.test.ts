import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { planSpecies } from '../../src/solver/speciesPlanner';
import type { RosterEntry } from '../../src/solver/types';

/** Same synthetic-dataset builder pattern as the ruleset unit tests: hand-computed
 * expectations, independent of the real (bundled) dataset. Solver tests lean on
 * `specialCombos` to pin exact parent->child outcomes, isolating solver-graph logic from
 * CombiRank formula/tie-break behavior (already covered in test/ruleset). */
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
  } as Dataset;
}

/** Both genders owned, for fixtures where gender feasibility isn't the thing under test. */
function ownBoth(...ids: string[]): RosterEntry[] {
  return ids.flatMap((species) => [
    { species, gender: 'male' as const },
    { species, gender: 'female' as const },
  ]);
}

describe('speciesPlanner: owned-at-cost-0', () => {
  it('a target already on the roster costs nothing and needs no steps', () => {
    const ruleset = createCombiRank06(synthetic([{ id: 'X', rank: 50 }]));
    const plan = planSpecies(ruleset, [{ species: 'X', gender: 'male' }], 'X');
    expect(plan.feasible).toBe(true);
    expect(plan.combinationCount).toBe(0);
    expect(plan.steps).toEqual([]);
    expect(plan.cost).toBe(0);
  });
});

describe('speciesPlanner: unreachable targets', () => {
  it('a not-owned otherObtainOnly species (never a breeding output) is infeasible', () => {
    const ruleset = createCombiRank06(
      synthetic([
        { id: 'Y', rank: 50, standardBreedable: false, wildCatchable: false, otherObtainOnly: true },
      ]),
    );
    const plan = planSpecies(ruleset, [], 'Y');
    expect(plan.feasible).toBe(false);
    expect(plan.combinationCount).toBe(Infinity);
    expect(plan.cost).toBe(Infinity);
    expect(plan.steps).toEqual([]);
    // Never a valid combo output at all, so no hypothetical anchor can unlock it either.
    expect(plan.anchorHints).toEqual([]);
  });
});

describe('speciesPlanner: rare-anchor-needed', () => {
  // Common/Filler are always available and self-absorb the computed child rank; TARGET
  // is only reachable via a rare Anchor that isn't currently owned or catchable. This
  // exercises spec §7.1's "need an anchor of rank ≤ X" guidance rather than a silent
  // failure — and rules out the naive "both parents rank > target" prune, since Common
  // and Filler both being far rarer-numbered than TARGET still correctly fails to reach it
  // (no eligible species sits near their combos' computed rank).
  const dataset = synthetic([
    { id: 'Common', rank: 300 },
    { id: 'Filler', rank: 100 },
    { id: 'Anchor', rank: 5, wildCatchable: false }, // not currently obtainable
    { id: 'TARGET', rank: 10, wildCatchable: false }, // only reachable by breeding
  ]);
  const ruleset = createCombiRank06(dataset);
  const roster: RosterEntry[] = ownBoth('Common', 'Filler');

  it('is infeasible from currently-available anchors', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET');
    expect(plan.feasible).toBe(false);
  });

  it('surfaces the rare anchor that would unlock it, instead of failing silently', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET');
    expect(plan.anchorHints).toBeDefined();
    expect(plan.anchorHints!.some((h) => h.species === 'Anchor')).toBe(true);
  });
});

describe('speciesPlanner: shared-intermediate counted once', () => {
  // INT feeds BOTH P1 and P2's derivation; TARGET needs P1 and P2. The additive Dijkstra
  // distance double-counts INT's production (once per branch, spec §7.1 exactness
  // caveat), but the reconstructed plan must count the (Q,R)->INT combo exactly once
  // (CLAUDE.md invariant #4).
  const ruleset = createCombiRank06(
    synthetic(
      [
        { id: 'Q', rank: 1 },
        { id: 'R', rank: 2 },
        { id: 'S1', rank: 3 },
        { id: 'S2', rank: 4 },
        { id: 'INT', rank: 5, wildCatchable: false },
        { id: 'P1', rank: 6, wildCatchable: false },
        { id: 'P2', rank: 7, wildCatchable: false },
        { id: 'TARGET', rank: 8, wildCatchable: false },
      ],
      [
        { parents: ['Q', 'R'], child: 'INT', genderRule: null },
        { parents: ['INT', 'S1'], child: 'P1', genderRule: null },
        { parents: ['INT', 'S2'], child: 'P2', genderRule: null },
        { parents: ['P1', 'P2'], child: 'TARGET', genderRule: null },
      ],
    ),
  );
  const roster: RosterEntry[] = ownBoth('Q', 'R', 'S1', 'S2');

  it('produces exactly the 4 distinct combinations, not 5', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET');
    expect(plan.feasible).toBe(true);
    expect(plan.combinationCount).toBe(4);
    expect(plan.cost).toBe(4);

    const key = (a: string, b: string, c: string) => [a, b].sort().join('|') + '->' + c;
    const stepKeys = new Set(plan.steps.map((s) => key(s.parentA.species, s.parentB.species, s.child)));
    expect(stepKeys).toEqual(new Set([key('Q', 'R', 'INT'), key('INT', 'S1', 'P1'), key('INT', 'S2', 'P2'), key('P1', 'P2', 'TARGET')]));
  });

  it('orders steps so every step\'s parents are already available', () => {
    const plan = planSpecies(ruleset, roster, 'TARGET');
    const producedBy = new Map(plan.steps.map((s) => [s.child, plan.steps.indexOf(s)]));
    for (const step of plan.steps) {
      const stepIdx = plan.steps.indexOf(step);
      for (const parent of [step.parentA.species, step.parentB.species]) {
        const parentStepIdx = producedBy.get(parent);
        if (parentStepIdx !== undefined) expect(parentStepIdx).toBeLessThan(stepIdx);
      }
    }
  });
});

describe('speciesPlanner: gender feasibility', () => {
  it('flags a dead single-gender branch as infeasible rather than emitting an impossible plan', () => {
    // Dodo is standard-breedable in principle but has a 100/0 ratio (never hatches
    // female) and is only owned as male — so it can never supply the female side of a
    // self-cross, and any combo needing it as female must fail cleanly.
    const ruleset = createCombiRank06(
      synthetic([{ id: 'Dodo', rank: 50, genderRatio: { male: 1, female: 0 } }]),
    );
    const plan = planSpecies(ruleset, [{ species: 'Dodo', gender: 'male' }], 'Dodo');
    // Owning a male Dodo already satisfies the target itself at cost 0 (no breeding
    // needed) — the dead end only bites when something downstream needs a female Dodo,
    // which this fixture's single-species graph can't exercise directly. Assert the
    // narrower, decisive fact: female Dodo is simply never reachable.
    expect(plan.feasible).toBe(true);
    expect(plan.combinationCount).toBe(0);

    // A self-cross needs BOTH genders of Dodo — with only a male owned, no wild female
    // available (ratio 0, and wildCatchable off), and no other route to a female Dodo,
    // the self-cross combo can never fire. This is exactly the "single-gender holding /
    // dead pair" failure mode (spec §7.1), and must surface as infeasible, not a plan
    // that silently assumes a female appeared.
    const ruleset2 = createCombiRank06(
      synthetic(
        [
          { id: 'Dodo', rank: 50, genderRatio: { male: 1, female: 0 }, wildCatchable: false },
          { id: 'DodoChild', rank: 60, wildCatchable: false },
        ],
        [{ parents: ['Dodo', 'Dodo'], child: 'DodoChild', genderRule: null }],
      ),
    );
    const infeasiblePlan = planSpecies(ruleset2, [{ species: 'Dodo', gender: 'male' }], 'DodoChild');
    expect(infeasiblePlan.feasible).toBe(false);
  });
});
