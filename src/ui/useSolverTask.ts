import { useCallback, useRef, useState } from 'react';
import { SolverCancelledError, type SolverTask } from '../solver/worker/client';

interface RunHandlers<T> {
  onSuccess: (result: T) => void;
  /** Fires for a real failure (never for a user-initiated cancel) alongside the hook's own
   * `error` state — use it for side effects (logging, clearing other state) that need to run
   * in addition to, not instead of, error tracking. */
  onError?: (err: unknown) => void;
}

/** Every solver call site (SingleTargetView, HubView x2, one per Team slot) repeats the same
 * set-loading / post-request / distinguish-cancel-from-real-error / clear-loading lifecycle
 * around a `SolverTask` (`worker/client.ts`). This is that lifecycle, keyed so one hook
 * instance can track any number of concurrent in-flight requests — `useSolverTask()` below is
 * just this with the key fixed, for the call sites that only ever have one request in flight
 * at a time. */
export function useKeyedSolverTasks<K>() {
  const [planningKeys, setPlanningKeys] = useState<Set<K>>(new Set());
  const [errors, setErrors] = useState<Map<K, string>>(new Map());
  const activeCancels = useRef<Map<K, () => void>>(new Map());

  const run = useCallback(<T,>(key: K, start: () => SolverTask<T>, handlers: RunHandlers<T>) => {
    setPlanningKeys((prev) => new Set(prev).add(key));
    setErrors((prev) => {
      if (!prev.has(key)) return prev;
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    const task = start();
    activeCancels.current.set(key, task.cancel);
    task.promise
      .then(handlers.onSuccess)
      .catch((err: unknown) => {
        if (err instanceof SolverCancelledError) return; // user cancelled — leave prior state as-is
        setErrors((prev) => new Map(prev).set(key, err instanceof Error ? err.message : String(err)));
        handlers.onError?.(err);
      })
      .finally(() => {
        activeCancels.current.delete(key);
        setPlanningKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
  }, []);

  const cancel = useCallback((key: K) => activeCancels.current.get(key)?.(), []);
  const isPlanning = useCallback((key: K) => planningKeys.has(key), [planningKeys]);
  const error = useCallback((key: K) => errors.get(key), [errors]);

  return { isPlanning, error, run, cancel };
}

const SINGLE_KEY = 0;

export interface UseSolverTaskResult {
  isPlanning: boolean;
  error: string | null;
  run: <T>(start: () => SolverTask<T>, handlers: RunHandlers<T>) => void;
  cancel: () => void;
}

/** `useKeyedSolverTasks` with the key fixed to one slot — for call sites that only ever have a
 * single request in flight (SingleTargetView's plan, HubView's run-plan/apply-suggestion pair,
 * HubView's search-all-hubs). Team Detail's per-party-slot solves use the keyed form directly
 * since up to `TEAM_SLOT_COUNT` of them can be in flight at once. */
export function useSolverTask(): UseSolverTaskResult {
  const tasks = useKeyedSolverTasks<number>();
  return {
    isPlanning: tasks.isPlanning(SINGLE_KEY),
    error: tasks.error(SINGLE_KEY) ?? null,
    run: (start, handlers) => tasks.run(SINGLE_KEY, start, handlers),
    cancel: () => tasks.cancel(SINGLE_KEY),
  };
}
