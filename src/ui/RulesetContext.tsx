import { createContext, useContext, useMemo, type ReactNode } from 'react';
import rawDataset from '../data/dataset.1.0.json';
import { parseDataset } from '../data/loader';
import { createRuleset } from '../ruleset';
import type { BreedingRuleset } from '../ruleset/types';
import type { Dataset, Species, Passive } from '../data/schema';

/** Loads + validates the bundled dataset once and builds the live ruleset (spec §4.1/§4.2).
 * Every view reads species/passives/ruleset from here rather than touching the dataset
 * or ruleset factory directly. */

interface RulesetContextValue {
  dataset: Dataset;
  ruleset: BreedingRuleset;
  species: Species[];
  passives: Passive[];
  speciesById: Map<string, Species>;
}

const RulesetContext = createContext<RulesetContextValue | null>(null);

export function RulesetProvider({ children }: { children: ReactNode }) {
  const value = useMemo<RulesetContextValue>(() => {
    const dataset = parseDataset(rawDataset);
    const ruleset = createRuleset(dataset);
    const speciesById = new Map(dataset.species.map((s) => [s.id, s]));
    return { dataset, ruleset, species: dataset.species, passives: dataset.passives, speciesById };
  }, []);

  return <RulesetContext.Provider value={value}>{children}</RulesetContext.Provider>;
}

export function useRulesetContext(): RulesetContextValue {
  const ctx = useContext(RulesetContext);
  if (!ctx) throw new Error('useRulesetContext must be used within RulesetProvider');
  return ctx;
}
