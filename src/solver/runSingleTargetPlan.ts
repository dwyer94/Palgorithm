import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies } from './speciesPlanner';
import { findGuaranteedCarrierAlternative, type GuaranteedCarrierAlternative } from './passivePlanner';
import type { PassiveId, RosterEntry, SpeciesId, SpeciesPlannerOptions, SpeciesPlanResult } from './types';

export interface SingleTargetPlanRun {
  result: SpeciesPlanResult;
  guaranteedCarrierAlt: GuaranteedCarrierAlternative | null;
}

/** Runs a single-target plan plus its guaranteed-carrier overlay (when the baseline leaves
 * any desired passive unassigned) — the composition `SingleTargetView`'s "Run plan" and Team
 * Builder's slot "Run"/"Re-run" both need, factored out so there's one implementation. */
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
  const guaranteedCarrierAlt = result.passivePlan?.unassigned.length
    ? findGuaranteedCarrierAlternative(ruleset, roster, target, result, speciesOptions)
    : null;
  return { result, guaranteedCarrierAlt };
}

/** Subset of `result.passivePlan.unassigned` the given roster owns — reproduces the "owned
 * but no route found" vs "nobody owns this" messaging without re-querying a roster that may
 * have since changed. */
export function computeOwnedUnassignedPassives(result: SpeciesPlanResult, roster: RosterEntry[]): PassiveId[] {
  return (result.passivePlan?.unassigned ?? []).filter((p) => roster.some((r) => r.passives?.includes(p)));
}
