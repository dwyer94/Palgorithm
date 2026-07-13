import { describe, it, expect } from 'vitest';
import type { Dataset, Species } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { planSpecies } from '../../src/solver/speciesPlanner';
import { findCarrierAlternatives, computeGuaranteedCarrierOutcome } from '../../src/solver/passivePlanner';
import type { GuaranteedCarrierOutcome } from '../../src/solver/passivePlanner';
import type { RosterEntry } from '../../src/solver/types';

/** Type-narrows a `GuaranteedCarrierOutcome` to its `routed` variant's `alt`, failing loudly
 * (rather than a silent `undefined`) when a test's fixture stops actually routing. */
function expectRouted(outcome: GuaranteedCarrierOutcome) {
  if (outcome.status !== 'routed') throw new Error(`expected a 'routed' outcome, got '${outcome.status}'`);
  return outcome.alt;
}

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
    partnerSkills: [],
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
      // Genuinely unreachable by breeding: no rank at all (capture/event-only), so it's
      // excluded from rankTable/breedCapable and never enters reverse()/forward() in any
      // pairing, tainted or not. A *ranked* species is NOT a valid "no path" fixture here —
      // combirank's formula answers a child for any two ranked species (verified against the
      // real 1.0 dataset: virtually every possible pair produces something), so a ranked
      // "LONELY" with other roster/catch diversity around it almost always turns out to have
      // a real, findable path once the forced search isn't artificially narrowed to its own
      // species alone (see speciesPlanner.ts's findForcedCarrierRoute doc comment).
      { id: 'LONELY', rank: null, wildCatchable: false, otherObtainOnly: true },
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

/**
 * computeGuaranteedCarrierOutcome — the actual AND/OR bug fix (spec §7.3 mode 2b). Two
 * independent carrier lineages that only meet at the final cross, so a correct fix must
 * report ONE tree carrying both desired passives, not the old behavior of two separate
 * single-passive trees from `findCarrierAlternatives`.
 */
