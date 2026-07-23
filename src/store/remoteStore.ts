import { supabase } from './supabaseClient';
import { DEFAULT_SETTINGS, TEAM_SLOT_COUNT, type RosterEntry, type SavedPlan, type Settings, type Team, type TeamSlot } from './types';

/**
 * Supabase-backed persistence (Phase 1, docs/PRODUCTION_READINESS_PLAN.md), mirroring
 * localStore.ts's cache+listener shape so useSyncExternalStore-based hooks (hooks.ts) don't
 * need to know whether they're reading local or remote data. The cache is populated
 * asynchronously (a background fetch) but read synchronously — same pattern any
 * async-external-store binding uses: `getX()` returns whatever's cached so far (empty
 * array/DEFAULT_SETTINGS until the first fetch resolves), and `notify()` fires once real
 * data arrives so subscribers re-render.
 *
 * Writes are optimistic: the in-memory cache updates (and notifies) immediately, and the
 * Supabase write happens in the background. A failed write is logged, not rolled back or
 * retried — acceptable for a personal-scale tool; the next fetch (e.g. next sign-in)
 * reconciles from the server as the source of truth.
 *
 * `setActiveUser` must be called by hooks.ts whenever the signed-in user changes (including
 * to null on sign-out), which clears every cache so a new session never sees a stale
 * previous user's data.
 */

type Listener = () => void;
const listeners = new Set<Listener>();
function notify(): void {
  for (const l of listeners) l();
}
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let activeUserId: string | null = null;

// useSyncExternalStore compares snapshots by reference — a fresh `[]` literal on every
// call to a getX() below (while its cache is still null/loading) looks like a changed
// store on every render and spins into an infinite update loop. One shared stable empty
// array for all of them avoids that; DEFAULT_SETTINGS already serves the same role for
// getSettings() since it's a module-level constant.
const EMPTY_ARRAY: never[] = [];

let rosterCache: RosterEntry[] | null = null;
let savedPlansCache: SavedPlan[] | null = null;
let teamsCache: Team[] | null = null;
let settingsCache: Settings | null = null;

let rosterFetching = false;
let savedPlansFetching = false;
let teamsFetching = false;
let settingsFetching = false;

export function setActiveUser(userId: string | null): void {
  if (userId === activeUserId) return;
  activeUserId = userId;
  rosterCache = null;
  savedPlansCache = null;
  teamsCache = null;
  settingsCache = null;
  notify();
  if (userId) {
    ensureRosterLoaded();
    ensureSavedPlansLoaded();
    ensureTeamsLoaded();
    ensureSettingsLoaded();
  }
}

// ── rosters ──────────────────────────────────────────────────────────────────
function rowToRosterEntry(row: Record<string, unknown>): RosterEntry {
  const notes = row.notes as string | null;
  return {
    id: row.id as string,
    species: row.species as RosterEntry['species'],
    gender: row.gender as RosterEntry['gender'],
    passives: (row.passives as RosterEntry['passives']) ?? [],
    ...(notes ? { notes } : {}),
  };
}

function rosterEntryToRow(entry: RosterEntry, userId: string) {
  return {
    id: entry.id,
    user_id: userId,
    species: entry.species,
    gender: entry.gender,
    passives: entry.passives,
    notes: entry.notes ?? null,
  };
}

async function fetchRoster(): Promise<void> {
  if (!supabase || !activeUserId) return;
  const { data, error } = await supabase.from('rosters').select();
  if (error) {
    console.error('remoteStore: failed to fetch rosters', error);
    return;
  }
  rosterCache = (data ?? []).map(rowToRosterEntry);
  notify();
}

function ensureRosterLoaded(): void {
  if (rosterCache !== null || rosterFetching || !activeUserId) return;
  rosterFetching = true;
  void fetchRoster().finally(() => {
    rosterFetching = false;
  });
}

export function getRoster(): RosterEntry[] {
  ensureRosterLoaded();
  return rosterCache ?? EMPTY_ARRAY;
}

async function pushRoster(prevIds: Set<string>, next: RosterEntry[], userId: string): Promise<string | null> {
  if (!supabase) return null;
  const nextIds = new Set(next.map((r) => r.id));
  const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from('rosters').delete().in('id', toDelete);
    if (error) return error.message;
  }
  if (next.length > 0) {
    const { error } = await supabase.from('rosters').upsert(next.map((r) => rosterEntryToRow(r, userId)));
    if (error) return error.message;
  }
  return null;
}

