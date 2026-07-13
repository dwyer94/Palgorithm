import type { Gender, PassiveId, SpeciesId } from '../ruleset/types';

export type { Gender, PassiveId, SpeciesId };

/** One individual the user currently owns — supplies its species+gender at cost 0. */
export interface RosterEntry {
  species: SpeciesId;
  gender: Gender;
  /** Passives this specific individual carries. Omitted/empty for a "clean" individual —
   * only meaningful when the planner is given `desiredPassives` (spec §7.3). */
  passives?: PassiveId[];
}

export interface SpeciesPlannerOptions {
  /** Cost charged for catching one individual of a `wildCatchable` species. Default 1 —
   * same unit as a breeding combination, so catches and combos trade off in the same
   * cost space. */
  catchCost?: number;
  /** Set true to allow catching wild-catchable species as a cost-`catchCost` substitute
   * for breeding them. Default false (roster-only planning) — with most of the real
   * dataset flagged wildCatchable, leaving this on by default let the solver bypass
   * breeding for almost any target, defeating the point of a breeding-path optimizer. */
  allowCatching?: boolean;
  /**
   * Species to exclude from the catch shortcut even when `allowCatching` is true — they
   * must be reached by breeding. Everything else stays catchable as bootstrap/fodder
   * stock. Useful when the point of the plan is specifically to show a bred path to a
   * particular species (e.g. suggestHubs.ts's empty-roster baseline needs *some*
   * catchable stock to search from, while still forcing a real derivation for the
   * species it's actually recommending toward).
   */
  excludeFromCatching?: SpeciesId[];
  /**
   * `planUnion`/`findHubs` only: exclude each target from catching only while solving
   * *for that target* — other targets in the same batch stay legitimately catchable and
   * may serve as parents. Some apex/legendary species are only reachable by breeding
   * FROM each other via special combos; excluding a whole target batch from catching at
   * once (via `excludeFromCatching`) creates an unsolvable cycle in that case, but
   * excluding just the current target as it's evaluated doesn't. No-op on bare
   * `planSpecies` calls (single target, nothing to exclude "the rest" from).
   */
  excludeTargetsFromCatching?: boolean;
  /**
   * Desired final-cross perk set (spec §7.3). When supplied and the target requires at
   * least one combination, the planner treats species-cost and passives as a joint
   * pick among cost-tied final-parent candidates: among the parent pairs that all
   * achieve the minimum `combinationCount`, it picks whichever maximizes passive-landing
   * odds, preferring roster individuals with matching passives for whichever final-cross
   * slot they can fill. Perks are injected at the final cross only (spec §7.3's "inject
   * at final cross, not upstream") — passives are not tracked through intermediate
   * breeds in this planner, so a produced-not-owned final parent is assumed clean.
   * Omit to get the passive-agnostic plan (0.3 behavior).
   */
  desiredPassives?: PassiveId[];
  /**
   * Treat gender as a non-constraint: Palworld has an item that changes a Pal's gender, so
   * any owned/caught/bred individual can be flipped to whichever gender a combo needs before
   * breeding it. Default false (gender-accurate planning, spec's normal reachability model) —
   * on, this stops a species being short one gender (either naturally, per `genderRatio`, or
   * just because the roster/catch/produced individual happened to hatch the "wrong" one) from
   * ever gating reachability or forcing an extra breed purely to get the right gender.
   */
  ignoreGender?: boolean;
}

/** A specific individual required as one side of a combination. */
export interface PlanIndividual {
  species: SpeciesId;
  gender: Gender;
  /** Passives this individual is assumed to carry. Only populated when the plan was
   * computed with `desiredPassives`; empty/omitted otherwise or when the individual is
   * produced rather than roster-supplied (clean-carrier assumption, spec §7.3). */
  passives?: PassiveId[];
}

/** One distinct breeding combination in the plan (spec §7.4). */
export interface SpeciesPlanStep {
  parentA: PlanIndividual;
  parentB: PlanIndividual;
  child: SpeciesId;
}

/** A candidate anchor that would unlock an otherwise-unreachable target (spec §7.1's
 * "need an anchor of rank ≤ X" result) — guidance, not a guaranteed-minimal set. */
