import type { PlanIndividual, SpeciesPlanResult, UnionPlanResult } from '../solver/types';
import type { LivePlayerPals, PlayerIdentifier } from './types';

/**
 * Best-effort, UI-layer-only provenance annotation. The solver's `PlanIndividual` is
 * already identity-free (`{species, gender, passives?}`) by design — it reasons about
 * species probability distributions, not specific owned individuals — so matching a plan
 * step back to "whose box has this pal" can only ever be an approximate guess, never a
 * guarantee. This never touches solver/types.ts or the planners themselves.
 */

export interface ProvenanceMatch {
  ownerIdentifier: PlayerIdentifier;
  ownerDisplayName: string;
  /** False when the match was ambiguous (multiple equally-plausible candidates) or the
   * individual's passives weren't fully covered by the matched pal — still shown as a
   * hint, just weaker. */
  confident: boolean;
}

/** Finds a live pal matching `individual`'s species+gender (preferring one whose passives
 * are a superset of the individual's), skipping instance ids already in `alreadyClaimed`
 * (mutated in place) so duplicate steps don't all point at the same single pal. Returns
 * `undefined` when nothing matches — callers should render no tag in that case, not guess. */
export function matchProvenance(
  individual: PlanIndividual,
  selectedPlayerIds: Set<PlayerIdentifier>,
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>,
  displayNameByIdentifier: Record<PlayerIdentifier, string>,
  alreadyClaimed: Set<string>,
): ProvenanceMatch | undefined {
  const candidates: { ownerIdentifier: PlayerIdentifier; instanceId: string; passives: string[] }[] = [];

  for (const id of selectedPlayerIds) {
    const playerPals = palsByPlayer[id];
    if (!playerPals) continue;
    for (const pal of playerPals.pals) {
      if (alreadyClaimed.has(pal.instanceId)) continue;
      if (pal.species !== individual.species || pal.gender !== individual.gender) continue;
      candidates.push({ ownerIdentifier: id, instanceId: pal.instanceId, passives: pal.passives });
    }
  }

  if (candidates.length === 0) return undefined;

  const desired = individual.passives ?? [];
  const supersetMatches =
    desired.length > 0 ? candidates.filter((c) => desired.every((p) => c.passives.includes(p))) : candidates;

  const pool = supersetMatches.length > 0 ? supersetMatches : candidates;
  const chosen = pool[0];
  if (!chosen) return undefined;
  alreadyClaimed.add(chosen.instanceId);

  return {
    ownerIdentifier: chosen.ownerIdentifier,
    ownerDisplayName: displayNameByIdentifier[chosen.ownerIdentifier] ?? chosen.ownerIdentifier,
    confident: pool.length === 1,
  };
}

function annotateIndividuals(
  entries: { key: string; individual: PlanIndividual }[],
  selectedPlayerIds: Set<PlayerIdentifier>,
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>,
  displayNameByIdentifier: Record<PlayerIdentifier, string>,
): Map<string, ProvenanceMatch> {
  const result = new Map<string, ProvenanceMatch>();
  const claimed = new Set<string>();
  for (const { key, individual } of entries) {
    const match = matchProvenance(individual, selectedPlayerIds, palsByPlayer, displayNameByIdentifier, claimed);
    if (match) result.set(key, match);
  }
  return result;
}

/** Annotates every `PlanIndividual` occurrence in a single-target plan: each step's two
 * parents, catches, and the passive-overlay's final cross parents when present. */
export function annotateSpeciesPlan(
  plan: SpeciesPlanResult,
  selectedPlayerIds: Set<PlayerIdentifier>,
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>,
  displayNameByIdentifier: Record<PlayerIdentifier, string>,
): Map<string, ProvenanceMatch> {
  const entries: { key: string; individual: PlanIndividual }[] = [];
  plan.steps.forEach((step, i) => {
    entries.push({ key: `step:${i}:A`, individual: step.parentA });
    entries.push({ key: `step:${i}:B`, individual: step.parentB });
  });
  plan.catches.forEach((c, i) => entries.push({ key: `catch:${i}`, individual: c }));
  if (plan.passivePlan) {
    entries.push({ key: 'passivePlan:A', individual: plan.passivePlan.finalParentA });
    entries.push({ key: 'passivePlan:B', individual: plan.passivePlan.finalParentB });
  }
  return annotateIndividuals(entries, selectedPlayerIds, palsByPlayer, displayNameByIdentifier);
}

/** Annotates the top-level merged steps/catches of a union plan (matches what `UnionPlanView`
 * renders as its primary list). Per-target detail views are left unannotated to keep this
 * scoped — they're a secondary, expandable view. */
export function annotateUnionPlan(
  plan: UnionPlanResult,
  selectedPlayerIds: Set<PlayerIdentifier>,
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>,
  displayNameByIdentifier: Record<PlayerIdentifier, string>,
): Map<string, ProvenanceMatch> {
  const entries: { key: string; individual: PlanIndividual }[] = [];
  plan.steps.forEach((step, i) => {
    entries.push({ key: `step:${i}:A`, individual: step.parentA });
    entries.push({ key: `step:${i}:B`, individual: step.parentB });
  });
  plan.catches.forEach((c, i) => entries.push({ key: `catch:${i}`, individual: c }));
  return annotateIndividuals(entries, selectedPlayerIds, palsByPlayer, displayNameByIdentifier);
}
