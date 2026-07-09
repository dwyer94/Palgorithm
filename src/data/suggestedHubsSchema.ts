import { z } from 'zod';

/**
 * Precomputed "suggested hub" data (src/pipeline/suggestHubs.ts's output), shared by the
 * generator (validates before writing) and the UI (types the imported JSON). Lives
 * alongside dataset.<version>.json but is NOT part of DatasetSchema — this is a
 * hub-finder result over a hand-curated target list (src/pipeline/popularTargets.json),
 * not extracted game data.
 */

export const SuggestedInjectCostSchema = z.object({
  target: z.string(),
  combos: z.number(),
  direct: z.boolean(),
});

export const SuggestedHubCandidateSchema = z.object({
  species: z.string(),
  obtainCost: z.number(),
  injectCost: z.array(SuggestedInjectCostSchema),
  score: z.number(),
});

export const RoleSuggestionSchema = z.object({
  targets: z.array(z.string()),
  /** Ranked, best first — same order findHubs returns. */
  topHubs: z.array(SuggestedHubCandidateSchema),
  /** The baseline union-plan combination count for this role's targets (empty roster),
   * so the UI can show "hub saves N vs union" without recomputing it. */
  unionCombinationCount: z.number(),
});

export const SuggestedHubsSchema = z.object({
  meta: z.object({
    version: z.string(), // dataset version this was generated from, e.g. "0.6"
    generatedAt: z.string(), // ISO timestamp
  }),
  roles: z.record(z.string(), RoleSuggestionSchema),
});

export type SuggestedInjectCost = z.infer<typeof SuggestedInjectCostSchema>;
export type SuggestedHubCandidate = z.infer<typeof SuggestedHubCandidateSchema>;
export type RoleSuggestion = z.infer<typeof RoleSuggestionSchema>;
export type SuggestedHubs = z.infer<typeof SuggestedHubsSchema>;
