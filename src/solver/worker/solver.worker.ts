import rawDataset from '../../data/dataset.1.0.json';
import { parseDataset } from '../../data/loader';
import { createRuleset } from '../../ruleset';
import { warmGraphCache } from '../speciesPlanner';
import { runSingleTargetPlan } from '../runSingleTargetPlan';
import { planUnion, findHubs } from '../hubFinder';
import type { SolverRequest, SolverResponse } from './protocol';

/** Dedicated worker for every solve (findings-doc P0 fix). Builds its own ruleset from the
 * same bundled dataset the main thread uses — never receives the live `ruleset` object,
 * which isn't postMessage-safe (carries functions + `Set`s). `warmGraphCache` runs eagerly
 * at module load so the combination hypergraph is already built by the time the first real
 * request arrives (subsumes the findings doc's #6 cold-start item, now off the main thread
 * entirely instead of merely deferred on it). */
const ruleset = createRuleset(parseDataset(rawDataset));
warmGraphCache(ruleset);

/** Minimal structural typing for the dedicated-worker global scope, sized to exactly what
 * this file needs — avoids adding the `webworker` lib project-wide, which conflicts with
 * the app's `dom` lib (both declare incompatible `self`/`postMessage` globals). */
interface WorkerContext {
  postMessage(message: SolverResponse): void;
  onmessage: ((event: MessageEvent<SolverRequest>) => void) | null;
}
const ctx = self as unknown as WorkerContext;

ctx.onmessage = (event) => {
  const req = event.data;
  try {
    let response: SolverResponse;
    switch (req.kind) {
      case 'singleTarget':
        response = {
          id: req.id,
          ok: true,
          kind: 'singleTarget',
          result: runSingleTargetPlan(ruleset, req.roster, req.target, req.desiredPassives, req.options),
        };
        break;
      case 'union':
        response = { id: req.id, ok: true, kind: 'union', result: planUnion(ruleset, req.roster, req.targets, req.options) };
        break;
      case 'hubs':
        response = { id: req.id, ok: true, kind: 'hubs', result: findHubs(ruleset, req.roster, req.options) };
        break;
      case 'warmup':
        response = { id: req.id, ok: true, kind: 'warmup' };
        break;
      default: {
        // TS narrows `req` to `never` here since the union above is exhaustive today — this
        // arm only fires if a future/stale build sends a `kind` this build doesn't know about
        // (e.g. a stale PWA-cached worker chunk after a deploy), so it's a defensive runtime
        // guard, not dead code (post-Phase-5 code review finding #1).
        const unknownReq = req as { id: number; kind: string };
        response = { id: unknownReq.id, ok: false, error: `Unknown request kind: ${unknownReq.kind}` };
      }
    }
    ctx.postMessage(response);
  } catch (err) {
    ctx.postMessage({ id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
