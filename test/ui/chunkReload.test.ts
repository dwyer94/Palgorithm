import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimReloadAttempt,
  isChunkLoadError,
  RELOAD_GUARD_KEY,
  RELOAD_GUARD_WINDOW_MS,
} from '../../src/ui/chunkReload';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('isChunkLoadError', () => {
  it('matches the browser messages for a failed lazy import', () => {
    // Chrome — the exact message from the 2026-07-28 production report (PALGORITHM-6).
    expect(
      isChunkLoadError({
        message:
          'Failed to fetch dynamically imported module: https://www.palgorithm.dev/assets/ReferenceBubbles-ezhPzdhj.js',
      }),
    ).toBe(true);
    // Safari and Firefox word the same failure differently.
    expect(isChunkLoadError({ message: 'Importing a module script failed.' })).toBe(true);
    expect(isChunkLoadError({ message: 'Loading chunk 42 failed.' })).toBe(true);
  });

  it('leaves ordinary render crashes alone', () => {
    expect(isChunkLoadError({ message: "Cannot read properties of null (reading 'toFixed')" })).toBe(false);
    expect(isChunkLoadError({})).toBe(false);
  });
});

describe('claimReloadAttempt', () => {
  it('allows the first reload and records when it happened', () => {
    expect(claimReloadAttempt(1_000_000)).toBe(true);
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('1000000');
  });

  it('refuses a second reload inside the guard window', () => {
    expect(claimReloadAttempt(1_000_000)).toBe(true);
    expect(claimReloadAttempt(1_000_000 + RELOAD_GUARD_WINDOW_MS - 1)).toBe(false);
  });

  /** The regression this module exists for. The previous guard was cleared by a 5s timer armed
   * at boot, so it only bounded the loop when the import rejected within those 5 seconds. A
   * hanging connection rejects far later, and every reload then found a cleared flag — fail,
   * reload, fail, reload, forever. The window is measured from the reload itself, so a slow
   * failure can no longer outlast its own guard. */
  it('refuses a reload when a slow import rejects long after boot', () => {
    expect(claimReloadAttempt(1_000_000)).toBe(true);
    // 30s later: well past the old 5s clear, still inside the guard window.
    expect(claimReloadAttempt(1_000_000 + 30_000)).toBe(false);
  });

  it('grants a fresh reload once the window has passed, for a later deploy in the same tab', () => {
    expect(claimReloadAttempt(1_000_000)).toBe(true);
    expect(claimReloadAttempt(1_000_000 + RELOAD_GUARD_WINDOW_MS + 1)).toBe(true);
  });

  it('treats an unparseable or legacy guard value as no recent reload, then normalizes it', () => {
    // '1' is what the previous implementation wrote; a tab carrying one over shouldn't be
    // permanently barred from recovering.
    sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
    expect(claimReloadAttempt(1_000_000)).toBe(true);
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('1000000');

    sessionStorage.setItem(RELOAD_GUARD_KEY, 'not-a-timestamp');
    expect(claimReloadAttempt(2_000_000)).toBe(true);
    expect(sessionStorage.getItem(RELOAD_GUARD_KEY)).toBe('2000000');
  });

  it('declines to reload when sessionStorage is unavailable', () => {
    // No way to record the attempt means no way to bound a loop, so it must not reload.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(claimReloadAttempt(1_000_000)).toBe(false);
  });
});
