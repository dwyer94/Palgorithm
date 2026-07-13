import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDataset } from '../../src/data/loader';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';

const dataset = parseDataset(JSON.parse(readFileSync('src/data/dataset.0.6.json', 'utf8')));
const ruleset = createCombiRank06(dataset);

/** Build a minimal synthetic dataset so formula/tie-break behavior is asserted against
 * hand-computed expectations, independent of the real data. */
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

describe('combirank-0.6 formula + tie-break', () => {
  it('childRank = floor((rankA + rankB + 1) / 2) and closest eligible wins', () => {
    // ranks: A=10, B=20 → childRank = floor(31/2)=15. Closest of {10,16,25} is 16 → C.
    const rs = createCombiRank06(
      synthetic([
        { id: 'A', rank: 10 },
        { id: 'B', rank: 20 },
        { id: 'C', rank: 16 },
        { id: 'D', rank: 25 },
      ]),
    );
    expect(rs.forward('A', 'B').outcomes).toEqual([{ child: 'C', p: 1 }]);
  });

  it('breaks equidistant-rank ties by lowest game-file index (across both flanking ranks)', () => {
    // childRank=15; two eligible equidistant at 13 and 17. The lower index wins regardless
    // of which side of the midpoint it sits on (PalCalc: ThenBy InternalIndex).
    const rs = createCombiRank06(
      synthetic([
        { id: 'A', rank: 10 },
        { id: 'B', rank: 20 },
        { id: 'RANK_13', rank: 13, index: 99 },
        { id: 'RANK_17', rank: 17, index: 5 },
      ]),
    );
    expect(rs.forward('A', 'B').outcomes).toEqual([{ child: 'RANK_17', p: 1 }]);
  });

  it('breaks same-rank ties by lower index', () => {
    const rs = createCombiRank06(
      synthetic([
        { id: 'A', rank: 10 },
        { id: 'B', rank: 20 },
        { id: 'TWIN_HI', rank: 15, index: 40 },
        { id: 'TWIN_LO', rank: 15, index: 3 },
      ]),
    );
    expect(rs.forward('A', 'B').outcomes).toEqual([{ child: 'TWIN_LO', p: 1 }]);
  });

  it('does NOT prune when both parents rank higher (less rare) than the target (spec §7.1)', () => {
    // Both parents rank 12; childRank = floor(25/2) = 12. The only eligible child is TARGET
    // at rank 10 — rarer than both parents — yet it is the closest, so the pair produces it.
    // The naïve "both parents rank > target → prune" rule would wrongly drop this path.
    const rs = createCombiRank06(
      synthetic([
        { id: 'TARGET', rank: 10, index: 0 },
        { id: 'PARENT_A', rank: 12, index: 1, standardBreedable: false }, // parent-only, not a child
        { id: 'PARENT_B', rank: 12, index: 2, standardBreedable: false },
      ]),
    );
    expect(rs.forward('PARENT_A', 'PARENT_B').outcomes).toEqual([{ child: 'TARGET', p: 1 }]);
  });

  it('excludes non-standard-breedable species as children', () => {
    const rs = createCombiRank06(
      synthetic([
        { id: 'A', rank: 10 },
        { id: 'B', rank: 20 },
        { id: 'CATCH_ONLY', rank: 15, index: 0, standardBreedable: false },
        { id: 'BREEDABLE', rank: 16, index: 1 },
      ]),
    );
    expect(rs.forward('A', 'B').outcomes).toEqual([{ child: 'BREEDABLE', p: 1 }]);
  });
});

describe('combirank-0.6 special combos (real data)', () => {
  const plainSpecial = dataset.specialCombos.find((c) => !c.genderRule)!;

  it('overrides the formula with a deterministic child', () => {
    const edge = ruleset.forward(plainSpecial.parents[0], plainSpecial.parents[1]);
    expect(edge.outcomes).toEqual([{ child: plainSpecial.child, p: 1 }]);
  });

  it('is order-independent', () => {
    const ab = ruleset.forward(plainSpecial.parents[0], plainSpecial.parents[1]).outcomes;
    const ba = ruleset.forward(plainSpecial.parents[1], plainSpecial.parents[0]).outcomes;
    expect(ba).toEqual(ab);
  });
});

