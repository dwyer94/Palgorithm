/**
 * The swap seam (spec §4.2). All version-specific breeding logic lives behind
 * `BreedingRuleset`; the solver and UI depend only on this module, never on a concrete
 * ruleset. On patch day, `genrecomb-1.0` is added here and selected at load time.
 */

export type {
  BreedingEdge,
  BreedingRuleset,
  Gender,
  GenderRatio,
  PassiveId,
  PassiveModel,
  ServerConfig,
  SpeciesId,
} from './types';

export { createCombiRank06, type CombiRankOptions } from './combirank.ts';

import type { Dataset } from '../data/schema';
import type { BreedingRuleset } from './types';
import { createCombiRank06, type CombiRankOptions } from './combirank.ts';

/**
 * Build the ruleset a dataset targets (`meta.ruleset`). Central place the 1.0 swap plugs
 * into: add a `genrecomb-1.0` case, keep `combirank-0.6` as a selectable fallback (spec §5).
 */
export function createRuleset(dataset: Dataset, options: CombiRankOptions = {}): BreedingRuleset {
  const version = dataset.meta.ruleset;
  switch (version) {
    case 'combirank-0.6':
      return createCombiRank06(dataset, options);
    default:
      // Unknown/forward version: fall back to the current ruleset so the app stays usable,
      // rather than failing hard. The UI can surface the mismatch.
      return createCombiRank06(dataset, options);
  }
}
