import { useCallback, useMemo, useSyncExternalStore } from 'react';
import * as local from './localStore';
import * as remote from './remoteStore';
import { useAuthContext } from '../ui/AuthContext';
import type { RosterEntry, SavedPlan, Settings, Team } from './types';

/** React bindings over the store (spec §4.5). Signed-out reads/writes localStorage
 * (unchanged, CLAUDE.md guest-first path); signed-in switches to Supabase-backed
 * remoteStore.ts, keyed on AuthContext's session. Both backends expose the same
 * cache+subscribe shape (see remoteStore.ts's module comment for why an async-populated
 * cache still works with useSyncExternalStore), so each hook just picks which module's
 * functions to call — no other change needed in the ~15 view files that consume these. */

export function useRoster(): [RosterEntry[], (roster: RosterEntry[]) => void] {
  const { user } = useAuthContext();
  const signedIn = user !== null;
  const roster = useSyncExternalStore(signedIn ? remote.subscribe : local.subscribe, signedIn ? remote.getRoster : local.getRoster);
  const set = useCallback((next: RosterEntry[]) => (signedIn ? remote.setRoster(next) : local.setRoster(next)), [signedIn]);
  return [roster, set];
}

export function useSavedPlans(): [SavedPlan[], (plans: SavedPlan[]) => void] {
  const { user } = useAuthContext();
  const signedIn = user !== null;
  const plans = useSyncExternalStore(
    signedIn ? remote.subscribe : local.subscribe,
    signedIn ? remote.getSavedPlans : local.getSavedPlans,
  );
  const set = useCallback(
    (next: SavedPlan[]) => (signedIn ? remote.setSavedPlans(next) : local.setSavedPlans(next)),
    [signedIn],
  );
  return [plans, set];
}

export function useTeams(): [Team[], (teams: Team[]) => void] {
  const { user } = useAuthContext();
  const signedIn = user !== null;
  const teams = useSyncExternalStore(signedIn ? remote.subscribe : local.subscribe, signedIn ? remote.getTeams : local.getTeams);
  const set = useCallback((next: Team[]) => (signedIn ? remote.setTeams(next) : local.setTeams(next)), [signedIn]);
  return [teams, set];
}

export function useSettings(): [Settings, (settings: Settings) => void] {
  const { user } = useAuthContext();
  const signedIn = user !== null;
  const settings = useSyncExternalStore(
    signedIn ? remote.subscribe : local.subscribe,
    signedIn ? remote.getSettings : local.getSettings,
  );
  const set = useCallback(
    (next: Settings) => (signedIn ? remote.setSettings(next) : local.setSettings(next)),
    [signedIn],
  );
  return [settings, set];
}

// Not part of cloud sync scope (ephemeral UI selection state, not a store entity in
// docs/PRODUCTION_READINESS_PLAN.md's schema) — always local, signed-in or not.
export function useSelectedPlayerIds(): [Set<string>, (ids: Set<string>) => void] {
  const ids = useSyncExternalStore(local.subscribe, local.getSelectedPlayerIds);
  const idsSet = useMemo(() => new Set(ids), [ids]);
  const set = useCallback((next: Set<string>) => local.setSelectedPlayerIds([...next]), []);
  return [idsSet, set];
}
