import type { Gender, SpeciesId } from '../ruleset/types';

export type { Gender, SpeciesId };

/** One individual the user currently owns — supplies its species+gender at cost 0. */
export interface RosterEntry {
  species: SpeciesId;
  gender: Gender;
}

export interface SpeciesPlannerOptions {
  /** Cost charged for catching one individual of a `wildCatchable` species. Default 1 —
   * same unit as a breeding combination, so catches and combos trade off in the same
   * cost space. */
  catchCost?: number;
  /** Set false to disallow catching entirely (roster-only planning). Default true. */
  allowCatching?: boolean;
}

/** A specific individual required as one side of a combination. */
export interface PlanIndividual {
  species: SpeciesId;
  gender: Gender;
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
}
