import type { HubFinderOptions, HubFinderResult, PassiveId, RosterEntry, SpeciesId, SpeciesPlannerOptions, UnionPlanResult } from '../types';
import type { SingleTargetPlanRun } from '../runSingleTargetPlan';
import type { SolverRequest, SolverRequestPayload, SolverResponse } from './protocol';

/** Thrown to a request when its own `cancel()` runs — lets a caller's catch block tell "this
 * call was cancelled" apart from a genuine solver error. */
export class SolverCancelledError extends Error {
  constructor() {
    super('Solve cancelled');
    this.name = 'SolverCancelledError';
  }
}

export interface SolverTask<T> {
  promise: Promise<T>;
  /** Cancels just this call, never any other caller's in-flight request. If this is the one
   * currently executing in the worker, the worker (which can't be preempted mid-solve, only
   * killed) is terminated and recreated; anything else still queued behind it never touched
   * that worker instance and is simply posted to the fresh one in turn. A no-op if this call
   * already settled. */
  cancel: () => void;
}

interface QueueItem {
  id: number;
  req: SolverRequestPayload;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

// Module-level singleton: one worker shared by every view (SingleTargetView, HubView,
// TeamDetailView). A worker processes one message at a time anyway, so requests are queued
// here and sent one at a time — `current` is the sole request actually posted to the worker;
// everything else in `queue` hasn't been sent yet, so cancelling it never requires touching
// the worker at all.
let worker: Worker | null = null;
let nextId = 1;
let current: QueueItem | null = null;
const queue: QueueItem[] = [];

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./solver.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = handleMessage;
    worker.onerror = handleWorkerError;
  }
  return worker;
}

function pump(): void {
  if (current || queue.length === 0) return;
  current = queue.shift()!;
  ensureWorker().postMessage({ ...current.req, id: current.id } as SolverRequest);
}

function handleMessage(event: MessageEvent<SolverResponse>): void {
  const res = event.data;
  if (!current || current.id !== res.id) return; // stale response from a since-terminated/recreated worker — ignore
  const item = current;
  current = null;
  if (res.ok) item.resolve(res.kind === 'warmup' ? undefined : res.result);
  else item.reject(new Error(res.error));
  pump();
}

function handleWorkerError(event: ErrorEvent): void {
  // An uncaught exception in the worker (a real bug, not a rejected solve) leaves it in an
  // unknown state — fail only the request that was actually running, then drop the worker so
  // the next call recreates it. Anything still queued never reached that broken instance, so
  // it's safe to hand to the fresh one instead of failing it too.
  const err = new Error(event.message || 'Solver worker error');
  const failed = current;
  current = null;
  worker?.terminate();
  worker = null;
  failed?.reject(err);
  pump();
}

function request<T>(req: SolverRequestPayload): SolverTask<T> {
  const id = nextId++;
  let resolveFn!: (value: T) => void;
  let rejectFn!: (reason: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  const item: QueueItem = { id, req, resolve: resolveFn as (value: unknown) => void, reject: rejectFn };
  queue.push(item);
  pump();

  return {
    promise,
    cancel: () => {
      const qIdx = queue.indexOf(item);
      if (qIdx !== -1) {
        queue.splice(qIdx, 1);
        item.reject(new SolverCancelledError());
        return;
      }
      if (current === item) {
        current = null;
        worker?.terminate();
        worker = null;
        item.reject(new SolverCancelledError());
        pump();
      }
      // Otherwise this call already settled — nothing to cancel.
    },
  };
}

export const solverWorker = {
  runSingleTarget(
    roster: RosterEntry[],
    target: SpeciesId,
    desiredPassives: PassiveId[],
    options: SpeciesPlannerOptions,
  ): SolverTask<SingleTargetPlanRun> {
    return request({ kind: 'singleTarget', roster, target, desiredPassives, options });
  },
  runUnion(roster: RosterEntry[], targets: SpeciesId[], options: SpeciesPlannerOptions): SolverTask<UnionPlanResult> {
    return request({ kind: 'union', roster, targets, options });
  },
  runHubs(roster: RosterEntry[], options: HubFinderOptions): SolverTask<HubFinderResult> {
    return request({ kind: 'hubs', roster, options });
  },
  warmup(): SolverTask<void> {
    return request({ kind: 'warmup' });
  },
};
