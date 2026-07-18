import type { Gender, PassiveId, SpeciesId } from '../ruleset/types';
import type { SpeciesPlanResult, UnionPlanResult } from '../solver/types';
import type { GuaranteedCarrierOutcome } from '../solver/passivePlanner';

export type { Gender, PassiveId, SpeciesId };

/** Owned-target "next best" snapshot stored alongside a single-target plan — the cheapest route
 * to obtain ANOTHER copy when the target is already owned outright, captured so a reopened saved
 * plan / team slot shows exactly what was on screen. Absent on plans saved before this existed,
 * and on any plan whose target wasn't owned outright. */
export interface NextBestWhenOwnedSnapshot {
  result: SpeciesPlanResult;
  guaranteedCarrierOutcome: GuaranteedCarrierOutcome;
  ownedUnassignedPassives: PassiveId[];
}

/** One owned individual, persisted (spec §6.3 shape, §8.1 roster manager). */
export interface RosterEntry {
  id: string;
  species: SpeciesId;
  gender: Gender;
  passives: PassiveId[];
  notes?: string;
}

/** A saved plan result, either single-target or union, kept for revisiting without
 * recomputing (spec §8's results views). */
export interface SavedPlan {
  id: string;
  name: string;
  savedAt: string;
  kind: 'single' | 'union';
  targets: SpeciesId[];
  desiredPassives?: PassiveId[];
  result: SpeciesPlanResult | UnionPlanResult;
  /** Single-target only: the "guaranteed-carrier" outcome shown alongside `result` on the
   * planner screen at save time (see `SingleTargetView`'s two-mode result display). Captured so
   * a saved plan is a snapshot of exactly what was on screen, not just the cheapest/opportunistic
   * `result`. Absent on plans saved before this field existed — `SingleTargetResultView` treats
   * that the same as `{status: 'not-requested'}` (no migration; see CLAUDE.md's single-user,
   * local-only framing). */
  guaranteedCarrierOutcome?: GuaranteedCarrierOutcome;
  /** Single-target only: subset of the guaranteed-carrier outcome's still-unrouted passives that
   * the roster owned at save time — reproduces the same "owned but no route found" vs "nobody
   * owns this" messaging shown on the planner screen without needing to re-query a roster that
   * may have since changed. */
  ownedUnassignedPassives?: PassiveId[];
  /** Single-target only: the "obtain another" route shown when the target was owned outright at
   * save time (see `NextBestWhenOwnedSnapshot`). */
  nextBestWhenOwned?: NextBestWhenOwnedSnapshot;
}

/** A named perk set the user can re-select across planner views (spec §8.6). */
export interface SavedPerkSet {
  id: string;
  name: string;
  passives: PassiveId[];
}

/** One Team slot's attached plan snapshot — same shape `SingleTargetResultView` already
 * knows how to render, but stored independently of the "Saved Plans" list (a Team slot's
 * plan isn't a `SavedPlan`). */
export interface TeamSlotPlan {
  savedAt: string;
  target: SpeciesId;
  desiredPassives?: PassiveId[];
  result: SpeciesPlanResult;
  guaranteedCarrierOutcome?: GuaranteedCarrierOutcome;
  ownedUnassignedPassives?: PassiveId[];
  /** The "obtain another" route shown when this slot's target was owned outright at run time
   * (see `NextBestWhenOwnedSnapshot`). */
  nextBestWhenOwned?: NextBestWhenOwnedSnapshot;
}

/** One of a Team's fixed `TEAM_SLOT_COUNT` party slots. `target`/`desiredPassives` are the
 * live picker state (always editable); `plan` is the attached/saved snapshot; `pendingPlan`
 * is a re-run result awaiting an explicit Keep new / Keep old decision — never auto-applied
 * over `plan`. */
export interface TeamSlot {
  target: SpeciesId | null;
  desiredPassives: PassiveId[];
  plan?: TeamSlotPlan;
  pendingPlan?: TeamSlotPlan;
}

/** Fixed team size, mirroring Palworld's in-game party size. */
export const TEAM_SLOT_COUNT = 5;

