import type { Gender, PassiveId, SpeciesId } from '../ruleset/types';
import type { SpeciesPlanResult, UnionPlanResult } from '../solver/types';

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
}

/** A named perk set the user can re-select across planner views (spec §8.6). */
export interface SavedPerkSet {
  id: string;
  name: string;
  passives: PassiveId[];
}

/** Connection config for the live PalDefender-proxy feature (see docs/UI_REQUIREMENTS.md).
 * `baseUrl` empty means "not configured" — the live data source falls back to mock/demo
 * data rather than requiring a separate toggle. `nameOverrides` is keyed by whatever
 * identifier the proxy addresses a player by (PlayerUID today — see src/live/types.ts). */
export interface LiveConnectionSettings {
  baseUrl: string;
  bearerToken: string;
  autoPollEnabled: boolean;
  autoPollIntervalSeconds: number;
  nameOverrides: Record<string, string>;
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
}

export interface StoreState {
  roster: RosterEntry[];
  savedPlans: SavedPlan[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  allowCatching: false,
  catchCost: 1,
  savedPerkSets: [],
  serverConfigPreset: null,
  activeRuleset: null,
  live: {
    baseUrl: '',
    bearerToken: '',
    autoPollEnabled: false,
    autoPollIntervalSeconds: 60,
    // Known server roster (docs/UI_REQUIREMENTS.md). Keyed on SteamID64 for now; may need
    // re-keying to PlayerUID once the real proxy's /players response is inspected — see
    // src/live/types.ts's PlayerIdentifier note.
    nameOverrides: {
      '76561198106031331': 'Kit',
      '76561198061667425': 'InputComet',
      '76561198146926388': 'D-Wire',
      '76561198140338260': "Capn' Crain",
      '76561198053299466': 'ScootScoot',
      '76561198253583281': 'Kris',
      '76561198131149693': 'Canter',
      '76561198074507245': 'Wiggum',
    },
  },
};
