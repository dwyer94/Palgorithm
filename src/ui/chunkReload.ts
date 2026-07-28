/** Stale-chunk recovery for lazy `import()` failures (src/ui/ErrorBoundary.tsx).
 *
 * A tab left open across a deploy — or one that catches a brief CDN propagation window, as
 * happened 2026-07-18 — has a lazy import reference a chunk hash that 404s. That's staleness,
 * not a real crash, so the boundary reloads once instead of showing the crash screen.
 *
 * The guard below is what stops that recovery from becoming a reload loop when the failure
 * *isn't* staleness. It records when a reload was attempted rather than merely that one was:
 * the previous "boot a 5s timer, then clear the flag" approach only bounded the loop when the
 * import rejected within 5s of boot. A fast 404 does, but a hanging connection — the flaky
 * network this recovery exists for — takes tens of seconds to reject, by which point the flag
 * was already cleared and every reload was free to fail and reload again indefinitely.
 */

export const RELOAD_GUARD_KEY = 'palgorithm:chunk-reload-attempted';

/** How long a recorded reload suppresses another one. Long enough to cover a slow connection's
 * fetch timeout (so a hanging import can't outlast the guard and loop), short enough that a
 * later genuine deploy in the same tab still gets its one free recovery reload. */
export const RELOAD_GUARD_WINDOW_MS = 60_000;

export const CHUNK_LOAD_ERROR =
  /dynamically imported module|Importing a module script failed|Loading chunk .* failed/i;

export function isChunkLoadError(error: { message?: string }): boolean {
  return typeof error.message === 'string' && CHUNK_LOAD_ERROR.test(error.message);
}

/**
 * Records a reload attempt and reports whether the caller should go ahead with it.
 *
 * Returns false when a reload was already attempted inside the guard window, and false when
 * sessionStorage is unavailable (Safari private mode, storage-partitioned embeds) — with
 * nowhere to record the attempt there's no way to bound a loop, so declining is the safe
 * default. A missing or unparseable value is treated as "no recent reload": the caller gets
 * its one recovery, and the write below normalizes the slot to a real timestamp.
 */
export function claimReloadAttempt(now: number = Date.now()): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_GUARD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
