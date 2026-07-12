import type { BreedingRuleset } from '../ruleset/types';
import { findForcedCarrierRoute } from './speciesPlanner.ts';
import type {
  ForcedCarrierResult,
  PassiveId,
  PlanIndividual,
  RosterEntry,
  SpeciesId,
  SpeciesPlanResult,
  SpeciesPlannerOptions,
} from './types';

/**
 * passivePlanner (spec §7.3, session 0.4; two-mode rewrite session) — the "guaranteed carrier"
 * overlay (mode 2b): for desired passives the baseline plan's final cross couldn't source
 * (`SpeciesPlanResult.passivePlan.unassigned`), find the cheapest alternate plan that forces
 * the owning Pal(s)' lineage into the ancestry, with the combination-count cost and compounded
 * per-generation odds reported honestly. Never replaces the baseline plan (CLAUDE.md:
 * combination-count stays primary unless the user opts into the tradeoff) — this is strictly
 * an additional, separately-surfaced alternative (mode 2a stays the baseline plan itself).
 *
 * Mechanism: `speciesPlanner.findForcedCarrierRoute()` runs a masked search over the FULL
 * roster (plus catching, per the caller's real settings) that provably threads the result
 * through whichever roster entries carry the requested passives — see that function's doc
 * comment for why this replaced an earlier (session 0.4b) approach that narrowed the roster
 * down to just the carrier's own species and force-disabled catching (that narrowing meant the
 * search could only ever reach species the carrier's own self-cross could produce, which for
 * almost any real species is nothing).
 *
 * Two call shapes onto the same underlying search:
 * - `findCarrierAlternatives` — one alternative PER unassigned passive (legacy shape, kept
 *   unchanged for existing callers/tests): each call routes exactly one passive (k=1).
 * - `findGuaranteedCarrierAlternative` — the actual mode-2b fix: routes ALL of P (the baseline's
 *   full `desired` set, not just its `unassigned` residue — see that function's doc comment)
 *   jointly into ONE lineage when a route exists (spec §7.3: "must combine all of P into one
 *   lineage/tree whenever a route exists" — the AND, not OR, requirement), degrading to the
 *   largest jointly-routable subset when it can't (spec's "partial routing").
 */

export interface CarrierAlternative {
  passive: PassiveId;
  /** The owned individual the alternate plan is built around (for display — "routes X in"). */
  sourceIndividual: PlanIndividual;
  /** Full alternate plan: forces `sourceIndividual`'s species into the ancestry via a masked
   * search over the full roster plus whatever catching the caller's `options` already allow
   * (`findForcedCarrierRoute`). */
  plan: ForcedCarrierResult;
  /** Product of each generation's landing odds for `passive` down the forced chain
   * (`passiveModel.landOdds(...).supersetContaining`, reused unchanged — no new probability
   * model). 1 when the carrier already IS the target (zero combinations needed). */
  compoundedOdds: number;
  /** `plan.combinationCount - baseline.combinationCount` — the honest cost of forcing this
   * route instead of the cheapest plan. */
  combinationDelta: number;
}

/** Mode 2b's actual result shape (spec §7.3): ONE plan jointly routing as much of the
 * baseline's full desired passive set P as a single lineage can carry. */
export interface GuaranteedCarrierAlternative {
  /** The full set this was asked to route — `baseline.passivePlan.desired` at call time (all
   * of P, not just the baseline's own `unassigned` residue — a passive the baseline happened
   * to source for free on its own lineage isn't automatically present on this independently
   * re-derived one). */
  requiredPassives: PassiveId[];
  /** Subset actually jointly routed into the one lineage below. */
  routedPassives: PassiveId[];
  /** True iff every `requiredPassives` entry was routed. */
  fullyRouted: boolean;
  /** Every distinct owned individual found on the routed lineage. */
  sourceIndividuals: RosterEntry[];
  /** The single combined plan. */
  plan: ForcedCarrierResult;
  /** Product of each generation's landing odds for `routedPassives` down the forced chain. */
  compoundedOdds: number;
  /** `plan.combinationCount - baseline.combinationCount`. */
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
    if (!roster.some((r) => r.passives?.includes(passive))) continue;

    // `findForcedCarrierRoute` searches the FULL roster (plus catching per `options`) for the
    // cheapest derivation that provably threads through whichever entries carry `passive` —
    // see its doc comment in speciesPlanner.ts. The returned `steps` already carry `.passives`
    // on exactly the routed-lineage individuals (both the graph-attribution overlay and
    // `compoundOdds` below read that directly, instead of re-deriving it by species name).
    const plan = findForcedCarrierRoute(ruleset, roster, [passive], target, options);
    if (!plan.feasible) continue;

