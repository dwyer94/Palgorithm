import { readFileSync } from 'node:fs';
import type { Dataset } from '../../src/data/schema';

/**
 * Loads the vendored beckerfelipee breeding oracle (test/oracle/, MIT) into a lookup the
 * ruleset-vs-oracle harness compares `forward()` against (spec §11). This is the divergence
 * detector: it must stay green for combirank-0.6, and the same harness quantifies how far
 * genrecomb-1.0 departs post-1.0.
 *
 * Format notes (see test/oracle/README.md): both CSVs use bare CR line endings; the matrix
 * is 138×138, symmetric, no header, cells are English display names. Symmetric matrices
 * cannot encode gender-dependent combos, so upstream returns the plain formula result for
 * those — the harness excludes them and tests them explicitly with genders instead.
 */

/** Oracle display name → our dataset species id. Overrides ambiguous or name-skewed joins;
 * everything else joins on `displayName`. Kept in the harness, never mutating either dataset
 * (test/oracle/README.md "build a small alias map … rather than mutating"). */
export const ORACLE_ALIASES: Record<string, string> = {
  Gumoss: 'PlantSlime', // two dataset species share displayName "Gumoss"; disambiguate by id
  'Gumoss (Special)': 'PlantSlime_Flower',
  Ribunny: 'PinkRabbit', // dataset displayName is "Ribbuny"
  'Ice Reptyro': 'VolcanicMonster_Ice', // dataset displayName "Reptyro Cryst"
  'Ice Kingpaca': 'KingAlpaca_Ice', // dataset displayName "Kingpaca Cryst"
};

const CR = /[\r\n]+/;

export interface OracleFixture {
  /** Oracle species names in matrix-index order. */
  names: string[];
  /** child(a, b) — oracle display name of the child, or null if either name is unknown. */
  child(a: string, b: string): string | null;
  /** Resolve an oracle display name to a dataset species id, or null if unresolvable. */
  toId(name: string): string | null;
  /** Oracle names that don't resolve to any dataset species (data-quality gaps, e.g. the
   * L10N-broken "en_text" extraction misses). Pairs touching these are skipped + reported. */
  unresolved: Set<string>;
}

export function loadOracle(dataset: Dataset): OracleFixture {
  const names = readFileSync('test/oracle/Pals.csv', 'utf8')
    .split(CR)
    .map((s) => s.trim())
    .filter(Boolean);
  const matrix = readFileSync('test/oracle/AllCombos.csv', 'utf8')
    .split(CR)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(';').map((c) => c.trim()));

  const idx = new Map(names.map((n, i) => [n, i]));

  // displayName → id, but only for unambiguous names (a name shared by >1 species is left
  // out and must be resolved via ORACLE_ALIASES).
  const nameCount = new Map<string, number>();
  for (const s of dataset.species) {
    const n = s.displayName.trim();
    nameCount.set(n, (nameCount.get(n) ?? 0) + 1);
  }
  const byName = new Map<string, string>();
  for (const s of dataset.species) {
    const n = s.displayName.trim();
    if (nameCount.get(n) === 1) byName.set(n, s.id);
  }
  const validId = new Set(dataset.species.map((s) => s.id));

  const toId = (name: string): string | null => {
    const alias = ORACLE_ALIASES[name];
    if (alias) return validId.has(alias) ? alias : null;
    return byName.get(name) ?? null;
  };

  const unresolved = new Set(names.filter((n) => toId(n) === null));

  const child = (a: string, b: string): string | null => {
    const i = idx.get(a);
    const j = idx.get(b);
    if (i === undefined || j === undefined) return null;
    return matrix[i]?.[j] ?? null;
  };

  return { names, child, toId, unresolved };
}
