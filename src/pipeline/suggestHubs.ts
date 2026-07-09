/**
 * Suggested-hub generator (offline). Precomputes, for each hand-curated "popular pal"
 * role in popularTargets.json, the best hub candidates against those targets — the
 * structural half (injectCost(hub → target)) of hub scoring doesn't depend on any one
 * user's roster, so it's safe to compute once here rather than per-request in the UI.
 * `obtainCost` is still recomputed live against the real roster once a user picks a
 * suggestion (see HubView.tsx) — this file only ever assumes an empty roster, i.e. "how
 * good is this hub if you're starting from nothing."
 *
 * Reuses the existing solver entry points verbatim (CLAUDE.md invariant #1) — no new
 * breeding math here, just a batch driver over `findHubs`/`planUnion`.
 *
 * Run offline:  node src/pipeline/suggestHubs.ts
 * Output:       src/data/suggestedHubs.0.6.json (validated against SuggestedHubsSchema)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseDataset } from '../data/loader.ts';
import { SuggestedHubsSchema, type RoleSuggestion, type SuggestedHubs } from '../data/suggestedHubsSchema.ts';
import { createRuleset } from '../ruleset/index.ts';
import type { BreedingRuleset } from '../ruleset/types.ts';
import { findHubs, planUnion } from '../solver/hubFinder.ts';
import type { RosterEntry } from '../solver/types.ts';

interface PopularTargets {
  combat: string[];
  worker: string[];
  mount: string[];
}

const repoRoot = resolve(fileURLToPath(import.meta.url), '../../..');
const DATASET_FILE = join(repoRoot, 'src', 'data', 'dataset.0.6.json');
const POPULAR_TARGETS_FILE = join(repoRoot, 'src', 'pipeline', 'popularTargets.json');
const OUT_FILE = join(repoRoot, 'src', 'data', 'suggestedHubs.0.6.json');

/** Best hub candidates + union baseline for one role's target list, empty-roster
 * assumption. Exported so it's unit-testable against a synthetic dataset without going
 * through the file system (mirrors test/solver/hubFinder.test.ts's own pattern). */
export function buildRoleSuggestion(ruleset: BreedingRuleset, targets: string[]): RoleSuggestion {
  const emptyRoster: RosterEntry[] = [];
  // allowCatching:true gives the empty-roster search *some* bootstrap/fodder stock to
  // work from (otherwise nothing is obtainable at all — no roster, no catchable seed).
  // excludeTargetsFromCatching forces a genuine bred path to each curated target
  // specifically (the whole point of a "suggested hub") while still letting OTHER
  // targets in the same role serve as legitimate parents — some apex/legendary pals are
  // only reachable by breeding from each other via special combos, so excluding the
  // whole batch from catching at once (rather than per-target) would create an
  // unsolvable cycle.
  const options = { allowCatching: true, excludeTargetsFromCatching: true };
  const hubResult = findHubs(ruleset, emptyRoster, { targets, maxHubs: 3, ...options });
  const union = planUnion(ruleset, emptyRoster, targets, options);

  const topHubs = hubResult.hubs.map((h) => {
    if (h.score === undefined || h.injectCost === undefined) {
      // findHubs's fixed-target branch always sets these — a defensive check, not an
      // expected runtime path.
      throw new Error(`findHubs (fixed-target) returned "${h.species}" without score/injectCost`);
    }
    return { species: h.species, obtainCost: h.obtainCost, injectCost: h.injectCost, score: h.score };
  });

  return { targets, topHubs, unionCombinationCount: union.combinationCount };
}

function main(): void {
  const dataset = parseDataset(JSON.parse(readFileSync(DATASET_FILE, 'utf8')));
  const ruleset = createRuleset(dataset);

  const raw = JSON.parse(readFileSync(POPULAR_TARGETS_FILE, 'utf8'));
  const roleLists: PopularTargets = { combat: raw.combat, worker: raw.worker, mount: raw.mount };

  const speciesById = new Map(dataset.species.map((s) => [s.id, s]));
  const roles: Record<string, RoleSuggestion> = {};

  for (const [role, targets] of Object.entries(roleLists)) {
    for (const id of targets) {
      const species = speciesById.get(id);
      if (!species) throw new Error(`popularTargets.json role "${role}" references unknown species "${id}"`);
      if (!species.standardBreedable) {
        throw new Error(`popularTargets.json role "${role}" species "${id}" is not standardBreedable`);
      }
    }
    const suggestion = buildRoleSuggestion(ruleset, targets);
    if (suggestion.topHubs.length === 0) {
      // Most likely cause: one of the targets is only reachable by breeding itself (a
      // self+self-only reverse() derivation, e.g. isolated apex/legendary pals) — such a
      // species can only ever be caught, never bred from scratch, so no hub can reach
      // every target and the whole role comes back empty. Fail loudly instead of
      // shipping an empty/useless suggestion — fix popularTargets.json instead.
      throw new Error(
        `popularTargets.json role "${role}" produced zero hub candidates — check whether one of its targets is self-only (reverse() returns only itself as a parent pair)`,
      );
    }
    roles[role] = suggestion;
  }

  const output: SuggestedHubs = {
    meta: { version: dataset.meta.version, generatedAt: new Date().toISOString() },
    roles,
  };

  const parsed = SuggestedHubsSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(`Generated suggestedHubs failed schema validation:\n${parsed.error.message}`);
  }

  writeFileSync(OUT_FILE, JSON.stringify(parsed.data, null, 2) + '\n', 'utf8');

  console.log(`Wrote ${OUT_FILE}`);
  for (const [role, r] of Object.entries(roles)) {
    const top = r.topHubs[0];
    console.log(
      `  ${role}: ${r.targets.length} targets, union ${r.unionCombinationCount} combos, top hub = ${top ? `${top.species} (score ${top.score})` : 'none found'}`,
    );
  }
}

// Only run the CLI (file I/O) when executed directly — buildRoleSuggestion is also
// imported by test/pipeline/suggestHubs.test.ts, which must not trigger a full
// generation run (and its disk write) as a side effect of importing the function.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