export function setRoster(next: RosterEntry[]): void {
  const prevIds = new Set((rosterCache ?? []).map((r) => r.id));
  rosterCache = next;
  notify();
  if (!supabase || !activeUserId) return;
  void pushRoster(prevIds, next, activeUserId).then((error) => {
    if (error) console.error('remoteStore: failed to save rosters', error);
  });
}

// ── saved_plans ──────────────────────────────────────────────────────────────
function rowToSavedPlan(row: Record<string, unknown>): SavedPlan {
  const data = row.data as {
    result: SavedPlan['result'];
    guaranteedCarrierOutcome?: SavedPlan['guaranteedCarrierOutcome'];
    ownedUnassignedPassives?: SavedPlan['ownedUnassignedPassives'];
    nextBestWhenOwned?: SavedPlan['nextBestWhenOwned'];
  };
  const desiredPassives = row.desired_passives as SavedPlan['desiredPassives'] | null;
  return {
    id: row.id as string,
    name: row.name as string,
    savedAt: row.saved_at as string,
    kind: row.kind as SavedPlan['kind'],
    targets: row.targets as SavedPlan['targets'],
    ...(desiredPassives ? { desiredPassives } : {}),
    result: data.result,
    ...(data.guaranteedCarrierOutcome ? { guaranteedCarrierOutcome: data.guaranteedCarrierOutcome } : {}),
    ...(data.ownedUnassignedPassives ? { ownedUnassignedPassives: data.ownedUnassignedPassives } : {}),
    ...(data.nextBestWhenOwned ? { nextBestWhenOwned: data.nextBestWhenOwned } : {}),
  };
}

function savedPlanToRow(plan: SavedPlan, userId: string) {
  return {
    id: plan.id,
    user_id: userId,
    name: plan.name,
    saved_at: plan.savedAt,
    kind: plan.kind,
    targets: plan.targets,
    desired_passives: plan.desiredPassives ?? null,
    data: {
      result: plan.result,
      guaranteedCarrierOutcome: plan.guaranteedCarrierOutcome ?? null,
      ownedUnassignedPassives: plan.ownedUnassignedPassives ?? null,
      nextBestWhenOwned: plan.nextBestWhenOwned ?? null,
    },
  };
}

async function fetchSavedPlans(): Promise<void> {
  if (!supabase || !activeUserId) return;
  const { data, error } = await supabase.from('saved_plans').select();
  if (error) {
    console.error('remoteStore: failed to fetch saved_plans', error);
    return;
  }
  savedPlansCache = (data ?? []).map(rowToSavedPlan);
  notify();
}

function ensureSavedPlansLoaded(): void {
  if (savedPlansCache !== null || savedPlansFetching || !activeUserId) return;
  savedPlansFetching = true;
  void fetchSavedPlans().finally(() => {
    savedPlansFetching = false;
  });
}

export function getSavedPlans(): SavedPlan[] {
  ensureSavedPlansLoaded();
  return savedPlansCache ?? EMPTY_ARRAY;
}

async function pushSavedPlans(prevIds: Set<string>, next: SavedPlan[], userId: string): Promise<string | null> {
  if (!supabase) return null;
  const nextIds = new Set(next.map((p) => p.id));
  const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from('saved_plans').delete().in('id', toDelete);
    if (error) return error.message;
  }
  if (next.length > 0) {
    const { error } = await supabase.from('saved_plans').upsert(next.map((p) => savedPlanToRow(p, userId)));
    if (error) return error.message;
  }
  return null;
}

export function setSavedPlans(next: SavedPlan[]): void {
  const prevIds = new Set((savedPlansCache ?? []).map((p) => p.id));
  savedPlansCache = next;
  notify();
  if (!supabase || !activeUserId) return;
  void pushSavedPlans(prevIds, next, activeUserId).then((error) => {
    if (error) console.error('remoteStore: failed to save saved_plans', error);
  });
}

// ── teams / team_slots ───────────────────────────────────────────────────────
function emptySlots(): TeamSlot[] {
  return Array.from({ length: TEAM_SLOT_COUNT }, () => ({ target: null, desiredPassives: [] }));
}

