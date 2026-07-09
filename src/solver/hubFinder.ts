import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies } from './speciesPlanner.ts';
import type {
  HubCandidate,
  HubFinderOptions,
  HubFinderResult,
  PlanIndividual,
  RosterEntry,
  SpeciesId,
  SpeciesPlannerOptions,
  SpeciesPlanStep,
  UnionPlanResult,
} from './types';

/**
 * hubFinder (spec §7.2) — the multi-target overlay on top of `speciesPlanner`. Two
 * independent pieces, both re-using `planSpecies` rather than duplicating any breeding
 * math (CLAUDE.md invariant #1):
 *   - `planUnion` — the baseline multi-target plan, always produced, standing on its own.
 *   - `findHubs` — the optional ranked-carrier overlay, in two modes: fixed-target (score
 *     against a known target list) and general-reach (rank by structural breadth when no
 *     target list exists yet).
 */

/** Same species-pair+child key as speciesPlanner's internal comboKey (duplicated rather
 * than exported — it's two lines, and keeping the modules decoupled matters more than
 * sharing it). */
function comboKey(step: SpeciesPlanStep): string {
  const [a, b] = [step.parentA.species, step.parentB.species].sort();
  return `${a}|${b}->${step.child}`;
}

/** Merge per-target step lists into one deduped, topologically-ordered union (CLAUDE.md
 * invariant #4: an intermediate shared by several targets' independently-reconstructed
 * plans is still one combination). Re-sorting instead of trusting concatenation order
 * because two targets' own valid orderings can interleave in a way naive concatenation
 * would violate. */
function mergeStepsTopological(perTarget: SpeciesPlanStep[][]): SpeciesPlanStep[] {
  const merged = new Map<string, SpeciesPlanStep>();
  for (const list of perTarget) {
    for (const step of list) {
      const key = comboKey(step);
      if (!merged.has(key)) merged.set(key, step);
    }
  }

  const producedBy = new Map<SpeciesId, string>();
  for (const [key, step] of merged) producedBy.set(step.child, key);

  const order: SpeciesPlanStep[] = [];
  const visited = new Set<string>();
  function visit(key: string) {
    if (visited.has(key)) return;
    visited.add(key);
    const step = merged.get(key)!;
    for (const parentSpecies of [step.parentA.species, step.parentB.species]) {
      const depKey = producedBy.get(parentSpecies);
      if (depKey) visit(depKey);
    }
    order.push(step);
  }
  for (const key of merged.keys()) visit(key);
  return order;
}

/** Merge per-target catch lists — a wild-caught individual is one fact even if several
 * targets' derivations independently needed that same species+gender. */
function mergeCatches(perTarget: PlanIndividual[][]): PlanIndividual[] {
  const seen = new Map<string, PlanIndividual>();
  for (const list of perTarget) {
    for (const c of list) {
      const key = `${c.species}|${c.gender}`;
      if (!seen.has(key)) seen.set(key, c);
    }
  }
  return [...seen.values()];
}

/**
 * Baseline multi-target plan (spec §7.2, "always produced"). Exact minimum-combination
 * for a *set* of targets is a directed Steiner forest (NP-hard); at this graph size,
 * solving each target independently against the same roster and de-duping the result is
 * a good-enough heuristic — the same "memoize produced intermediates" idea `planSpecies`
 * already uses within a single target, just applied across targets too.
 */
export function planUnion(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  targets: SpeciesId[],
  options: SpeciesPlannerOptions = {},
): UnionPlanResult {
  const perTargetOptions = (t: SpeciesId): SpeciesPlannerOptions =>
    options.excludeTargetsFromCatching
      ? { ...options, excludeFromCatching: [...(options.excludeFromCatching ?? []), t] }
      : options;
  const perTarget = targets.map((t) => planSpecies(ruleset, roster, t, perTargetOptions(t)));
  const feasible = perTarget.every((p) => p.feasible);
  const catchCost = options.catchCost ?? 1;

  const steps = mergeStepsTopological(perTarget.map((p) => p.steps));
  const catches = mergeCatches(perTarget.map((p) => p.catches));

  return {
    targets,
    feasible,
    perTarget,
    combinationCount: steps.length,
    cost: steps.length + catches.length * catchCost,
    steps,
    catches,
  };
}

/** Combos needed to reach `target` once `anchor` is available (both genders, cost 0) in
 * addition to whatever's already on the roster — the same "seed a hypothetical anchor and
 * re-solve" trick speciesPlanner's anchor-hint search uses (spec §7.1), repurposed here as
 * hubFinder's `injectCost(H → Ti)`. Infinity if `target` is still unreachable. */
function combosFromAnchor(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  anchor: SpeciesId,
  target: SpeciesId,
  options: SpeciesPlannerOptions,
): number {
  const augmented: RosterEntry[] = [...roster, { species: anchor, gender: 'male' }, { species: anchor, gender: 'female' }];
  const plan = planSpecies(ruleset, augmented, target, options);
  return plan.feasible ? plan.combinationCount : Infinity;
}