describe('passivePlanner: computeGuaranteedCarrierOutcome (joint multi-passive routing)', () => {
  const dataset = synthetic(
    [
      // standardBreedable:false on every non-special-combo-child species below is
      // deliberate — it keeps these species out of the standard CombiRank formula's
      // closest-rank candidate pool entirely, so the graph edges are EXACTLY the 4
      // specialCombos declared here, with no accidental formula-based shortcuts sneaking
      // in through unrelated rank-proximity pairings (a real risk any time several species
      // share a fixture: the formula runs over every pair regardless of what the test
      // intends to exercise).
      { id: 'CARRIER_A', rank: 1, wildCatchable: false, standardBreedable: false },
      { id: 'CARRIER_B', rank: 2, wildCatchable: false, standardBreedable: false },
      { id: 'MID_A', rank: 4, wildCatchable: false },
      { id: 'MID_B', rank: 5, wildCatchable: false },
      { id: 'FODDER', rank: 6, standardBreedable: false },
      { id: 'FODDER2', rank: 7, standardBreedable: false },
      { id: 'TARGET', rank: 10, wildCatchable: false },
    ],
    [
      { parents: ['CARRIER_A', 'CARRIER_A'], child: 'MID_A', genderRule: null },
      { parents: ['CARRIER_B', 'CARRIER_B'], child: 'MID_B', genderRule: null },
      { parents: ['MID_A', 'MID_B'], child: 'TARGET', genderRule: null },
      { parents: ['FODDER', 'FODDER2'], child: 'TARGET', genderRule: null },
    ],
  );
  const ruleset = createCombiRank06(dataset);
  const roster: RosterEntry[] = [
    { species: 'CARRIER_A', gender: 'male', passives: ['P1'] },
    { species: 'CARRIER_A', gender: 'female', passives: ['P1'] },
    { species: 'CARRIER_B', gender: 'male', passives: ['P2'] },
    { species: 'CARRIER_B', gender: 'female', passives: ['P2'] },
    { species: 'FODDER', gender: 'male' },
    { species: 'FODDER', gender: 'female' },
    { species: 'FODDER2', gender: 'male' },
    { species: 'FODDER2', gender: 'female' },
  ];

  it('returns ONE tree jointly carrying both passives instead of two separate trees', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(baseline.combinationCount).toBe(1); // cheap FODDER+FODDER2 baseline
    expect(baseline.passivePlan?.unassigned).toEqual(['P1', 'P2']);

    const outcome = computeGuaranteedCarrierOutcome(ruleset, roster, 'TARGET', ['P1', 'P2'], baseline.combinationCount, {});
    const alt = expectRouted(outcome);
    expect(alt.fullyRouted).toBe(true);
    expect(alt.routedPassives).toEqual(['P1', 'P2']);
    expect(alt.plan.combinationCount).toBe(3);
    expect(alt.combinationDelta).toBe(2);
    const sourceSpecies = new Set(alt.sourceIndividuals.map((s) => s.species));
    expect(sourceSpecies).toEqual(new Set(['CARRIER_A', 'CARRIER_B']));
    expect(alt.compoundedOdds).toBeGreaterThan(0);

    // Contrast with the legacy per-passive shape this replaces in the UI: it still exists
    // (unchanged, for backward compat) but produces two independent trees, each paying the
    // full 3-combo cost on its own — exactly the OR-shaped result the fix moves away from.
    const legacy = findCarrierAlternatives(ruleset, roster, 'TARGET', baseline, {});
    expect(legacy.map((a) => a.passive).sort()).toEqual(['P1', 'P2']);
    expect(legacy.every((a) => a.plan.combinationCount === 3)).toBe(true);
  });

  it('routes a single individual holding both desired passives as one 2-combo lineage, not two searches', () => {
    const dualDataset = synthetic(
      [
        { id: 'DUAL', rank: 1, wildCatchable: false, standardBreedable: false },
        { id: 'MID', rank: 4, wildCatchable: false },
        { id: 'FODDER', rank: 5, standardBreedable: false },
        { id: 'FODDER2', rank: 6, standardBreedable: false },
        { id: 'TARGET', rank: 7, wildCatchable: false },
      ],
      [
        { parents: ['DUAL', 'DUAL'], child: 'MID', genderRule: null },
        { parents: ['MID', 'MID'], child: 'TARGET', genderRule: null },
        { parents: ['FODDER', 'FODDER2'], child: 'TARGET', genderRule: null },
      ],
    );
    const dualRuleset = createCombiRank06(dualDataset);
    const dualRoster: RosterEntry[] = [
      { species: 'DUAL', gender: 'male', passives: ['P1', 'P2'] },
      { species: 'DUAL', gender: 'female', passives: ['P1', 'P2'] },
      { species: 'FODDER', gender: 'male' },
      { species: 'FODDER', gender: 'female' },
      { species: 'FODDER2', gender: 'male' },
      { species: 'FODDER2', gender: 'female' },
    ];

    const baseline = planSpecies(dualRuleset, dualRoster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(baseline.passivePlan?.unassigned).toEqual(['P1', 'P2']);

    const outcome = computeGuaranteedCarrierOutcome(dualRuleset, dualRoster, 'TARGET', ['P1', 'P2'], baseline.combinationCount, {});
    const alt = expectRouted(outcome);
    expect(alt.fullyRouted).toBe(true);
    expect(alt.routedPassives).toEqual(['P1', 'P2']);
    // Same 2-combo shape as a single desired passive would need (DUAL self-cross -> MID,
    // MID self-cross -> TARGET) — carrying a second passive on the same individual is free.
    expect(alt.plan.combinationCount).toBe(2);
    expect(new Set(alt.sourceIndividuals.map((s) => s.species))).toEqual(new Set(['DUAL']));
  });

  it('partially routes when the full desired set cannot be jointly reached, explaining the leftover', () => {
    const partialDataset = synthetic(
      [
        { id: 'CARRIER_A', rank: 1, wildCatchable: false, standardBreedable: false },
        { id: 'CARRIER_B', rank: 2, wildCatchable: false, standardBreedable: false },
        { id: 'MID_A', rank: 4, wildCatchable: false },
        { id: 'MID_B', rank: 5, wildCatchable: false },
        { id: 'FODDER', rank: 6, standardBreedable: false },
        { id: 'FODDER2', rank: 7, standardBreedable: false },
        { id: 'TARGET', rank: 10, wildCatchable: false },
        // Ranked so it's a valid roster owner, but otherObtainOnly + no rank keeps it fully
        // isolated from every reverse()/forward() edge — an owned individual with no route,
        // distinct from "nobody owns it at all".
        { id: 'LONELY', rank: null, wildCatchable: false, otherObtainOnly: true },
      ],
      [
        { parents: ['CARRIER_A', 'CARRIER_A'], child: 'MID_A', genderRule: null },
        { parents: ['CARRIER_B', 'CARRIER_B'], child: 'MID_B', genderRule: null },
        { parents: ['MID_A', 'MID_B'], child: 'TARGET', genderRule: null },
        { parents: ['FODDER', 'FODDER2'], child: 'TARGET', genderRule: null },
      ],
    );
    const partialRuleset = createCombiRank06(partialDataset);
    const partialRoster: RosterEntry[] = [
      { species: 'CARRIER_A', gender: 'male', passives: ['P1'] },
      { species: 'CARRIER_A', gender: 'female', passives: ['P1'] },
      { species: 'CARRIER_B', gender: 'male', passives: ['P2'] },
      { species: 'CARRIER_B', gender: 'female', passives: ['P2'] },
      { species: 'FODDER', gender: 'male' },
      { species: 'FODDER', gender: 'female' },
      { species: 'FODDER2', gender: 'male' },
      { species: 'FODDER2', gender: 'female' },
      { species: 'LONELY', gender: 'male', passives: ['P3'] },
    ];

    const baseline = planSpecies(partialRuleset, partialRoster, 'TARGET', { desiredPassives: ['P1', 'P2', 'P3'] });
    expect(baseline.passivePlan?.unassigned).toEqual(['P1', 'P2', 'P3']);
    // P3 IS owned — this is the "owned but unroutable" case, distinct from "nobody owns it".
    expect(partialRoster.some((r) => r.passives?.includes('P3'))).toBe(true);

    const outcome = computeGuaranteedCarrierOutcome(
      partialRuleset,
      partialRoster,
      'TARGET',
      ['P1', 'P2', 'P3'],
      baseline.combinationCount,
      {},
    );
    const alt = expectRouted(outcome);
    expect(alt.fullyRouted).toBe(false);
    expect(alt.routedPassives).toEqual(['P1', 'P2']);
    expect(alt.requiredPassives).toEqual(['P1', 'P2', 'P3']);
  });

  it('reports "no-owner" when nobody in the roster carries any of the requested passives', () => {
    const baseline = planSpecies(ruleset, roster, 'TARGET', { desiredPassives: ['Nobody'] });
    expect(baseline.passivePlan?.unassigned).toEqual(['Nobody']);
    const outcome = computeGuaranteedCarrierOutcome(ruleset, roster, 'TARGET', ['Nobody'], baseline.combinationCount, {});
    expect(outcome).toEqual({ status: 'no-owner' });
  });

  // Explicit user correction during design: owning the target with the exact desired perk set
  // must NOT be treated as "nothing left to compute" — `computeGuaranteedCarrierOutcome` still
  // runs and still returns a real (degenerate) `routed` outcome, not a skip. This falls out of
  // `findForcedCarrierRoute`'s masked search on its own (an owned individual seeds its node with
  // every requested passive already in its mask, at cost 0) — no special-casing needed.
  it('routes an owned exact match as a real (0-combination) outcome instead of skipping it', () => {
    const ownedRoster: RosterEntry[] = [...roster, { species: 'TARGET', gender: 'male', passives: ['P1', 'P2'] }];
    const baseline = planSpecies(ruleset, ownedRoster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(baseline.combinationCount).toBe(0);
    expect(baseline.passivePlan).toBeUndefined();
    expect(baseline.passiveNote).toEqual({ status: 'owned-exact-match' });

    const outcome = computeGuaranteedCarrierOutcome(ruleset, ownedRoster, 'TARGET', ['P1', 'P2'], baseline.combinationCount, {});
    const alt = expectRouted(outcome);
    expect(alt.fullyRouted).toBe(true);
    expect(alt.routedPassives).toEqual(['P1', 'P2']);
    expect(alt.plan.combinationCount).toBe(0);
    expect(alt.combinationDelta).toBe(0);
    expect(alt.compoundedOdds).toBe(1); // no breeding steps at all — nothing to roll odds on
  });

  // Regression: the baseline's own final cross can pick up one of P for free (real-world
  // case reported live — Sekhmet with two desired perks, where the opportunistic plan's tied
  // final cross happened to already carry one of them). The guaranteed-carrier tree is an
  // INDEPENDENTLY re-derived lineage, not an extension of the baseline's — so a passive the
  // baseline sourced "for free" on its own tree isn't automatically present on this one. Before
  // the fix, `findGuaranteedCarrierAlternative` (now `computeGuaranteedCarrierOutcome`, which
  // takes the caller's full `requiredPassives` directly rather than deriving it from
  // `baseline.passivePlan.unassigned`) only forced the residue, so the already-assigned passive
  // silently never entered `requiredPassives`, `routedPassives`, or the `compoundOdds`
  // calculation at all — even when, as here, it was structurally present on the guaranteed
  // tree's own final parent the whole time.
  it('still routes (and reports) a passive the baseline already got for free, not just its unassigned residue', () => {
    const freeDataset = synthetic(
      [
        { id: 'FODDER', rank: 5, standardBreedable: false },
        { id: 'FODDER2', rank: 6, standardBreedable: false },
        { id: 'CARRIER_B', rank: 1, wildCatchable: false, standardBreedable: false },
        { id: 'MID_B', rank: 4, wildCatchable: false },
        { id: 'TARGET', rank: 10, wildCatchable: false },
      ],
      [
        { parents: ['FODDER', 'FODDER2'], child: 'TARGET', genderRule: null },
        { parents: ['CARRIER_B', 'CARRIER_B'], child: 'MID_B', genderRule: null },
        { parents: ['MID_B', 'FODDER'], child: 'TARGET', genderRule: null },
      ],
    );
    const freeRuleset = createCombiRank06(freeDataset);
    const freeRoster: RosterEntry[] = [
      { species: 'FODDER', gender: 'male', passives: ['P1'] },
      { species: 'FODDER', gender: 'female', passives: ['P1'] },
      { species: 'FODDER2', gender: 'male' },
      { species: 'FODDER2', gender: 'female' },
      { species: 'CARRIER_B', gender: 'male', passives: ['P2'] },
      { species: 'CARRIER_B', gender: 'female', passives: ['P2'] },
    ];

    const baseline = planSpecies(freeRuleset, freeRoster, 'TARGET', { desiredPassives: ['P1', 'P2'] });
    expect(baseline.combinationCount).toBe(1); // cheap FODDER+FODDER2 baseline
    expect(baseline.passivePlan?.desired).toEqual(['P1', 'P2']);
    // P1 lands for free on the baseline's own final cross (FODDER carries it); P2 doesn't.
    expect(baseline.passivePlan?.unassigned).toEqual(['P2']);

    const outcome = computeGuaranteedCarrierOutcome(freeRuleset, freeRoster, 'TARGET', ['P1', 'P2'], baseline.combinationCount, {});
    const alt = expectRouted(outcome);
    // Must still be asked to route BOTH — not just P2 — since this is an independently
    // re-derived tree, not an extension of the baseline's.
    expect(alt.requiredPassives).toEqual(['P1', 'P2']);
    expect(alt.fullyRouted).toBe(true);
    expect(alt.routedPassives).toEqual(['P1', 'P2']);
    expect(alt.plan.combinationCount).toBe(2); // CARRIER_B self-cross -> MID_B, MID_B+FODDER -> TARGET

    // The odds must account for BOTH passives at the final cross (FODDER x MID_B), not just
    // the one that was "unassigned" — otherwise the reported compounded odds silently ignore
    // a passive that's actually sitting right there on the final parent.
    const finalCrossOdds = freeRuleset.passiveModel.landOdds(['P1'], ['P2'], ['P1', 'P2']).supersetContaining;
    expect(alt.compoundedOdds).toBeCloseTo(finalCrossOdds, 10);
  });
});
