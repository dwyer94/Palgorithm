import { DEFAULT_SETTINGS, type Settings, type RosterEntry, type SavedPlan, type Team, type StoreState } from './types';

/**
 * localStorage-backed persistence (spec §4.5). Plain read/write functions plus a tiny
 * subscribe mechanism so React views can re-render on change without a state library.
 *
 * Values are cached in memory and only re-parsed on an actual write (or a `storage` event
 * from another tab) — `useSyncExternalStore` requires `getSnapshot` to return a stable
 * reference between notifications, or React re-renders forever.
 */

const KEYS = {
  roster: 'palcalc.roster',
  savedPlans: 'palcalc.savedPlans',
  teams: 'palcalc.teams',
  settings: 'palcalc.settings',
  selectedPlayerIds: 'palcalc.selectedPlayerIds',
} as const;

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * `parse` for the four list-shaped keys, with the cast actually checked.
 *
 * Every consumer of these treats the result as an array and maps over it immediately, so a
 * stored value of any other shape is not a degraded read — it's an unrecoverable one. The
 * views that could let a user fix it (RosterView, TeamsView) are themselves among the first
 * to crash, and for a signed-out user the bad value is already on disk, so it re-crashes on
 * every subsequent load: the app is bricked until localStorage is cleared by hand. That is
 * exactly what Sentry PALGORITHM-8 caught, one unvalidated roster import upstream of here.
 *
 * Falling back to empty is safe in a way that's worth being explicit about: it never
 * *deletes* anything. Nothing is written back until the user's next real edit, so a value
 * this rejects is still sitting in localStorage to be recovered manually if it ever mattered.
 *
 * Deliberately shallow — see src/store/validate.ts for why per-entry validation belongs at
 * the file-import boundary and not on every load.
 */
function parseArray<T>(raw: string | null): T[] {
  const value = parse<unknown>(raw, []);
  return Array.isArray(value) ? (value as T[]) : [];
}

/** The object-shaped counterpart to `parseArray`'s gate: anything that isn't a plain object
 * (an array, a primitive, null) merges as nothing rather than as index keys. */
function asObject<T>(value: unknown): Partial<T> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Partial<T>) : {};
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let rosterCache: RosterEntry[] | null = null;
let savedPlansCache: SavedPlan[] | null = null;
let teamsCache: Team[] | null = null;
let settingsCache: Settings | null = null;
let selectedPlayerIdsCache: string[] | null = null;

window.addEventListener('storage', (e) => {
  if (e.key === KEYS.roster) rosterCache = null;
  else if (e.key === KEYS.savedPlans) savedPlansCache = null;
  else if (e.key === KEYS.teams) teamsCache = null;
  else if (e.key === KEYS.settings) settingsCache = null;
  else if (e.key === KEYS.selectedPlayerIds) selectedPlayerIdsCache = null;
  else return;
  notify();
});

export function getRoster(): RosterEntry[] {
  if (rosterCache === null) rosterCache = parseArray<RosterEntry>(localStorage.getItem(KEYS.roster));
  return rosterCache;
}

export function setRoster(roster: RosterEntry[]): void {
  rosterCache = roster;
  write(KEYS.roster, roster);
  notify();
}

export function getSavedPlans(): SavedPlan[] {
  if (savedPlansCache === null) savedPlansCache = parseArray<SavedPlan>(localStorage.getItem(KEYS.savedPlans));
  return savedPlansCache;
}

export function setSavedPlans(plans: SavedPlan[]): void {
  savedPlansCache = plans;
  write(KEYS.savedPlans, plans);
  notify();
}

export function getTeams(): Team[] {
  if (teamsCache === null) teamsCache = parseArray<Team>(localStorage.getItem(KEYS.teams));
  return teamsCache;
}

export function setTeams(teams: Team[]): void {
  teamsCache = teams;
  write(KEYS.teams, teams);
  notify();
}

export function getSettings(): Settings {
  if (settingsCache === null) {
    // Same reasoning as `parseArray`, for the one object-shaped key: spreading a stored array
    // or primitive here wouldn't throw, but it would produce a `Settings` with index keys and
    // no `live` sub-object, and the first `settings.live.nameOverrides` read downstream would.
    //
    // Note this stays a *spread* of parsed JSON, not `Object.assign`. Spread defines own
    // properties; `Object.assign` invokes setters, which would make a stored `"__proto__"` key
    // (JSON.parse does create it as an own property) pollute Object.prototype. Cheap to keep,
    // easy to lose in a refactor.
    const partial = asObject<Settings>(parse<unknown>(localStorage.getItem(KEYS.settings), {}));
    settingsCache = {
      ...DEFAULT_SETTINGS,
      ...partial,
      // `live` is the one nested object, and the only sub-shape read through without a guard
      // downstream — merged over its defaults the same way remoteStore.ts:343 already does for
      // the cloud-backed copy, so a partial or junk `live` can't reach the UI missing a field.
      live: { ...DEFAULT_SETTINGS.live, ...asObject<Settings['live']>(partial.live) },
    };
  }
  return settingsCache;
}

export function setSettings(settings: Settings): void {
  settingsCache = settings;
  write(KEYS.settings, settings);
  notify();
}

export function getSelectedPlayerIds(): string[] {
  if (selectedPlayerIdsCache === null) {
    selectedPlayerIdsCache = parseArray<string>(localStorage.getItem(KEYS.selectedPlayerIds));
  }
  return selectedPlayerIdsCache;
}

export function setSelectedPlayerIds(ids: string[]): void {
  selectedPlayerIdsCache = ids;
  write(KEYS.selectedPlayerIds, ids);
  notify();
}

export function getState(): StoreState {
  return { roster: getRoster(), savedPlans: getSavedPlans(), teams: getTeams(), settings: getSettings() };
}

export function newId(): string {
  return crypto.randomUUID();
}

/** Best-effort ask for "persistent" storage (Storage API) so the browser is less likely to
 * auto-evict this origin's localStorage under storage pressure. No prompt, no guarantee — it
 * doesn't survive the user manually clearing site data, which is what the Team Builder
 * export/import (spec-adjacent, `TeamsView`) is actually for. */
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  void navigator.storage.persist();
}