async function fetchTeams(): Promise<void> {
  if (!supabase || !activeUserId) return;
  const { data: teamRows, error } = await supabase.from('teams').select();
  if (error) {
    console.error('remoteStore: failed to fetch teams', error);
    return;
  }
  const teamIds = (teamRows ?? []).map((r) => r.id as string);
  const slotsByTeam = new Map<string, TeamSlot[]>(teamIds.map((id) => [id, emptySlots()]));

  if (teamIds.length > 0) {
    const { data: slotRows, error: slotsError } = await supabase.from('team_slots').select().in('team_id', teamIds);
    if (slotsError) {
      console.error('remoteStore: failed to fetch team_slots', slotsError);
      return;
    }
    for (const row of slotRows ?? []) {
      const slots = slotsByTeam.get(row.team_id as string);
      const slotIndex = row.slot_index as number;
      if (!slots || slotIndex < 0 || slotIndex >= TEAM_SLOT_COUNT) continue;
      const plan = row.plan as TeamSlot['plan'] | null;
      const pendingPlan = row.pending_plan as TeamSlot['pendingPlan'] | null;
      slots[slotIndex] = {
        target: (row.target as TeamSlot['target']) ?? null,
        desiredPassives: (row.desired_passives as TeamSlot['desiredPassives']) ?? [],
        ...(plan ? { plan } : {}),
        ...(pendingPlan ? { pendingPlan } : {}),
        ...(row.disabled ? { disabled: true } : {}),
      };
    }
  }

  teamsCache = (teamRows ?? []).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    createdAt: row.created_at as string,
    slots: slotsByTeam.get(row.id as string) ?? emptySlots(),
  }));
  notify();
}

function ensureTeamsLoaded(): void {
  if (teamsCache !== null || teamsFetching || !activeUserId) return;
  teamsFetching = true;
  void fetchTeams().finally(() => {
    teamsFetching = false;
  });
}

export function getTeams(): Team[] {
  ensureTeamsLoaded();
  return teamsCache ?? EMPTY_ARRAY;
}

async function pushTeams(prevIds: Set<string>, next: Team[], userId: string): Promise<string | null> {
  if (!supabase) return null;
  const nextIds = new Set(next.map((t) => t.id));
  const toDelete = [...prevIds].filter((id) => !nextIds.has(id));
  if (toDelete.length > 0) {
    // team_slots cascade-delete via the FK, no separate cleanup needed.
    const { error } = await supabase.from('teams').delete().in('id', toDelete);
    if (error) return error.message;
  }
  if (next.length === 0) return null;

  const teamRows = next.map((t) => ({ id: t.id, user_id: userId, name: t.name, created_at: t.createdAt }));
  const { error: teamsError } = await supabase.from('teams').upsert(teamRows);
  if (teamsError) return teamsError.message;

  const slotRows = next.flatMap((t) =>
    t.slots.map((slot, slotIndex) => ({
      team_id: t.id,
      user_id: userId,
      slot_index: slotIndex,
      target: slot.target,
      desired_passives: slot.desiredPassives,
      plan: slot.plan ?? null,
      pending_plan: slot.pendingPlan ?? null,
      disabled: slot.disabled ?? false,
    })),
  );
  const { error: slotsError } = await supabase.from('team_slots').upsert(slotRows, { onConflict: 'team_id,slot_index' });
  if (slotsError) return slotsError.message;
  return null;
}

export function setTeams(next: Team[]): void {
  const prevIds = new Set((teamsCache ?? []).map((t) => t.id));
  teamsCache = next;
  notify();
  if (!supabase || !activeUserId) return;
  void pushTeams(prevIds, next, activeUserId).then((error) => {
    if (error) console.error('remoteStore: failed to save teams', error);
  });
}

// ── settings ─────────────────────────────────────────────────────────────────
function rowToSettings(row: Record<string, unknown>): Settings {
  return {
    allowCatching: row.allow_catching as boolean,
    catchCost: row.catch_cost as number,
    savedPerkSets: (row.saved_perk_sets as Settings['savedPerkSets']) ?? [],
    serverConfigPreset: (row.server_config_preset as Settings['serverConfigPreset']) ?? null,
    activeRuleset: (row.active_ruleset as string | null) ?? null,
    iconDisplayMode: row.icon_display_mode as Settings['iconDisplayMode'],
    // Merged over DEFAULT_SETTINGS.live so a row saved before the `enabled` flag existed
    // (2026-07-19) comes back with `enabled: false` — the safe default — rather than
    // `undefined`, instead of silently resuming an auto-connect the user never opted into.
    live: { ...DEFAULT_SETTINGS.live, ...(row.live as Partial<Settings['live']>) },
  };
}

