import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { planSpecies } from '../../src/solver/speciesPlanner';
import { findCarrierAlternatives } from '../../src/solver/passivePlanner';
import type { RosterEntry } from '../../src/solver/types';

/**
 * Session 0.4b — passivePlanner's "guaranteed carrier" overlay (spec §7.3's "flag any branch
 * where perks are carried more than one step" requirement, previously unimplemented — see the
 * Dupin/Eikthyrdeer diagnosis this module addresses). Shaped after that real case: a carrier
 * species (EIK) that can never be a *direct* final parent of the target, but reachable via a
 * forced 2-generation self-cross chain (EIK×EIK -> MID, MID×MID -> TARGET) if you're willing
 * to spend more combinations than the cheapest plan (FODDER+FODDER2 -> TARGET, 1 combo, no
 * relation to EIK at all). Deliberately self-crosses rather than needing a separate fodder
 * species — `findCarrierAlternatives` force-disables catching for soundness (see
 * passivePlanner.ts's comment on why), so a forced chain can only use species the carrier's
 * own roster entries can reach on their own; FODDER/FODDER2 being roster-owned but excluded
 * from the narrowed carrier-only solve is exactly what exercises that fix (without it, the
 * narrowed solve would silently catch FODDER/FODDER2 instead of ever using EIK).
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
  } as Dataset;
}

describe('passivePlanner: findCarrierAlternatives (spec §7.3\'s "certainty risk" flag)', () => {
  const dataset = synthetic(
    [
      { id: 'EIK', rank: 1, wildCatchable: false },
      { id: 'MID', rank: 4, wildCatchable: false },
      { id: 'FODDER', rank: 5 },
      { id: 'FODDER2', rank: 6 },
      { id: 'TARGET', rank: 7, wildCatchable: false },
      { id: 'LONELY', rank: 8, wildCatchable: false }, // owns a passive but has no path anywhere
    ],
    [
      { parents: ['EIK', 'EIK'], child: 'MID', genderRule: null },
      { parents: ['MID', 'MID'], child: 'TARGET', genderRule: null },
      { parents: ['FODDER', 'FODDER2'], child: 'TARGET', genderRule: null },
    ],
  );
  const ruleset = createCombiRank06(dataset);

  const roster: RosterEntry[] = [
    { species: 'EIK', gender: 'male', passives: ['Artisan'] },
    { species: 'EIK', gender: 'female', passives: ['Artisan'] },
    { species: 'FODDER', gender: 'male' },
    { species: 'FODDER', gender: 'female' },
    { species: 'FODDER2', gender: 'male' },
    { species: 'FODDER2', gender: 'female' },
    { species: 'LONELY', gender: 'male', passives: ['Ghost2'] },
  ];

  it('baseline picks the cheap FODDER+FODDER2 route and reports Artisan as unassigned', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { allowCatching: true, desiredPassives: ['Artisan'] });
    expect(baseline.combinationCount).toBe(1);
    expect(baseline.passivePlan?.unassigned).toEqual(['Artisan']);
  });

  it('finds a forced 2-generation EIK self-cross route as an alternate, with the honest combination delta', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { allowCatching: true, desiredPassives: ['Artisan'] });
    const alternatives = findCarrierAlternatives(ruleset, roster, 'TARGET', baseline, { allowCatching: true });

    expect(alternatives).toHaveLength(1);
    const alt = alternatives[0]!;
    expect(alt.passive).toBe('Artisan');
    expect(alt.sourceIndividual.species).toBe('EIK');
    expect(alt.plan.feasible).toBe(true);
    expect(alt.plan.combinationCount).toBe(2); // EIK×EIK->MID, MID×MID->TARGET
    expect(alt.combinationDelta).toBe(1); // 2 - baseline's 1

    // Parity: compounded odds is exactly two chained landOdds() calls on the ruleset's own
    // function (CLAUDE.md invariant #3) — the planner isn't inventing its own math. Both
    // generations are self-crosses, so both parents carry 'Artisan' at every step.
    const perGen = ruleset.passiveModel.landOdds(['Artisan'], ['Artisan'], ['Artisan']).supersetContaining;
    expect(alt.compoundedOdds).toBeCloseTo(perGen * perGen, 10);
    expect(alt.compoundedOdds).toBeGreaterThan(0);
  });

  it('skips a desired passive nobody in the roster owns, without affecting the ones that do', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { allowCatching: true, desiredPassives: ['Artisan', 'Ghost'] });
    expect(baseline.passivePlan?.unassigned).toEqual(['Artisan', 'Ghost']);

    const alternatives = findCarrierAlternatives(ruleset, roster, 'TARGET', baseline, { allowCatching: true });
    expect(alternatives.map((a) => a.passive)).toEqual(['Artisan']);
  });

  it('omits a passive whose owner has no path anywhere, even forced (a roster owner alone is not enough)', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { allowCatching: true, desiredPassives: ['Artisan', 'Ghost2'] });
    expect(baseline.passivePlan?.unassigned).toEqual(['Artisan', 'Ghost2']);

    // LONELY owns 'Ghost2' but has no reverse()/forward() edge to anything — forcing it can't
    // manufacture a route that doesn't exist.
    const alternatives = findCarrierAlternatives(ruleset, roster, 'TARGET', baseline, { allowCatching: true });
    expect(alternatives.map((a) => a.passive)).toEqual(['Artisan']);
  });
});
