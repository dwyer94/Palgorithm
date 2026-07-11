import type { BreedingRuleset } from '../ruleset/types';
import { findForcedCarrierRoute } from './speciesPlanner.ts';
import type { PassiveId, PlanIndividual, RosterEntry, SpeciesId, SpeciesPlanResult, SpeciesPlannerOptions } from './types';

/**
 * passivePlanner (spec §7.3's originally-scoped module, session 0.4) — the "guaranteed
 * carrier" overlay: for a desired passive the baseline plan's final cross couldn't source
 * (`SpeciesPlanResult.passivePlan.unassigned`), find the cheapest alternate plan that forces
 * a specific owned Pal's lineage into the ancestry, with the combination-count cost and
 * compounded per-generation odds reported honestly. Never replaces the baseline plan
 * (CLAUDE.md: combination-count stays primary unless the user opts into the tradeoff) — this
 * is strictly an additional, separately-surfaced alternative.
 *
 * Mechanism: `speciesPlanner.findForcedCarrierRoute()` runs a tainted/bicolor search over the
 * FULL roster (plus catching, per the caller's real settings) that provably threads the
 * result through the carrier's own entries — see that function's doc comment for why this
 * replaced an earlier (session 0.4b) approach that narrowed the roster down to just the
 * carrier's own species and force-disabled catching. That narrowing was meant to guarantee
 * soundness, but it also meant the search could only ever reach species the carrier's own
 * self-cross could produce — which for almost any real species is nothing (verified against
 * the real 1.0 dataset: every self-pair special combo is a fixed point), so it reported "not
 * possible" essentially unconditionally rather than genuinely searching. The tainted search
 * gets the same soundness guarantee (catching alone can never produce a tainted result) while
 * actually using the rest of the owned roster as legitimate intermediate stock.
 */

export interface CarrierAlternative {
  passive: PassiveId;
  /** The owned individual the alternate plan is built around (for display — "routes X in"). */
  sourceIndividual: PlanIndividual;
  /** Full alternate plan: forces `sourceIndividual`'s species into the ancestry via a tainted
   * search over the full roster plus whatever catching the caller's `options` already allow
   * (`findForcedCarrierRoute`). */
  plan: SpeciesPlanResult;
  /** Product of each generation's landing odds for `passive` down the forced chain
   * (`passiveModel.landOdds(...).supersetContaining`, reused unchanged — no new probability
   * model). 1 when the carrier already IS the target (zero combinations needed). */
  compoundedOdds: number;
  /** `plan.combinationCount - baseline.combinationCount` — the honest cost of forcing this
   * route instead of the cheapest plan. */
  combinationDelta: number;
}

/** Cheapest alternate plan per unassigned desired passive, one entry per passive that has at
 * least one owning roster individual AND a feasible forced route. Passives with no owner at
 * all, or with an owner but no feasible route even when prioritized, are simply absent from
 * the result — the caller (UI) already has `baseline.passivePlan.unassigned` to diff against
 * to tell those two cases apart and word them differently. */
export function findCarrierAlternatives(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  baseline: SpeciesPlanResult,
  options: SpeciesPlannerOptions,
): CarrierAlternative[] {
  const unassigned = baseline.passivePlan?.unassigned ?? [];
  const alternatives: CarrierAlternative[] = [];

  for (const passive of unassigned) {
    const carriers = roster.filter((r) => r.passives?.includes(passive));
    if (carriers.length === 0) continue;

    const bySpecies = new Map<SpeciesId, RosterEntry[]>();
    for (const c of carriers) {
      const list = bySpecies.get(c.species) ?? [];
      list.push(c);
      bySpecies.set(c.species, list);
    }

    let best: { plan: SpeciesPlanResult; entries: RosterEntry[] } | null = null;
    for (const entries of bySpecies.values()) {
      // `findForcedCarrierRoute` searches the FULL roster (plus catching per `options`) for
      // the cheapest derivation that provably threads through `entries` — see its doc comment
      // in speciesPlanner.ts. The returned `steps` already carry `.passives` on exactly the
      // tainted-lineage individuals (both the graph-attribution overlay and `compoundOdds`
      // below read that directly, instead of re-deriving it by species name).
      const plan = findForcedCarrierRoute(ruleset, roster, entries, target, passive, options);
      if (!plan.feasible) continue;
      if (!best || plan.combinationCount < best.plan.combinationCount) best = { plan, entries };
    }
    if (!best) continue;

    const source = best.entries[0]!;
    alternatives.push({
      passive,
      sourceIndividual: { species: source.species, gender: source.gender, passives: source.passives ?? [] },
      plan: best.plan,
      compoundedOdds: compoundOdds(ruleset, best.plan, passive),
      combinationDelta: best.plan.combinationCount - baseline.combinationCount,
    });
  }

  return alternatives;
}

/** Walks the forced plan's topologically-ordered steps and multiplies each generation's
 * landing odds via the ruleset's own `landOdds()` — no new probability math. A step is
 * "involved" when `findForcedCarrierRoute` stamped `.passives` on one of its parents (i.e. it
 * sits on the actual tainted lineage) — checked by node identity, not species name, so a
 * carrier species that ALSO appears elsewhere in the plan as ordinary clean fodder (a real
 * possibility now that the search draws from the full roster) can't be mistaken for part of
 * the forced chain. */
function compoundOdds(ruleset: BreedingRuleset, plan: SpeciesPlanResult, passive: PassiveId): number {
  let compounded = 1;
  for (const step of plan.steps) {
    const aInvolved = step.parentA.passives?.includes(passive) ?? false;
    const bInvolved = step.parentB.passives?.includes(passive) ?? false;
    if (!aInvolved && !bInvolved) continue;
    const odds = ruleset.passiveModel.landOdds(step.parentA.passives ?? [], step.parentB.passives ?? [], [passive]);
    compounded *= odds.supersetContaining;
  }
  return compounded;
}