function settingsToRow(settings: Settings, userId: string) {
  return {
    user_id: userId,
    allow_catching: settings.allowCatching,
    catch_cost: settings.catchCost,
    saved_perk_sets: settings.savedPerkSets,
    server_config_preset: settings.serverConfigPreset,
    active_ruleset: settings.activeRuleset,
    icon_display_mode: settings.iconDisplayMode,
    live: settings.live,
  };
}

async function fetchSettings(): Promise<void> {
  if (!supabase || !activeUserId) return;
  const { data, error } = await supabase.from('settings').select().maybeSingle();
  if (error) {
    console.error('remoteStore: failed to fetch settings', error);
    return;
  }
  settingsCache = data ? rowToSettings(data) : DEFAULT_SETTINGS;
  notify();
}

function ensureSettingsLoaded(): void {
  if (settingsCache !== null || settingsFetching || !activeUserId) return;
  settingsFetching = true;
  void fetchSettings().finally(() => {
    settingsFetching = false;
  });
}

export function getSettings(): Settings {
  ensureSettingsLoaded();
  return settingsCache ?? DEFAULT_SETTINGS;
}

async function pushSettings(next: Settings, userId: string): Promise<string | null> {
  if (!supabase) return null;
  const { error } = await supabase.from('settings').upsert(settingsToRow(next, userId));
  return error ? error.message : null;
}

export function setSettings(next: Settings): void {
  settingsCache = next;
  notify();
  if (!supabase || !activeUserId) return;
  void pushSettings(next, activeUserId).then((error) => {
    if (error) console.error('remoteStore: failed to save settings', error);
  });
}

// ── guest → cloud migration (Phase 1) ─────────────────────────────────────────
/** True once the current user's cloud tables are confirmed empty (a fresh account with
 * nothing imported yet) — used to decide whether to offer the one-time local-data import.
 * A dedicated count-only query rather than reusing getRoster()/getSavedPlans()/getTeams(),
 * since those return [] both while genuinely empty and while still loading — this needs to
 * tell the two apart. */
export async function isCloudEmpty(): Promise<boolean> {
  if (!supabase || !activeUserId) return true;
  const [rosters, savedPlans, teams] = await Promise.all([
    supabase.from('rosters').select('*', { count: 'exact', head: true }),
    supabase.from('saved_plans').select('*', { count: 'exact', head: true }),
    supabase.from('teams').select('*', { count: 'exact', head: true }),
  ]);
  return (rosters.count ?? 0) === 0 && (savedPlans.count ?? 0) === 0 && (teams.count ?? 0) === 0;
}

/** One-time bulk-upsert of local guest data into the (confirmed-empty) cloud tables on
 * first sign-in. Unlike setX() above, this is awaited end-to-end and surfaces the first
 * error directly — the fire-and-forget "log and let the next fetch reconcile" tradeoff is
 * fine for routine edits, but a user acting on an explicit "Import your local data" prompt
 * needs to know if it actually worked (e.g. a roster over the 1000-row cap will now
 * correctly fail the whole import atomically, see supabase/migrations/0001_init_schema.sql). */
export async function importLocalData(local: {
  roster: RosterEntry[];
  savedPlans: SavedPlan[];
  teams: Team[];
  settings: Settings;
}): Promise<{ error: string | null }> {
  if (!supabase || !activeUserId) return { error: 'Not signed in.' };
  const userId = activeUserId;

  const rosterError = await pushRoster(new Set(), local.roster, userId);
  if (rosterError) return { error: `Roster: ${rosterError}` };

  const savedPlansError = await pushSavedPlans(new Set(), local.savedPlans, userId);
  if (savedPlansError) return { error: `Saved plans: ${savedPlansError}` };

  const teamsError = await pushTeams(new Set(), local.teams, userId);
  if (teamsError) return { error: `Teams: ${teamsError}` };

  const settingsError = await pushSettings(local.settings, userId);
  if (settingsError) return { error: `Settings: ${settingsError}` };

  // Re-pull from the server so the UI reflects exactly what was imported.
  rosterCache = null;
  savedPlansCache = null;
  teamsCache = null;
  settingsCache = null;
  notify();
  ensureRosterLoaded();
  ensureSavedPlansLoaded();
  ensureTeamsLoaded();
  ensureSettingsLoaded();

  return { error: null };
}
