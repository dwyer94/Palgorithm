import { useCallback, useMemo, useSyncExternalStore } from 'react';
import {
  getRoster,
  getSavedPlans,
  getSelectedPlayerIds,
  getSettings,
  setRoster,
  setSavedPlans,
  setSelectedPlayerIds,
  setSettings,
  subscribe,
} from './localStore';
import type { RosterEntry, SavedPlan, Settings } from './types';

/** React bindings over the plain localStorage store (spec §4.5). Each hook returns the
 * current value and a setter; consumers re-render on any store change via subscribe(). */

export function useRoster(): [RosterEntry[], (roster: RosterEntry[]) => void] {
  const roster = useSyncExternalStore(subscribe, getRoster);
  const set = useCallback((next: RosterEntry[]) => setRoster(next), []);
  return [roster, set];
}

export function useSavedPlans(): [SavedPlan[], (plans: SavedPlan[]) => void] {
  const plans = useSyncExternalStore(subscribe, getSavedPlans);
  const set = useCallback((next: SavedPlan[]) => setSavedPlans(next), []);
  return [plans, set];
}

export function useSettings(): [Settings, (settings: Settings) => void] {
  const settings = useSyncExternalStore(subscribe, getSettings);
  const set = useCallback((next: Settings) => setSettings(next), []);
  return [settings, set];
}

export function useSelectedPlayerIds(): [Set<string>, (ids: Set<string>) => void] {
  const ids = useSyncExternalStore(subscribe, getSelectedPlayerIds);
  const idsSet = useMemo(() => new Set(ids), [ids]);
  const set = useCallback((next: Set<string>) => setSelectedPlayerIds([...next]), []);
  return [idsSet, set];
}
