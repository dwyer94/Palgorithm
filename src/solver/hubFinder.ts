import type { BreedingRuleset } from '../ruleset/types';
import { planSpecies, solveContext, resultFromContext, injectProbe } from './speciesPlanner.ts';
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
    ...(options.ignoreGender !== undefined && { ignoreGender: options.ignoreGender }),
    ...(options.desiredPassives !== undefined && { desiredPassives: options.desiredPassives }),
    ...(options.excludeFromCatching !== undefined && { excludeFromCatching: options.excludeFromCatching }),
  };

  const targetSet = new Set(targets);
  const candidates = (options.candidates ?? Object.keys(ruleset.rankTable)).filter((s) => !targetSet.has(s));

  // The base roster is identical for every candidate's obtainCost, so solve it once and read
  // each candidate off that single fixpoint (`resultFromContext`) instead of re-running the
  // full Dijkstra per candidate. Passing `withAnchorHints: false` skips the anchor-hint
  // search — a per-call full-solve-per-species pass the sweep only ever discards, and
  // previously the dominant cost when most candidates were infeasible to obtain. (Anchor
  // hints for `desiredPassives` are unaffected: they don't influence the solve.)
  const baseCtx = solveContext(ruleset, roster, speciesOpts);

  if (targets.length > 0) {
    const baseExclude = options.excludeFromCatching ?? [];
    const catchingOn = options.allowCatching ?? false;
    const rosterSpecies = new Set(roster.map((r) => r.species));
    // Inject solves never use `desiredPassives` (perks are an obtain-side concern), so the
    // core cost knobs are all that matter here.
    const injectBaseOptions: SpeciesPlannerOptions = {
      ...(options.catchCost !== undefined && { catchCost: options.catchCost }),
      ...(options.allowCatching !== undefined && { allowCatching: options.allowCatching }),
      ...(options.ignoreGender !== undefined && { ignoreGender: options.ignoreGender }),
      excludeFromCatching: baseExclude,
    };

    // A target needs its own anchor-solve only when it must be excluded from catching AND is
    // itself wild-catchable with catching enabled — removing its own catch base-case changes
    // the fixpoint. Otherwise a target reads off the shared (anchor-inclusive) or base
    // (anchor-free) solve directly.
    const needsDedicated = (T: SpeciesId): boolean =>
      !!options.excludeTargetsFromCatching && catchingOn && ruleset.reachability.wildCatchable.has(T) && !baseExclude.includes(T);

    // The least injectCost(H → T) can possibly be for ANY anchor H: a target already free from
    // the roster (owned, or catchable when catching isn't disabled for it) costs 0 combos;
    // otherwise it must be bred, ≥ 1.
    const floorOf = (T: SpeciesId): number =>
      rosterSpecies.has(T) || (catchingOn && !needsDedicated(T) && ruleset.reachability.wildCatchable.has(T) && !baseExclude.includes(T)) ? 0 : 1;

    // Anchor-free base injectCost per target — the cost to reach T with NOTHING extra seeded.
    // Seeding a candidate anchor (cost 0) can only lower this, and it can never drop below the
    // target's floor. So whenever base(T) already equals the floor, injectCost(H → T) is pinned
    // to that value for EVERY candidate — no per-candidate anchor-solve is needed. For the
    // typical apex target (standard-breedable and one cross from catchable stock) that's the
    // case, which collapses the whole sweep to one base solve plus a per-candidate obtain
    // lookup. Non-dedicated targets read off `baseCtx` (its core opts match — `desiredPassives`
    // doesn't affect the solve); each dedicated target costs a single extra solve.
    const base = new Map<SpeciesId, number>();
    for (const T of targets) {
      let plan;
      if (needsDedicated(T)) {
        const opt: SpeciesPlannerOptions = { ...injectBaseOptions, excludeFromCatching: [...baseExclude, T] };
        plan = resultFromContext(ruleset, roster, T, solveContext(ruleset, roster, opt), opt, false);
      } else {
        plan = resultFromContext(ruleset, roster, T, baseCtx, injectBaseOptions, false);
      }
      base.set(T, plan.feasible ? plan.combinationCount : Infinity);
    }
    // A target is "variable" (its injectCost can differ per anchor) only when its base cost
    // exceeds its floor — including the unreachable-without-an-anchor case (base = Infinity),
    // where the right anchor may unlock it. Everything else contributes a fixed offset.
    const variable = new Set(targets.filter((T) => base.get(T)! !== floorOf(T)));
    const constOffset = targets.filter((T) => !variable.has(T)).reduce((s, T) => s + base.get(T)!, 0);
    const totalVarFloor = [...variable].reduce((s, T) => s + floorOf(T), 0);

    // Evaluate cheapest-to-obtain candidates first: with the constant offset shared by all,
    // obtainCost is exactly what surfaces the lowest-scoring hubs first, tightening `worst`
    // early so branch-and-bound skips the rest before their (variable-target) anchor-solves.
    // Pure ordering — the final ranking tiebreaks on the original candidate index, so this
    // changes only how much is pruned, never the output.
    const candidateIndex = new Map<SpeciesId, number>(candidates.map((s, i) => [s, i]));
    const obtainable = candidates
      .map((H) => ({ H, obtainPlan: resultFromContext(ruleset, roster, H, baseCtx, speciesOpts, false) }))
      .filter((c) => c.obtainPlan.feasible)
      .sort((a, b) => a.obtainPlan.cost - b.obtainPlan.cost || candidateIndex.get(a.H)! - candidateIndex.get(b.H)!);

    // Accepted hub scores kept sorted ascending; `worst` is the current `maxHubs`-th best
    // (Infinity until the list is full), the threshold a candidate's lower bound must beat.
    const acceptedScores: number[] = [];
    const worst = (): number => (acceptedScores.length >= maxHubs ? acceptedScores[maxHubs - 1]! : Infinity);
    const recordScore = (score: number): void => {
      let lo = 0;
      let hi = acceptedScores.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (acceptedScores[mid]! < score) lo = mid + 1;
        else hi = mid;
      }
      acceptedScores.splice(lo, 0, score);
    };

    // Every variable target's injectCost(H → T) used to cost a full `solveContext` over the
    // augmented (roster + H) graph per candidate — ~260 full Dijkstra solves, the sweep's
    // dominant cost (PERFORMANCE_REMEDIATION_PLAN.md Phase 3). Non-dedicated variable targets
    // all read off the SAME base (the un-augmented roster solved once with `injectBaseOptions`),
    // so `injectProbe` (speciesPlanner.ts) can warm-start from that one shared fixpoint per
    // candidate instead: seed H's two individuals at cost 0, relax only the subgraph that
    // actually improves, read every wanted target's deduped combo count, then undo — the same
    // "Dijkstra never needs to un-finalize a node" trick Phase 2's `anchorProbeCost` used, just
    // extended to also track `from` so exact (deduped, not raw-`dist`) combo counts come out.
    // Each dedicated target needs its own base (a different catching-exclusion roster), solved
    // once here rather than once per candidate.
    const nonDedicatedVariable = [...variable].filter((T) => !needsDedicated(T));
    const dedicatedVariable = [...variable].filter((T) => needsDedicated(T));
    const sharedInjectBase = nonDedicatedVariable.length > 0 ? solveContext(ruleset, roster, injectBaseOptions) : null;
    const dedicatedInjectBase = new Map<SpeciesId, ReturnType<typeof solveContext>>();
    for (const T of dedicatedVariable) {
      const opt: SpeciesPlannerOptions = { ...injectBaseOptions, excludeFromCatching: [...baseExclude, T] };
      dedicatedInjectBase.set(T, solveContext(ruleset, roster, opt));
    }

    const hubs: HubCandidate[] = [];
    for (const { H, obtainPlan } of obtainable) {
      // Constant-target injectCosts are known up front, so seed them into the running score;
      // only variable targets need a per-candidate probe.
      let runningScore = obtainPlan.cost + constOffset;
      // Optimistic total if EVERY variable target hits its floor — provably can't make the top
      // list, so skip every probe for this candidate entirely (no graph work at all).
      if (runningScore + totalVarFloor > worst()) continue;

      const extraSeeds: RosterEntry[] = [{ species: H, gender: 'male' }, { species: H, gender: 'female' }];
      const combosByTarget = new Map<SpeciesId, number>();
      // Bail as soon as ANY variable target proves unreachable through this candidate, instead
      // of unconditionally probing every dedicated target first and only checking feasibility
      // afterward — with 2+ dedicated (catching-excluded) targets, an already-infeasible
      // candidate used to still pay for every remaining dedicated target's full relaxation pass
      // before ever bailing, reintroducing some of the redundant-work pattern Phase 3 aimed to
      // eliminate (post-Phase-5 code review finding #8). The shared batch call itself can't be
      // short-circuited mid-call (that's the whole point of probing every non-dedicated target
      // in one relaxation pass), but checking its results before touching any dedicated probe —
      // and stopping the dedicated loop at the first infeasible one — still skips real work.
      let viable = true;
      if (sharedInjectBase) {
        for (const [T, combos] of injectProbe(sharedInjectBase.graph, sharedInjectBase.state, extraSeeds, nonDedicatedVariable)) {
          combosByTarget.set(T, combos);
          if (!isFinite(combos)) viable = false;
        }
      }
      if (viable) {
        for (const T of dedicatedVariable) {
          const dedicatedBase = dedicatedInjectBase.get(T)!;
          const combos = injectProbe(dedicatedBase.graph, dedicatedBase.state, extraSeeds, [T]).get(T)!;
          combosByTarget.set(T, combos);
          if (!isFinite(combos)) {
            viable = false;
            break;
          }
        }
      }
      if (!viable) continue; // can't reach every target even with this anchor

      const injectCost: NonNullable<HubCandidate['injectCost']> = [];
      for (const T of targets) {
        if (!variable.has(T)) {
          const combos = base.get(T)!;
          injectCost.push({ target: T, combos, direct: combos === 1 });
          continue;
        }
        const combos = combosByTarget.get(T)!;
        injectCost.push({ target: T, combos, direct: combos === 1 });
        runningScore += combos;
      }

      hubs.push({
        species: H,
        obtainCost: obtainPlan.cost,
        ...(obtainPlan.passivePlan !== undefined && { obtainPassivePlan: obtainPlan.passivePlan }),
        injectCost,
        score: runningScore,
      });
      recordScore(runningScore);
    }
    // Tiebreak on original candidate index so the ranking is identical to an exhaustive
    // rankTable-order sweep, independent of the pruning-favorable evaluation order above.
    hubs.sort((a, b) => a.score! - b.score! || candidateIndex.get(a.species)! - candidateIndex.get(b.species)!);
    return { hubs: hubs.slice(0, maxHubs) };
  }

  const directIdx = buildDirectChildIndex(ruleset);
  const hubs: HubCandidate[] = [];
  for (const H of candidates) {
    const breadth = directIdx.get(H)?.size ?? 0;
    if (breadth === 0) continue; // can't directly parent anything -> useless as a carrier

    const obtainPlan = resultFromContext(ruleset, roster, H, baseCtx, speciesOpts, false);
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