    const source = plan.carrierLeaves[0];
    if (!source) continue;
    alternatives.push({
      passive,
      sourceIndividual: { species: source.species, gender: source.gender, passives: source.passives ?? [] },
      plan,
      compoundedOdds: compoundOdds(ruleset, plan, [passive]),
      combinationDelta: plan.combinationCount - baseline.combinationCount,
    });
  }

  return alternatives;
}

/** Mode 2b (spec §7.3): routes ALL of `baseline.passivePlan.desired` (the full desired set P,
 * not just the baseline's own `unassigned` residue) jointly into ONE lineage when a route
 * exists, instead of `findCarrierAlternatives`' one-tree-per-passive shape — this is what
 * fixes the AND/OR bug (two desired passives on two different owned Pals now come back as a
 * single combined tree, not two independent ones). Gated on the baseline having at least one
 * genuinely unassigned passive (otherwise there's nothing for a guaranteed tree to add over
 * the baseline), but once triggered, forces the FULL set — a passive the baseline picked up
 * for free on its own lineage isn't guaranteed to also sit on this independently re-derived
 * one, so it must still be threaded through here rather than assumed. Returns `null` when
 * there's nothing to route (baseline already covers everything, nobody owns any of P, or the
 * joint search is fully infeasible). */
export function findGuaranteedCarrierAlternative(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  baseline: SpeciesPlanResult,
  options: SpeciesPlannerOptions,
): GuaranteedCarrierAlternative | null {
  // Route the FULL desired set P (spec §7.3 mode 2b: "must combine all of P into one
  // lineage... whenever a route exists"), not just `baseline.passivePlan.unassigned`. The
  // baseline's "unassigned" split is scoped to the baseline's OWN final cross — a passive it
  // marks "assigned" only did so on that specific lineage, which this alternate plan may not
  // share at all (it's an independently re-derived tree). Forcing only the residue meant a
  // passive the baseline happened to pick up for free could be silently absent from this
  // tree, with nothing in `routedPassives`/`compoundedOdds` accounting for it either way —
  // exactly the "silently drops a desired perk" failure §7.3's UI requirement forbids.
  // `findForcedCarrierRoute`'s masked search still finds it for free wherever a roster leaf
  // already carries it (spec's "prefer combining at the final cross"), so this doesn't cost
  // more than necessary when the baseline's free pick is still reachable.
  if (baseline.passivePlan?.unassigned.length === 0) return null;
  const requiredPassives = baseline.passivePlan?.desired ?? [];
  if (requiredPassives.length === 0) return null;
  if (!requiredPassives.some((p) => roster.some((r) => r.passives?.includes(p)))) return null;

  const plan = findForcedCarrierRoute(ruleset, roster, requiredPassives, target, options);
  if (!plan.feasible) return null;

  return {
    requiredPassives,
    routedPassives: plan.routedPassives,
    fullyRouted: plan.fullyRouted,
    sourceIndividuals: plan.carrierLeaves,
    plan,
    compoundedOdds: compoundOdds(ruleset, plan, plan.routedPassives),
    combinationDelta: plan.combinationCount - baseline.combinationCount,
  };
}

/** Walks the forced plan's topologically-ordered steps and multiplies each generation's
 * landing odds via the ruleset's own `landOdds()` — no new probability math. Each step is only
 * scored against whichever of `passives` its own parents actually carry (`stepPassives`), not
 * the full set every time — a step whose parents carry just P1 has nothing to say about P2's
 * odds, and asking `landOdds` for a passive neither parent holds needlessly routes through the
 * (often unknown/zero) mutation term, which would silently zero out the whole product for
 * steps that are only responsible for ONE of several jointly-routed passives. A step is
 * "involved" at all when it carries any of `passives` — checked by node identity, not species
 * name, so a carrier species that ALSO appears elsewhere in the plan as ordinary clean fodder
 * (a real possibility now that the search draws from the full roster) can't be mistaken for
 * part of the forced chain. */
function compoundOdds(ruleset: BreedingRuleset, plan: ForcedCarrierResult, passives: PassiveId[]): number {
  let compounded = 1;
  for (const step of plan.steps) {
    const stepPassives = passives.filter((p) => step.parentA.passives?.includes(p) || step.parentB.passives?.includes(p));
    if (stepPassives.length === 0) continue;
    const odds = ruleset.passiveModel.landOdds(step.parentA.passives ?? [], step.parentB.passives ?? [], stepPassives);
    compounded *= odds.supersetContaining;
  }
  return compounded;
}