describe('combirank-0.6 gender-dependent special combos', () => {
  const gendered = dataset.specialCombos.filter((c) => c.genderRule);
  const pair = gendered[0]!.parents; // the 0.6 dataset has gender-dependent combos (asserted below)

  it('has gender-dependent combos in the 0.6 dataset', () => {
    expect(gendered.length).toBeGreaterThan(0);
  });

  it('returns a multi-outcome distribution summing to 1 when genders are omitted', () => {
    const [a, b] = pair;
    const edge = ruleset.forward(a, b);
    expect(edge.outcomes.length).toBeGreaterThanOrEqual(2);
    const total = edge.outcomes.reduce((s, o) => s + o.p, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('collapses to the branch child when the rule’s female parent is female', () => {
    for (const g of gendered) {
      const [a, b] = g.parents;
      const female = g.genderRule!.femaleParent;
      const opts =
        female === a ? { genderA: 'female' as const, genderB: 'male' as const } : { genderA: 'male' as const, genderB: 'female' as const };
      const edge = ruleset.forward(a, b, opts);
      expect(edge.outcomes, `${a}×${b}, ${female} female`).toEqual([{ child: g.genderRule!.child, p: 1 }]);
    }
  });

  it('yields no outcome for a same-gender (infertile) pairing', () => {
    const [a, b] = pair;
    expect(ruleset.forward(a, b, { genderA: 'male', genderB: 'male' }).outcomes).toEqual([]);
  });
});

describe('combirank-0.6 reverse()', () => {
  it('is consistent with forward(): every returned pair can produce the target', () => {
    const target = dataset.specialCombos.find((c) => !c.genderRule)!.child;
    const parents = ruleset.reverse(target);
    expect(parents.length).toBeGreaterThan(0);
    for (const { parentA, parentB } of parents) {
      expect(ruleset.forward(parentA, parentB).outcomes.some((o) => o.child === target)).toBe(true);
    }
  });

  it('is complete: a known special pair appears in reverse(child)', () => {
    const combo = dataset.specialCombos.find((c) => !c.genderRule)!;
    const parents = ruleset.reverse(combo.child);
    const found = parents.some(
      (p) =>
        (p.parentA === combo.parents[0] && p.parentB === combo.parents[1]) ||
        (p.parentA === combo.parents[1] && p.parentB === combo.parents[0]),
    );
    expect(found).toBe(true);
  });
});

describe('combirank-0.6 reachability + passiveModel', () => {
  it('exposes the three-way reachability sets from data', () => {
    expect(ruleset.reachability.standardBreedable.size).toBeGreaterThan(100);
    expect(ruleset.reachability.wildCatchable.size).toBeGreaterThan(0);
  });

  it('propagates the provisional passiveModel flag untouched', () => {
    expect(ruleset.passiveModel.verified).toBe(dataset.passiveModel.verified);
    expect(ruleset.passiveModel.verified).toBe(false);
  });

  it('landOdds: exactSet never exceeds supersetContaining, both in [0,1]', () => {
    const odds = ruleset.passiveModel.landOdds(['Swift', 'Runner'], ['Swift', 'Nimble'], ['Swift', 'Runner']);
    expect(odds.supersetContaining).toBeGreaterThanOrEqual(odds.exactSet);
    expect(odds.exactSet).toBeGreaterThanOrEqual(0);
    expect(odds.supersetContaining).toBeLessThanOrEqual(1);
  });

  it('landOdds: an empty desired set is trivially contained (superset = 1)', () => {
    const odds = ruleset.passiveModel.landOdds(['Swift'], ['Runner'], []);
    expect(odds.supersetContaining).toBeCloseTo(1, 10);
  });

  it('landOdds: tighter parents (exactly the desired passives) beat noisy parents', () => {
    const tight = ruleset.passiveModel.landOdds(['Swift', 'Runner'], ['Swift', 'Runner'], ['Swift', 'Runner']);
    const noisy = ruleset.passiveModel.landOdds(
      ['Swift', 'Runner', 'Ferocious', 'Legend'],
      ['Swift', 'Runner', 'Brave', 'Hooligan'],
      ['Swift', 'Runner'],
    );
    expect(tight.supersetContaining).toBeGreaterThan(noisy.supersetContaining);
  });
});