export interface AnchorHint {
  species: SpeciesId;
  rank: number | null;
  gender: Gender;
  /** Combination-count cost of the target if this species were owned at cost 0. */
  resultingCost: number;
}

/** The perk overlay on the final cross (spec §7.3) — attached to `SpeciesPlanResult` when
 * the planner was given `desiredPassives` and the target needs at least one combination. */
export interface PassivePlanResult {
  desired: PassiveId[];
  /** Per-egg odds of the final cross landing exactly `desired` (and nothing else) /
   * at least `desired` (may carry extras). */
  landOdds: { exactSet: number; supersetContaining: number };
  /** Expected eggs (1/p) to hit each bar. Infinity when the corresponding odds are 0. */
  expectedEggs: { exactSet: number; supersetContaining: number };
  /** The two final-cross parents the planner selected. `passives` is the specific roster
   * individual's set when that slot was roster-supplied at cost 0, or empty when the slot
   * is produced/caught (clean-carrier assumption — perks aren't tracked through
   * intermediates in this planner). */
  finalParentA: PlanIndividual;
  finalParentB: PlanIndividual;
  /** Passives either final parent carries outside `desired` — lowers the odds (spec §7.3
   * "flag pollution"), surfaced rather than auto-resolved. */
  pollution: { parentA: PassiveId[]; parentB: PassiveId[] };
  /** Desired passives present on NEITHER final parent — this planner only injects perks at
   * the final cross (clean-carrier assumption above), so these have zero path into the plan
   * even though `landOdds` may still report a nonzero number for the rest of the set. Surfaced
   * explicitly rather than left as an unexplained low percentage. */
  unassigned: PassiveId[];
}

/** Explains how the baseline (cheapest, "full stop") plan relates to `desiredPassives` when
 * it couldn't attach a `passivePlan` — always present alongside `passivePlan` being absent, so
 * "no passivePlan" never means "silently figure out why yourself" (session: single-target
 * transparency pass). `owned-exact-match` and `owned-partial-match` are deliberately NOT treated
 * as "nothing more to compute" — even an exact match still gets a real answer from
 * `computeGuaranteedCarrierOutcome` (passivePlanner.ts) for "what's the best route to breed
 * another one", just annotated here so the UI can also say "you already own this" up top. */
export type BaselinePassiveNote =
  | { status: 'owned-exact-match' }
  | { status: 'owned-partial-match'; ownedPassives: PassiveId[] }
  | { status: 'cheapest-route-is-catch' }
  | { status: 'planned' };

export interface SpeciesPlanResult {
  target: SpeciesId;
  feasible: boolean;
  /** Distinct breeding combinations needed, shared intermediates counted once
   * (CLAUDE.md invariant #4). Infinity when infeasible. */
  combinationCount: number;
  /** Total cost including catches (same unit as combinationCount). Infinity when infeasible. */
  cost: number;
  /** Ordered so every step's parents are already available (owned, caught, or produced by
   * an earlier step) by the time the step runs. */
  steps: SpeciesPlanStep[];
  /** Wild-caught individuals the plan depends on. */
  catches: PlanIndividual[];
  /** Present only when `feasible` is false: candidate anchors that would unlock the
   * target, nearest-rank-first. Empty if none was found. */
  anchorHints?: AnchorHint[];
  /** Present only when the planner was given `desiredPassives` and the target needs at
   * least one combination (spec §7.3). */
  passivePlan?: PassivePlanResult;
  /** Present iff `desiredPassives.length > 0 && feasible` — explains the baseline's
   * relationship to the desired perks, always populated even when `passivePlan` isn't (see
   * `BaselinePassiveNote`'s doc comment). */
  passiveNote?: BaselinePassiveNote;
}

/** Result of `findForcedCarrierRoute` (spec §7.3 mode 2b, the guaranteed-carrier overlay).
 * Extends the plain species-plan shape with which of the caller's requested passives the
 * route actually threads into the lineage, and which real owned individuals it used. */
