import type { HubFinderOptions, HubFinderResult, RosterEntry, SpeciesId, PassiveId, SpeciesPlannerOptions, UnionPlanResult } from '../types';
import type { SingleTargetPlanRun } from '../runSingleTargetPlan';

/** Message protocol for `solver.worker.ts` (findings-doc P0 fix: solver moved off the main
 * thread). Every request carries a caller-assigned id so out-of-order/late responses (e.g.
 * after a cancel recreated the worker) can be matched or discarded. Payloads are plain,
 * structured-cloneable data only — never the live `ruleset` (it carries functions/Sets and
 * isn't postMessage-safe); the worker rebuilds its own ruleset from the bundled dataset at
 * startup instead. */

export type SolverRequest =
  | { id: number; kind: 'singleTarget'; roster: RosterEntry[]; target: SpeciesId; desiredPassives: PassiveId[]; options: SpeciesPlannerOptions }
  | { id: number; kind: 'union'; roster: RosterEntry[]; targets: SpeciesId[]; options: SpeciesPlannerOptions }
  | { id: number; kind: 'hubs'; roster: RosterEntry[]; options: HubFinderOptions }
  | { id: number; kind: 'warmup' };

/** Plain `Omit<SolverRequest, 'id'>` collapses the union to its keys' intersection instead of
 * omitting 'id' from each member — this distributes properly so callers still get a
 * discriminated union to construct from. */
export type SolverRequestPayload = SolverRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export type SolverResponse =
  | { id: number; ok: true; kind: 'singleTarget'; result: SingleTargetPlanRun }
  | { id: number; ok: true; kind: 'union'; result: UnionPlanResult }
  | { id: number; ok: true; kind: 'hubs'; result: HubFinderResult }
  | { id: number; ok: true; kind: 'warmup' }
  | { id: number; ok: false; error: string };