/** Every distinct species a given species can directly parent (one cross, p > 0) —
 * general-reach mode's structural breadth measure. Built once from `forward()` over all
 * breed-capable pairs (cheap at this graph size, spec §7.1), reused across every
 * candidate instead of recomputed per-candidate. */
function buildDirectChildIndex(ruleset: BreedingRuleset): Map<SpeciesId, Set<SpeciesId>> {
  const breedCapable = Object.keys(ruleset.rankTable);
  const idx = new Map<SpeciesId, Set<SpeciesId>>();
  const add = (parent: SpeciesId, child: SpeciesId) => {
    const s = idx.get(parent) ?? new Set<SpeciesId>();
    s.add(child);
    idx.set(parent, s);
  };
  for (let i = 0; i < breedCapable.length; i++) {
    for (let j = i; j < breedCapable.length; j++) {
      const a = breedCapable[i]!;
      const b = breedCapable[j]!;
      const outcomes = ruleset.forward(a, b).outcomes.filter((o) => o.p > 0);
      for (const o of outcomes) {
        add(a, o.child);
        add(b, o.child);
      }
    }
  }
  return idx;
}

/**
 * Ranked hub candidates (spec §7.2) — an optional overlay, never forced. Two modes:
 *   - `options.targets` given → fixed-target: score by
 *     `obtainCost(H) + Σ injectCost(H → Ti)`, favoring hubs that are a **direct parent**
 *     of each target (spec strongly prefers this shape — perks don't have to survive
 *     extra inheritance rolls).
 *   - `options.targets` omitted → general-reach: rank by structural breadth (how many
 *     species this hub could serve as a direct parent for), for "I have good perks on a
 *     bad host, what's a good general-purpose carrier" before you've picked targets.
 * `options.candidates` narrows the species swept in either mode — omit for the normal
 * exhaustive sweep over every `rankTable` entry.
 */
export function findHubs(ruleset: BreedingRuleset, roster: RosterEntry[], options: HubFinderOptions = {}): HubFinderResult {
  const maxHubs = options.maxHubs ?? 5;
  const targets = options.targets ?? [];
  const speciesOpts: SpeciesPlannerOptions = {
    ...(options.catchCost !== undefined && { catchCost: options.catchCost }),
    ...(options.allowCatching !== undefined && { allowCatching: options.allowCatching }),
    ...(options.desiredPassives !== undefined && { desiredPassives: options.desiredPassives }),
    ...(options.excludeFromCatching !== undefined && { excludeFromCatching: options.excludeFromCatching }),
  };

  const targetSet = new Set(targets);
  const candidates = (options.candidates ?? Object.keys(ruleset.rankTable)).filter((s) => !targetSet.has(s));

  if (targets.length > 0) {
    const hubs: HubCandidate[] = [];
    for (const H of candidates) {
      const obtainPlan = planSpecies(ruleset, roster, H, speciesOpts);
      if (!obtainPlan.feasible) continue;

      const injectCost = targets.map((T) => {
        const baseExclude = options.excludeFromCatching ?? [];
        const combos = combosFromAnchor(ruleset, roster, H, T, {
          ...(options.catchCost !== undefined && { catchCost: options.catchCost }),
          ...(options.allowCatching !== undefined && { allowCatching: options.allowCatching }),
          excludeFromCatching: options.excludeTargetsFromCatching ? [...baseExclude, T] : baseExclude,
        });
        return { target: T, combos, direct: combos === 1 };
      });
      if (injectCost.some((i) => !isFinite(i.combos))) continue; // can't reach every target

      const score = obtainPlan.cost + injectCost.reduce((s, i) => s + i.combos, 0);
      hubs.push({
        species: H,
        obtainCost: obtainPlan.cost,
        ...(obtainPlan.passivePlan !== undefined && { obtainPassivePlan: obtainPlan.passivePlan }),
        injectCost,
        score,
      });
    }
    hubs.sort((a, b) => a.score! - b.score!);
    return { hubs: hubs.slice(0, maxHubs) };
  }

  const directIdx = buildDirectChildIndex(ruleset);
  const hubs: HubCandidate[] = [];
  for (const H of candidates) {
    const breadth = directIdx.get(H)?.size ?? 0;
    if (breadth === 0) continue; // can't directly parent anything -> useless as a carrier

    const obtainPlan = planSpecies(ruleset, roster, H, speciesOpts);
    if (!obtainPlan.feasible) continue;

    hubs.push({
      species: H,
      obtainCost: obtainPlan.cost,
      ...(obtainPlan.passivePlan !== undefined && { obtainPassivePlan: obtainPlan.passivePlan }),
      breadth,
    });
  }
  hubs.sort((a, b) => b.breadth! - a.breadth! || a.obtainCost - b.obtainCost);
  return { hubs: hubs.slice(0, maxHubs) };
}
