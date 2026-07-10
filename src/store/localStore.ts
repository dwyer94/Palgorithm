import { DEFAULT_SETTINGS, type Settings, type RosterEntry, type SavedPlan, type StoreState } from './types';

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
let settingsCache: Settings | null = null;
let selectedPlayerIdsCache: string[] | null = null;

window.addEventListener('storage', (e) => {
  if (e.key === KEYS.roster) rosterCache = null;
  else if (e.key === KEYS.savedPlans) savedPlansCache = null;
  else if (e.key === KEYS.settings) settingsCache = null;
  else if (e.key === KEYS.selectedPlayerIds) selectedPlayerIdsCache = null;
  else return;
  notify();
});

export function getRoster(): RosterEntry[] {
  if (rosterCache === null) rosterCache = parse<RosterEntry[]>(localStorage.getItem(KEYS.roster), []);
  return rosterCache;
}

export function setRoster(roster: RosterEntry[]): void {
  rosterCache = roster;
  write(KEYS.roster, roster);
  notify();
}

export function getSavedPlans(): SavedPlan[] {
  if (savedPlansCache === null) savedPlansCache = parse<SavedPlan[]>(localStorage.getItem(KEYS.savedPlans), []);
  return savedPlansCache;
}

export function setSavedPlans(plans: SavedPlan[]): void {
  savedPlansCache = plans;
  write(KEYS.savedPlans, plans);
  notify();
}

export function getSettings(): Settings {
  if (settingsCache === null) {
    settingsCache = { ...DEFAULT_SETTINGS, ...parse<Partial<Settings>>(localStorage.getItem(KEYS.settings), {}) };
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
    selectedPlayerIdsCache = parse<string[]>(localStorage.getItem(KEYS.selectedPlayerIds), []);
  }
  return selectedPlayerIdsCache;
}

export function setSelectedPlayerIds(ids: string[]): void {
  selectedPlayerIdsCache = ids;
  write(KEYS.selectedPlayerIds, ids);
  notify();
}

export function getState(): StoreState {
  return { roster: getRoster(), savedPlans: getSavedPlans(), settings: getSettings() };
}

export function newId(): string {
  return crypto.randomUUID();
}
