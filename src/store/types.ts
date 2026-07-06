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

/** Persisted app settings (spec §8.6). `serverConfigPreset`/`activeRuleset` are placeholders
 * for the 1.0 contingency (spec §5) — combirank-0.6 ignores server config today. */
export interface Settings {
  allowCatching: boolean;
  catchCost: number;
  savedPerkSets: SavedPerkSet[];
  serverConfigPreset: Record<string, unknown> | null;
  activeRuleset: string | null;
}

export interface StoreState {
  roster: RosterEntry[];
  savedPlans: SavedPlan[];
  settings: Settings;
}

export const DEFAULT_SETTINGS: Settings = {
  allowCatching: true,
  catchCost: 1,
  savedPerkSets: [],
  serverConfigPreset: null,
  activeRuleset: null,
};