/** Per-user row caps enforced server-side by the cloud-sync triggers in
 * supabase/migrations/0001_init_schema.sql — mirrored here only so the UI can show a
 * count (RowCapBadge in components.tsx). Guests on localStorage have no such cap; these
 * only apply once signed in. Keep in sync with the migration if the caps ever change. */
export const CLOUD_ROW_CAPS = {
  roster: 1000,
  savedPlans: 200,
  teams: 50,
} as const;

/** A named team of `TEAM_SLOT_COUNT` breeding-plan slots (spec-adjacent: Team Builder). */
export interface Team {
  id: string;
  name: string;
  createdAt: string;
  /** Always exactly `TEAM_SLOT_COUNT` entries, enforced by `createEmptyTeam`, not the type
   * system — a slot's stable identity is its array index. */
  slots: TeamSlot[];
}

export function createEmptyTeam(name: string, id: string): Team {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    slots: Array.from({ length: TEAM_SLOT_COUNT }, () => ({ target: null, desiredPassives: [] })),
  };
}

/** Connection config for the live PalDefender-proxy feature (see docs/UI_REQUIREMENTS.md).
 * `baseUrl` empty means "not configured" — the live data source falls back to mock/demo
 * data rather than requiring a separate toggle. `nameOverrides` stays keyed by SteamID64
 * (matches the seed data below) rather than `PlayerUID` — PalDefender's `/pals/<id>` 404s
 * for offline players, so `PlayerUID` (always populated) is what the app tracks a player by
 * throughout, while `identityLinks` bridges PlayerUID -> SteamID64 so overrides/caching keep
 * working once a player goes offline (see src/live/nameResolution.ts). */
export interface LiveConnectionSettings {
  baseUrl: string;
  bearerToken: string;
  autoPollEnabled: boolean;
  autoPollIntervalSeconds: number;
  nameOverrides: Record<string, string>;
  /** PlayerUID -> bare SteamID64, learned from `UserId` whenever a player is seen online
   * (PalDefender only populates `UserId` while online). Persists across sessions so a
   * player who's currently offline still resolves against `nameOverrides`. */
  identityLinks: Record<string, string>;
}

/** Persisted app settings (spec §8.6). `serverConfigPreset`/`activeRuleset` are placeholders
 * for the 1.0 contingency (spec §5) — combirank-0.6 ignores server config today. */
export interface Settings {
  allowCatching: boolean;
  catchCost: number;
  savedPerkSets: SavedPerkSet[];
  serverConfigPreset: Record<string, unknown> | null;
  activeRuleset: string | null;
  live: LiveConnectionSettings;
  /** Global list-display preference (Roster/Server Pals/Hub candidates): 'compact' keeps
   * the existing text rows with a small inline icon, 'full' shows larger square Pal cards. */
  iconDisplayMode: 'compact' | 'full';
}

export interface StoreState {
  roster: RosterEntry[];
  savedPlans: SavedPlan[];
  teams: Team[];
  settings: Settings;
}

/** Optional personal seed for `nameOverrides` below, kept out of the public repo (gitignored —
 * see nameOverrides.example.ts). `import.meta.glob` resolves to an empty object rather than a
 * build error when the file doesn't exist, so a fresh clone still builds and runs; it just
 * starts with no pre-populated names, addable by hand from the Settings view instead. */
const localNameOverrideModules = import.meta.glob<{ nameOverrides: Record<string, string> }>(
  './nameOverrides.local.ts',
  { eager: true },
);
const seedNameOverrides: Record<string, string> = Object.values(localNameOverrideModules)[0]?.nameOverrides ?? {};

export const DEFAULT_SETTINGS: Settings = {
  allowCatching: false,
  catchCost: 1,
  savedPerkSets: [],
  serverConfigPreset: null,
  activeRuleset: null,
  iconDisplayMode: 'compact',
  live: {
    baseUrl: '',
    bearerToken: '',
    autoPollEnabled: true,
    autoPollIntervalSeconds: 300,
    // Known server roster, keyed on SteamID64 — see `identityLinks` above for how this keeps
    // resolving once a player's offline, and nameOverrides.example.ts for how to seed your own.
    nameOverrides: seedNameOverrides,
    identityLinks: {},
  },
};
