import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies } from './speciesPlanner';
import { computeGuaranteedCarrierOutcome, type GuaranteedCarrierOutcome } from './passivePlanner';
import type { PassiveId, RosterEntry, SpeciesId, SpeciesPlannerOptions, SpeciesPlanResult } from './types';

/** The baseline plan + its guaranteed-carrier overlay for one target/roster/options triple —
 * the pair every caller (`SingleTargetView`, Team Builder, saved plans) renders together. */
export interface SingleTargetPlanCore {
  result: SpeciesPlanResult;
  guaranteedCarrierOutcome: GuaranteedCarrierOutcome;
}

export interface SingleTargetPlanRun extends SingleTargetPlanCore {
  /**
   * Present only when the target is already **owned outright** (baseline is 0 combinations with
   * no catches). The cheapest route to breed/catch ANOTHER one, computed with every owned copy of
   * the target species removed from the roster — so "you already own this" is always accompanied
   * by a real "here's the next-best way to make another" answer instead of dead-ending on
   * ownership (explicit user requirement). Carries its own guaranteed-carrier overlay for the perk
   * case, exactly like a normal run. Its `result.feasible` may be false — surfaced anyway (with
   * `anchorHints`) so the UI can explain why no other route exists, rather than hiding it.
   */
  nextBestWhenOwned?: SingleTargetPlanCore;
}

/** The single-target computation for one roster: baseline plan + guaranteed-carrier overlay.
 * The guaranteed-carrier search runs unconditionally whenever perks were requested and the target
 * is reachable at all — never skipped just because the baseline already looks "done", since that
 * case still needs its own honest "best route to breed one with these perks" answer. */
function computeCore(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  desiredPassives: PassiveId[],
  speciesOptions: SpeciesPlannerOptions,
): SingleTargetPlanCore {
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

/** Runs a single-target plan plus its guaranteed-carrier outcome — the composition
 * `SingleTargetView`'s "Run plan" and Team Builder's slot "Run"/"Re-run" both need, factored out
 * so there's one implementation. When the target is owned outright it additionally computes a
 * `nextBestWhenOwned` plan (roster minus the owned copies) so ownership never dead-ends the
 * answer — see that field's doc comment.
 *
 * `desiredPassives` may legitimately arrive longer than the ruleset's slot cap (the picker is
 * advisory, not a hard gate); `computeGuaranteedCarrierOutcome` clamps to the routable count
 * internally, so this never throws on an over-long set. */
export function runSingleTargetPlan(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  desiredPassives: PassiveId[],
  speciesOptions: SpeciesPlannerOptions,
): SingleTargetPlanRun {
  const core = computeCore(ruleset, roster, target, desiredPassives, speciesOptions);

  // "Owned outright" is the only way to reach cost 0 with no catches (a bare catch costs
  // `catchCost` and leaves a catch; every combo costs ≥ 1). In that case the baseline is just
  // "you have one" — recompute against a roster with every owned target copy removed to get the
  // genuine next-best way to make another, and surface it alongside.
  const ownedOutright =
    core.result.feasible &&
    core.result.combinationCount === 0 &&
    core.result.catches.length === 0 &&
    roster.some((r) => r.species === target);
  if (!ownedOutright) return core;

  const reducedRoster = roster.filter((r) => r.species !== target);
  const nextBestWhenOwned = computeCore(ruleset, reducedRoster, target, desiredPassives, speciesOptions);
  return { ...core, nextBestWhenOwned };
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
