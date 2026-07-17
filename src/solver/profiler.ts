/** Opt-in span profiler for characterizing solver perf (single-target path only, for now).
 * Module-level rather than threaded through every function signature: `time()` is a no-op
 * unless a `withProfiling` call is active anywhere up the stack, so call sites in
 * `speciesPlanner`/`passivePlanner` can sprinkle it around expensive phases unconditionally
 * without adding a parameter to every function or costing anything for callers (hubFinder's
 * sweep, tests) that never opt in. */

export interface ProfileSpan {
  label: string;
  ms: number;
  children: ProfileSpan[];
}

let active: { stack: ProfileSpan[]; roots: ProfileSpan[] } | null = null;

/** Runs `fn` with span-timing enabled for every `time()` call in its call tree, returning
 * both `fn`'s result and the captured span tree. Re-entrant calls aren't expected — a worker
 * handles one request at a time to completion — so a nested `withProfiling` throws rather
 * than silently corrupting or nesting into the outer profile. */
export function withProfiling<T>(fn: () => T): { result: T; profile: ProfileSpan[] } {
  if (active) throw new Error('withProfiling: already profiling (re-entrant call)');
  active = { stack: [], roots: [] };
  try {
    return { result: fn(), profile: active.roots };
  } finally {
    active = null;
  }
}

/** Times `fn` as a named span nested under whatever span is currently open, if profiling is
 * active; otherwise just calls `fn` directly with zero overhead. */
export function time<T>(label: string, fn: () => T): T {
  if (!active) return fn();
  const span: ProfileSpan = { label, ms: 0, children: [] };
  const parent = active.stack[active.stack.length - 1];
  (parent ? parent.children : active.roots).push(span);
  active.stack.push(span);
  const start = performance.now();
  try {
    return fn();
  } finally {
    span.ms = performance.now() - start;
    active.stack.pop();
  }
}
