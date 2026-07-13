import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies } from './speciesPlanner';
import { computeGuaranteedCarrierOutcome, type GuaranteedCarrierOutcome } from './passivePlanner';
import type { PassiveId, RosterEntry, SpeciesId, SpeciesPlannerOptions, SpeciesPlanResult } from './types';

export interface SingleTargetPlanRun {
  result: SpeciesPlanResult;
  guaranteedCarrierOutcome: GuaranteedCarrierOutcome;
}

/** Runs a single-target plan plus its guaranteed-carrier outcome — the composition
 * `SingleTargetView`'s "Run plan" and Team Builder's slot "Run"/"Re-run" both need, factored out
 * so there's one implementation. The guaranteed-carrier search runs unconditionally whenever
 * perks were requested and the target is reachable at all — never skipped just because the
 * baseline already looks "done" (e.g. the target is owned outright), since that's exactly the
 * case that still needs its own honest "best route to breed one with these perks" answer rather
 * than being silently treated as nothing left to compute. */
export function runSingleTargetPlan(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  desiredPassives: PassiveId[],
  speciesOptions: SpeciesPlannerOptions,
): SingleTargetPlanRun {
  const result = planSpecies(ruleset, roster, target, {
    ...speciesOptions,
    ...(desiredPassives.length > 0 && { desiredPassives }),
  });
  const guaranteedCarrierOutcome: GuaranteedCarrierOutcome =
    desiredPassives.length > 0 && result.feasible
      ? computeGuaranteedCarrierOutcome(ruleset, roster, target, desiredPassives, result.combinationCount, speciesOptions)
      : { status: 'not-requested' };
  return { result, guaranteedCarrierOutcome };
}

/** Subset of a `routed` guaranteed-carrier outcome's still-unrouted passives that the given
 * roster owns — reproduces the "owned but no joint route found" vs "nobody owns this" messaging
 * without re-querying a roster that may have since changed. Empty for every other outcome status
 * (nothing "unassigned" to speak of when there's no route at all). */
export function computeOwnedUnassignedPassives(outcome: GuaranteedCarrierOutcome, roster: RosterEntry[]): PassiveId[] {
  if (outcome.status !== 'routed') return [];
  const unassigned = outcome.alt.requiredPassives.filter((p) => !outcome.alt.routedPassives.includes(p));
  return unassigned.filter((p) => roster.some((r) => r.passives?.includes(p)));
}
