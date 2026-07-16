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
 * passivePlanner (spec §7.3, session 0.4; two-mode rewrite session; single-target transparency
 * pass) — the "guaranteed carrier" overlay (mode 2b): find the cheapest real breeding route that
 * forces the owning Pal(s)' lineage into the ancestry for a caller's desired passives, with the
 * combination-count cost and compounded per-generation odds reported honestly. Never replaces the
 * baseline plan (CLAUDE.md: combination-count stays primary unless the user opts into the
 * tradeoff) — this is strictly an additional, separately-surfaced result, run unconditionally
 * whenever passives are requested (including when the baseline already owns an exact match —
 * that just makes the search trivially resolve to a 0-combination route, not a reason to skip it).
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
 * - `computeGuaranteedCarrierOutcome` — the actual mode-2b fix: routes ALL of the caller's
 *   `requiredPassives` jointly into ONE lineage when a route exists (spec §7.3: "must combine
 *   all of P into one lineage/tree whenever a route exists" — the AND, not OR, requirement),
 *   degrading to the largest jointly-routable subset when it can't (spec's "partial routing"),
 *   and always returning a self-explanatory `GuaranteedCarrierOutcome` status otherwise.
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

/** Mode 2b's outcome (spec §7.3), always self-explanatory instead of collapsing every "couldn't
 * produce an alternative" case to `null` — the single-target UI renders one of these whenever
 * perks were requested, never silently omitting the section (session: single-target
 * transparency pass). `not-requested` and `no-owner` are cheap short-circuits before ever
 * running the search; `infeasible`'s `reason` distinguishes "this species can never be bred at
 * all" (roster-independent — `ruleset.reachability.standardBreedable` says so) from "breedable
 * in principle, but nothing in the current roster/catch settings reaches it". */
export type GuaranteedCarrierOutcome =
  | { status: 'not-requested' }
  | { status: 'no-owner' }
  | { status: 'infeasible'; reason: 'no-standard-breeding-route' | 'unreachable-with-current-roster' }
  | { status: 'routed'; alt: GuaranteedCarrierAlternative };

/** Mode 2b (spec §7.3): routes ALL of `requiredPassives` jointly into ONE lineage when a route
 * exists, instead of `findCarrierAlternatives`' one-tree-per-passive shape — this is what fixes
 * the AND/OR bug (two desired passives on two different owned Pals now come back as a single
 * combined tree, not two independent ones). Always attempted whenever the caller has any desired
 * passives at all (no gating on the baseline's own `passivePlan`/`unassigned` shape — the
 * baseline may not have built one at all, e.g. when the species is owned or caught outright, and
 * this search is exactly how that case still gets a real "best route to breed one with these
 * perks" answer instead of being skipped). An owned individual that already carries every
 * `requiredPassives` entry needs no special-casing here: `findForcedCarrierRoute`'s masked
 * search seeds it at cost 0 with the full mask already set, so it naturally comes back
 * `status: 'routed'` with `combinationDelta: 0` — "you already own an exact match" falls out of
 * the same search, it isn't a separate code path.
 *
 * `excludeDirectOwnership` (default false) is `runSingleTargetPlan`'s "next-best-when-owned"
 * mode: passed straight through to `findForcedCarrierRoute` (see its doc comment) so "you
 * already own an exact match" is never the reported route there — it never touches `roster`, so
 * an owned `target`-species individual remains fully available as breeding stock (e.g. a
 * self-cross with a second owned individual). */
export function computeGuaranteedCarrierOutcome(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  requiredPassives: PassiveId[],
  baselineCombinationCount: number,
  options: SpeciesPlannerOptions = {},
  excludeDirectOwnership = false,
): GuaranteedCarrierOutcome {
  // Clamp to the ruleset's slot cap before the (1-4 bounded) masked search — the desired-perk
  // picker is advisory and can hand us more than fit in a Pal's slots; `findForcedCarrierRoute`
  // hard-throws above 4, and `landOdds` already slices to `maxSlots`, so silently keeping the
  // first `maxSlots` is both consistent with the baseline and safer than letting a stray
  // over-long set crash the whole run.
  const desired = [...new Set(requiredPassives)].slice(0, ruleset.passiveModel.maxSlots);
  if (desired.length === 0) return { status: 'not-requested' };
  if (!desired.some((p) => roster.some((r) => r.passives?.includes(p)))) return { status: 'no-owner' };

  const plan = findForcedCarrierRoute(ruleset, roster, desired, target, options, excludeDirectOwnership);
  if (!plan.feasible) {
    return {
      status: 'infeasible',
      reason: ruleset.reachability.standardBreedable.has(target)
        ? 'unreachable-with-current-roster'
        : 'no-standard-breeding-route',
    };
  }

  return {
    status: 'routed',
    alt: {
      requiredPassives: desired,
      routedPassives: plan.routedPassives,
      fullyRouted: plan.fullyRouted,
      sourceIndividuals: plan.carrierLeaves,
      plan,
      compoundedOdds: compoundOdds(ruleset, plan, plan.routedPassives),
      combinationDelta: plan.combinationCount - baselineCombinationCount,
    },
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
