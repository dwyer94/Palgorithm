import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import rawDataset from '../data/dataset.1.0.json';
import { parseDataset } from '../data/loader';
import { createRuleset } from '../ruleset';
import { solverWorker } from '../solver/worker/client';
import type { BreedingRuleset } from '../ruleset/types';
import type { Dataset, Species, Passive, PartnerSkill } from '../data/schema';

/** Loads + validates the bundled dataset once and builds the live ruleset (spec §4.1/§4.2).
 * Every view reads species/passives/ruleset from here rather than touching the dataset
 * or ruleset factory directly. */

interface RulesetContextValue {
  dataset: Dataset;
  ruleset: BreedingRuleset;
  species: Species[];
  passives: Passive[];
  speciesById: Map<string, Species>;
  partnerSkills: PartnerSkill[];
  partnerSkillBySpecies: Map<string, PartnerSkill>;
}

const RulesetContext = createContext<RulesetContextValue | null>(null);

export function RulesetProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RulesetContextValue>(() => {
    const dataset = parseDataset(rawDataset);
    const ruleset = createRuleset(dataset);
    const speciesById = new Map(dataset.species.map((s) => [s.id, s]));
    const partnerSkillBySpecies = new Map(dataset.partnerSkills.map((ps) => [ps.speciesId, ps]));
    return {
      dataset,
      ruleset,
      species: dataset.species,
      passives: dataset.passives,
      speciesById,
      partnerSkills: dataset.partnerSkills,
      partnerSkillBySpecies,
    };
  }, []);

  // Spin up + warm the solver worker off the critical path, so the user's first "Run plan"
  // click doesn't pay for worker startup + ruleset/graph-cache build (a one-time ~2s JIT
  // warmup per findings-doc #6) on top of the solve itself. All solving now happens in that
  // worker (findings-doc P0 fix) — the main thread's own ruleset (`value.ruleset` above) is
  // used for rendering only and never solves, so there's nothing to warm here anymore.
  // `requestIdleCallback` where available, else a deferred timeout.
  useEffect(() => {
    const warm = () => {
      solverWorker.warmup().promise.catch(() => {
        // Best-effort warm-up; a real solve request will build everything fresh anyway.
      });
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (ric) {
      const id = ric(warm);
      return () => (globalThis as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(id);
    }
    const t = setTimeout(warm, 200);
    return () => clearTimeout(t);
  }, []);

  return <RulesetContext.Provider value={value}>{children}</RulesetContext.Provider>;
}

export function useRulesetContext(): RulesetContextValue {
  const ctx = useContext(RulesetContext);
  if (!ctx) throw new Error('useRulesetContext must be used within RulesetProvider');
  return ctx;
}
