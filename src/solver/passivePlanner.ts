import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies } from './speciesPlanner.ts';
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
 * Mechanism: re-running the existing `planSpecies()` with the roster narrowed to just the
 * carrier's own entries answers "what's the cheapest path from just this Pal to the target."
 * Catching is force-disabled for this narrowed solve regardless of the caller's settings —
 * NOT an arbitrary restriction, but required for soundness: `speciesPlanner`'s `solve()`
 * seeds every `wildCatchable` species at `catchCost` independent of `roster` (see
 * `solve()`'s catching loop), so with catching left on, a target reachable via catch-and-
 * breed alone can come out cheaper than the carrier's chain WITHOUT ever using the carrier —
 * silently defeating the entire point of "guaranteed" while still returning `feasible: true`.
 * Disabling catching makes the carrier's own entries the only cost-0 seed, so any successful
 * solve is provably rooted in the carrier. Known v1 limitation, stated plainly rather than
 * hidden: a forced chain needing an unowned partner species at some generation will report
 * infeasible rather than reaching for a catch — consistent with this app's roster-only-by-
 * default philosophy (`allowCatching` itself defaults false) and `hubFinder`'s own "good
 * heuristic over exact algorithm" precedent for this graph size.
 */

export interface CarrierAlternative {
  passive: PassiveId;
  /** The owned individual the alternate plan is built around (for display — "routes X in"). */
  sourceIndividual: PlanIndividual;
  /** Full alternate plan: forces `sourceIndividual`'s species into the ancestry by solving
   * with the roster narrowed to just that species' carrying individuals, plus whatever
   * catching the caller's `options` already allow. */
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
      // `desiredPassives: [passive]` doesn't change `combinationCount`/`steps` (species-cost
      // and passive-selection are independent, per speciesPlanner's own invariant) — it only
      // asks the final cross to prefer landing `passive` among cost-tied candidates, and
      // populates `plan.passivePlan` so the UI's graph-attribution overlay (Phase 1) can show
      // the carrier's passive on the alternate's own rendered tree, not just this function's
      // own `compoundOdds` figure.
      const plan = planSpecies(ruleset, entries, target, { ...options, allowCatching: false, desiredPassives: [passive] });
      if (!plan.feasible) continue;
      if (!best || plan.combinationCount < best.plan.combinationCount) best = { plan, entries };
    }
    if (!best) continue;

    const source = best.entries[0]!;
    alternatives.push({
      passive,
      sourceIndividual: { species: source.species, gender: source.gender, passives: source.passives ?? [] },
      plan: best.plan,
      compoundedOdds: compoundOdds(ruleset, best.entries, best.plan, passive),
      combinationDelta: best.plan.combinationCount - baseline.combinationCount,
    });
  }

  return alternatives;
}

/** Walks the forced plan's topologically-ordered steps, tracking which species currently
 * carries `passive` starting from the seeded carrier entries, and multiplies each
 * generation's landing odds via the ruleset's own `landOdds()` — no new probability math.
 * After the first generation, the tracked lineage is assumed to carry exactly `[passive]`
 * going forward (clean-carrier-forward, consistent with how the rest of the planner treats
 * produced individuals). Safe against a carrier-only roster: every node in `plan` is either
 * the tracked lineage, a wild catch (clean), or descends from the tracked lineage — there's
 * no other free roster in this solve for an unrelated branch to come from. */
function compoundOdds(ruleset: BreedingRuleset, carrierEntries: RosterEntry[], plan: SpeciesPlanResult, passive: PassiveId): number {
  const carrierSpecies = carrierEntries[0]?.species;
  if (carrierSpecies === undefined) return 0;

  const passivesBySpecies = new Map<SpeciesId, PassiveId[]>();
  const initialPassives = [...new Set(carrierEntries.flatMap((e) => e.passives ?? []))];
  passivesBySpecies.set(carrierSpecies, initialPassives.length > 0 ? initialPassives : [passive]);
  const passivesOf = (individual: PlanIndividual): PassiveId[] => passivesBySpecies.get(individual.species) ?? [];

  let compounded = 1;
  for (const step of plan.steps) {
    const involved = passivesBySpecies.has(step.parentA.species) || passivesBySpecies.has(step.parentB.species);
    if (!involved) continue;
    const odds = ruleset.passiveModel.landOdds(passivesOf(step.parentA), passivesOf(step.parentB), [passive]);
    compounded *= odds.supersetContaining;
    passivesBySpecies.set(step.child, [passive]);
  }
  return compounded;
}
