import type { Gender, PassiveId, SpeciesId } from '../ruleset/types';
import type { SpeciesPlanResult, UnionPlanResult } from '../solver/types';
import type { GuaranteedCarrierAlternative } from '../solver/passivePlanner';

export type { Gender, PassiveId, SpeciesId };

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
  /** Single-target only: the "guaranteed-carrier" alternative shown alongside `result` on the
   * planner screen at save time, if any (see `SingleTargetView`'s two-mode result display).
   * Captured so a saved plan is a snapshot of exactly what was on screen, not just the
   * cheapest/opportunistic `result`. */
  guaranteedCarrierAlt?: GuaranteedCarrierAlternative | null;
  /** Single-target only: subset of `result.passivePlan.unassigned` that the roster owned at
   * save time — reproduces the same "owned but no route found" vs "nobody owns this" messaging
   * shown on the planner screen without needing to re-query a roster that may have since
   * changed. */
  ownedUnassignedPassives?: PassiveId[];
}

/** A named perk set the user can re-select across planner views (spec §8.6). */
export interface SavedPerkSet {
  id: string;
  name: string;
  passives: PassiveId[];
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
