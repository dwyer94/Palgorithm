import type {
  Gender,
  GenderRatio,
  PassiveModel as PassiveModelData,
  SpeciesId,
} from '../data/schema';

/**
 * The swap seam (spec §4.2). This is the ONE interface that isolates all
 * game-version-specific breeding logic. `combirank-0.6` implements it now; a
 * `genrecomb-1.0` implementation swaps in on patch day (July 10) without the solver or
 * UI changing. CLAUDE.md invariant #1: breeding rules live ONLY behind this interface —
 * never hardcode CombiRank math, special combos, or passive odds anywhere else.
 */

export type { Gender, SpeciesId };

/** Passive identity used by the ruleset. Roster entries store passive ids (spec §6.3),
 * so the runtime signatures work in ids, not full catalog records. */
export type PassiveId = string;

/**
 * Server-dependent / non-deterministic contingency (spec §5). `combirank-0.6` ignores it,
 * but the type exists from day one so `genrecomb-1.0` — whose outcomes may vary by server
 * config — can accept it without changing the interface. Kept intentionally open.
 */
export interface ServerConfig {
  [key: string]: unknown;
}

/**
 * A single breeding edge as the solver consumes it: a probability distribution over
 * children, NEVER a bare child (CLAUDE.md invariant #2). Deterministic rulesets emit one
 * outcome at p=1; gender-dependent special combos with genders omitted emit a real split.
 */
export interface BreedingEdge {
  parentA: SpeciesId;
  parentB: SpeciesId;
  outcomes: { child: SpeciesId; p: number }[];
}

/**
 * Passive-inheritance model (spec §4.2 / §3.3). Wraps the loaded, flagged-provisional
 * distribution data (`verified:false` today) and adds the ruleset-owned odds computation.
 * The passive planner (session 0.4) consumes `landOdds`; it is version-specific math and
 * so lives behind the seam, but it invents no numbers — it only combines loaded dists
 * (CLAUDE.md: "Don't invent passive-inheritance percentages").
 */
export interface PassiveModel extends PassiveModelData {
  /**
   * Probability the child ends up with the desired passive set, given each parent's
   * passives. `exactSet` = exactly `desired` and nothing else; `supersetContaining` =
   * at least `desired` (may carry extras). Odds are maximized when the two parents
   * jointly hold exactly the desired four and nothing else (spec §3.3).
   */
  landOdds(
    parentA: PassiveId[],
    parentB: PassiveId[],
    desired: PassiveId[],
  ): { exactSet: number; supersetContaining: number };
}

export interface BreedingRuleset {
  /** e.g. "combirank-0.6", "genrecomb-1.0". */
  version: string;
  /**
   * True when species outcomes are a pure function of the two parents *and their genders*.
   * combirank-0.6 is deterministic in that scoped sense; gender-dependent special combos
   * still return a distribution when genders are omitted (see `forward`).
   */
  isDeterministic: boolean;

  /**
   * Forward lookup. Supply `genderA`/`genderB` to resolve gender-dependent special combos
   * to a single child; omit them and the edge carries the gender split as a distribution,
   * weighted by each species' `genderRatio` (loaded from data, not hardcoded 50/50).
   */
  forward(
    a: SpeciesId,
    b: SpeciesId,
    opts?: { genderA?: Gender; genderB?: Gender },
    ctx?: ServerConfig,
  ): BreedingEdge;

  /** Every ordered-into-canonical parent pair that can produce `target` with p > 0. */
  reverse(target: SpeciesId, ctx?: ServerConfig): { parentA: SpeciesId; parentB: SpeciesId }[];

  rankTable: Record<SpeciesId, number>;
  specialCombos: {
    parents: [SpeciesId, SpeciesId];
    child: SpeciesId;
    genderRule?: { femaleParent: SpeciesId; child: SpeciesId } | null;
  }[];

  /**
   * Three-way reachability (spec §3.2). Only `wildCatchable` species may be suggested as a
   * catch/anchor; `otherObtainOnly` are valid parents solely when already owned.
   */
  reachability: {
    standardBreedable: Set<SpeciesId>;
    wildCatchable: Set<SpeciesId>;
    otherObtainOnly: Set<SpeciesId>;
  };

  passiveModel: PassiveModel;
}

/** Re-exported for implementations that need the ratio shape. */
export type { GenderRatio };
