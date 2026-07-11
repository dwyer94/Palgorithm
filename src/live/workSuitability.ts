import type { Species } from '../data/schema';
import type { LivePal } from './types';

/**
 * A Pal's effective rank for one work type = the species' innate base level (from the bundled
 * dataset's `workSuitabilities`) plus any per-instance bonus from Pal Soul condensing
 * (PalDefender's `ExtraWorkSuitabilities`). Types neither source mentions are simply absent
 * (0) — that's real game info ("this Pal doesn't do this job"), not a data gap to flag.
 */
export function effectiveWorkSuitabilities(
  species: Species | undefined,
  pal: Pick<LivePal, 'extraWorkSuitabilities'>,
): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const w of species?.workSuitabilities ?? []) {
    levels[w.type] = (levels[w.type] ?? 0) + w.level;
  }
  for (const [type, bonus] of Object.entries(pal.extraWorkSuitabilities)) {
    levels[type] = (levels[type] ?? 0) + bonus;
  }
  return levels;
}
