import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { findHubs, planUnion } from '../../src/solver/hubFinder';
import { buildRoleSuggestion } from '../../src/pipeline/suggestHubs';

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

// Q, R, S are cheap wild-catchable bootstrap stock. HUB is the shared ancestor a good
// suggestion should surface. All three targets are ALSO wildCatchable — mirroring the
// real dataset, where nearly every species (including apex/legendary ones) is flagged
// catchable — so this fixture only makes sense if buildRoleSuggestion genuinely forces a
// bred path rather than the catch shortcut winning trivially.
const ruleset = createCombiRank06(
  synthetic(
    [
      { id: 'Q', rank: 1 },
      { id: 'R', rank: 2 },
      { id: 'S', rank: 3 },
      { id: 'HUB', rank: 5, wildCatchable: false },
      { id: 'TargetA', rank: 8 },
      { id: 'TargetB', rank: 9 },
      { id: 'TargetC', rank: 10 },
    ],
    [
      { parents: ['Q', 'R'], child: 'HUB', genderRule: null },
      { parents: ['HUB', 'Q'], child: 'TargetA', genderRule: null },
      { parents: ['HUB', 'R'], child: 'TargetB', genderRule: null },
      { parents: ['HUB', 'S'], child: 'TargetC', genderRule: null },
    ],
  ),
);
const targets = ['TargetA', 'TargetB', 'TargetC'];

describe('suggestHubs: buildRoleSuggestion', () => {
  it('finds the genuinely bred shared hub even though every target is wildCatchable', () => {
    const suggestion = buildRoleSuggestion(ruleset, targets);

    expect(suggestion.targets).toEqual(targets);
    // (Q,R)->HUB shared + one direct cross per target = 4 distinct combos, not 0.
    expect(suggestion.unionCombinationCount).toBe(4);

    expect(suggestion.topHubs.length).toBeGreaterThan(0);
    const top = suggestion.topHubs[0]!;
    expect(top.species).toBe('HUB');
    expect(top.injectCost).toHaveLength(3);
    expect(top.injectCost.every((i) => i.direct)).toBe(true);
    expect(top.score).toBe(6); // obtainCost(HUB)=3 + 1+1+1 injectCost
  });

  it('contrast: without excludeFromCatching, wildCatchable targets short-circuit to 0 combos', () => {
    // Documents *why* buildRoleSuggestion passes excludeFromCatching — a regression here
    // would silently make every suggested hub meaningless again.
    const union = planUnion(ruleset, [], targets, { allowCatching: true });
    expect(union.combinationCount).toBe(0);

    const hubs = findHubs(ruleset, [], { targets, allowCatching: true });
    // Every target is trivially catchable (injectCost 0 regardless of anchor), so the
    // ranking degenerates to "cheapest species to catch" (score 1) rather than anything
    // about actually reaching the targets — unlike the excludeTargetsFromCatching case
    // above, where HUB's real structural advantage shows up in the score.
    expect(hubs.hubs[0]?.score).toBe(1);
  });
});