export interface ForcedCarrierResult extends SpeciesPlanResult {
  /** Subset of the caller's requested passives this route provably carries into the target,
   * in the caller's array order. Empty iff `feasible` is false. */
  routedPassives: PassiveId[];
  /** True iff every requested passive was jointly routed (`routedPassives.length` equals the
   * caller's requested count) — false means only the largest routable subset was found (spec
   * §7.3's "partial routing"). */
  fullyRouted: boolean;
  /** Real roster individuals found on the reconstructed lineage. */
  carrierLeaves: RosterEntry[];
}

/** Multi-target species plan (spec §7.2's "baseline, always produced" plan). Each target
 * is solved against the same roster, then the per-target steps/catches are merged and
 * deduped so an intermediate shared by several targets is still counted once. */
export interface UnionPlanResult {
  targets: SpeciesId[];
  /** True only if every target is individually feasible. */
  feasible: boolean;
  /** Each target's own plan (its `anchorHints` surface per-target infeasibility). */
  perTarget: SpeciesPlanResult[];
  /** Distinct combinations across ALL targets, shared intermediates counted once
   * (CLAUDE.md invariant #4) — computed over whichever targets are feasible. */
  combinationCount: number;
  cost: number;
  /** Topologically ordered so every step's parents are already available. */
  steps: SpeciesPlanStep[];
  catches: PlanIndividual[];
}

export interface HubFinderOptions extends SpeciesPlannerOptions {
  /**
   * Fixed-target mode (spec §7.2): score candidate hubs by
   * `obtainCost(H) + Σ injectCost(H → Ti)` across these targets. Omit for general-reach
   * mode — rank hubs by structural breadth instead (how many species this hub could
   * directly parent), useful before you've picked specific targets ("I have good perks on
   * a bad host, what's a good general-purpose carrier").
   */
  targets?: SpeciesId[];
  /** Cap on how many ranked candidates to return. Default 5. */
  maxHubs?: number;
  /**
   * Restrict the hub search to these species instead of sweeping every breed-capable
   * species in `rankTable`. Meant for re-scoring a small precomputed shortlist (e.g. a
   * suggested-hub quick-pick) against the live roster without paying for a full sweep —
   * omit for the normal exhaustive search.
   */
  candidates?: SpeciesId[];
}

/** One ranked hub candidate (spec §7.2) — an optional overlay on the union plan, never
 * forced. */
export interface HubCandidate {
  species: SpeciesId;
  /** Cost (combinations + weighted catches) to obtain this species from the current
   * roster. Computed with `desiredPassives` at the final cross when supplied, so a hub
   * that's cheap in species terms but expensive to load with the right perks doesn't rank
   * artificially high. */
  obtainCost: number;
  /** Present only when `desiredPassives` was supplied and obtaining this hub needed at
   * least one combination — the perk-landing overlay for that final cross. */
  obtainPassivePlan?: PassivePlanResult;
  /**
   * Fixed-target mode only. Per-target combos needed to go from "H is available" to
   * producing that target. `direct: true` (combos === 1) means H is a **direct parent** —
   * the single-final-cross shape spec §7.2 strongly prefers, since perks don't have to
   * survive any extra inheritance rolls; `direct: false` means the branch reaches the
   * target only through intermediates and is worth less for that reason.
   */
  injectCost?: { target: SpeciesId; combos: number; direct: boolean }[];
  /** Fixed-target mode: `obtainCost + Σ injectCost.combos`, primary sort key (lower is
   * better). Absent in general-reach mode — use `breadth`/`obtainCost` instead. */
  score?: number;
  /**
   * General-reach mode only: how many distinct breed-capable species this hub can
   * directly parent (one cross), primary sort key (higher is better). Purely structural —
   * the dataset carries no reliable role/category tag (its `category` field is a freeform
   * optional string), so this doesn't know "combat" from "mount" from "worker"; you judge
   * which of the reached species are the ones you actually care about.
   */
  breadth?: number;
}

export interface HubFinderResult {
  /** Ranked candidates, best first (fixed-target mode: lowest `score`; general-reach mode:
   * highest `breadth`). */
  hubs: HubCandidate[];
}
