import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The regression these cover: a non-array under a list key used to be handed straight to the
 * views, which map over it immediately. For a signed-out user that value is already on disk,
 * so the crash repeated on every load with no in-app way out — the roster view that could fix
 * it was itself one of the crashing components (Sentry PALGORITHM-8).
 *
 * localStore caches module-level, so each case needs a fresh module instance.
 */
async function freshStore(seed: Record<string, string>) {
  localStorage.clear();
  for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
  vi.resetModules();
  return import('../../src/store/localStore');
}

beforeEach(() => {
  localStorage.clear();
});

describe('list-shaped keys survive a corrupt value', () => {
  it.each([
    ['an object', '{"roster":[]}'],
    ['a string', '"lamball"'],
    ['a number', '42'],
    ['null', 'null'],
    ['invalid JSON', '{not json'],
  ])('getRoster falls back to empty for %s', async (_label, raw) => {
    const store = await freshStore({ 'palcalc.roster': raw });
    expect(store.getRoster()).toEqual([]);
  });

  it('falls back for savedPlans, teams and selectedPlayerIds too', async () => {
    const store = await freshStore({
      'palcalc.savedPlans': '{}',
      'palcalc.teams': '"nope"',
      'palcalc.selectedPlayerIds': '5',
    });
    expect(store.getSavedPlans()).toEqual([]);
    expect(store.getTeams()).toEqual([]);
    expect(store.getSelectedPlayerIds()).toEqual([]);
  });

  it('still reads a valid array', async () => {
    const roster = [{ id: 'a', species: 'lamball', gender: 'male', passives: [] }];
    const store = await freshStore({ 'palcalc.roster': JSON.stringify(roster) });
    expect(store.getRoster()).toEqual(roster);
  });

  it('leaves the rejected value on disk rather than overwriting it', async () => {
    const store = await freshStore({ 'palcalc.roster': '{"roster":[]}' });
    store.getRoster();
    expect(localStorage.getItem('palcalc.roster')).toBe('{"roster":[]}');
  });
});

describe('settings merge', () => {
  it('falls back to defaults when the stored value is not an object', async () => {
    const store = await freshStore({ 'palcalc.settings': '[1,2,3]' });
    const { DEFAULT_SETTINGS } = await import('../../src/store/types');
    expect(store.getSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in a partial or junk `live` from defaults', async () => {
    const { DEFAULT_SETTINGS } = await import('../../src/store/types');
    const store = await freshStore({ 'palcalc.settings': '{"live":"broken"}' });
    expect(store.getSettings().live).toEqual(DEFAULT_SETTINGS.live);

    const partial = await freshStore({ 'palcalc.settings': '{"live":{"enabled":true}}' });
    expect(partial.getSettings().live).toEqual({ ...DEFAULT_SETTINGS.live, enabled: true });
  });

  it('keeps stored top-level values that are present', async () => {
    const store = await freshStore({ 'palcalc.settings': '{"iconDisplayMode":"full"}' });
    expect(store.getSettings().iconDisplayMode).toBe('full');
  });

  it('does not let a stored __proto__ key pollute Object.prototype', async () => {
    const store = await freshStore({ 'palcalc.settings': '{"__proto__":{"polluted":true}}' });
    store.getSettings();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
