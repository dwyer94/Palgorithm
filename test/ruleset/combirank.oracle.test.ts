import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDataset } from '../../src/data/loader';
import type { Dataset } from '../../src/data/schema';
import { createCombiRank06 } from '../../src/ruleset/combirank';
import { loadOracle } from './oracle-fixture';

/**
 * Ruleset-vs-oracle harness (spec §11, 0.2 done-when). combirank-0.6 `forward()` must
 * reproduce the vendored beckerfelipee 138×138 matrix for every resolvable standard pair,
 * including the symmetric special-combo overrides baked into the matrix. This is the exact
 * harness that becomes the 1.0 divergence detector.
 *
 * Reconciliation rules (see oracle-fixture.ts):
 *  - Gender-dependent special combos: the symmetric oracle returns the plain formula result,
 *    not the gender split, so those pairs are excluded here and tested in the unit suite.
 *  - Unresolvable oracle names (L10N-broken "en_text" extraction misses, e.g. Hangyu) are
 *    skipped and reported — a dataset gap, not a ruleset defect.
 */
const dataset = parseDataset(JSON.parse(readFileSync('src/data/dataset.0.6.json', 'utf8')));
const oracle = loadOracle(dataset);

// The oracle is base-game only (138 species, no Sakurajima/Feybreak). Our 0.6 dataset has
// 223 species, and DLC Pals legitimately interleave into the rank space — so over the full
// dataset the closest child can be a DLC Pal the oracle never had (correct for the live
// game, absent from the matrix). To validate the *algorithm* on the same basis the oracle
// used, restrict the ruleset to the oracle's 138-species universe. This isolates formula
// correctness from dataset coverage (oracle README: "an inclusion check, not full coverage").
const baseIds = new Set(
  oracle.names.map((n) => oracle.toId(n)).filter((x): x is string => !!x),
);
const baseDataset: Dataset = {
  ...dataset,
  species: dataset.species.filter((s) => baseIds.has(s.id)),
  // Exclusion of special-only children is a property of the child, independent of whether
  // its combo's parents are in-scope — filter by child so e.g. Umihebi_Fire (a special-only
  // Surfent variant) stays out of the base formula pool, matching the oracle.
  specialCombos: dataset.specialCombos.filter((c) => baseIds.has(c.child)),
};
const ruleset = createCombiRank06(baseDataset);

// Unordered id-pairs that are special combos in OUR dataset. Excluded from the formula
// equality check for two reasons: gender-dependent combos return a distribution the
// symmetric oracle can't encode, and our special-combo coverage differs from the base-game
// oracle's (e.g. Blazehowl × Jormuntide → Jormuntide Ignis is a combo we have and the
// oracle lacks). Special combos are validated directly in the unit suite; the oracle
// harness validates the standard formula.
const specialPairs = new Set(
  dataset.specialCombos.map((c) => [c.parents[0], c.parents[1]].sort().join(' ')),
);

describe('combirank-0.6 forward() vs beckerfelipee oracle', () => {
  it('reproduces the oracle child for every resolvable standard pair', () => {
    let tested = 0;
    let skippedParent = 0;
    let skippedSpecial = 0;
    let skippedChild = 0;
    const mismatches: string[] = [];

    for (let i = 0; i < oracle.names.length; i++) {
      for (let j = i; j < oracle.names.length; j++) {
        const nameA = oracle.names[i]!;
        const nameB = oracle.names[j]!;
        const idA = oracle.toId(nameA);
        const idB = oracle.toId(nameB);
        if (!idA || !idB) {
          skippedParent++;
          continue;
        }
        if (specialPairs.has([idA, idB].sort().join(' '))) {
          skippedSpecial++;
          continue;
        }
        const expectedName = oracle.child(nameA, nameB);
        const expectedId = expectedName ? oracle.toId(expectedName) : null;
        if (!expectedId) {
          skippedChild++;
          continue;
        }

        const edge = ruleset.forward(idA, idB);
        tested++;
        // A standard (non-gender) pair must be a single deterministic outcome.
        if (edge.outcomes.length !== 1 || edge.outcomes[0]?.child !== expectedId) {
          if (mismatches.length < 25) {
            mismatches.push(
              `${nameA} × ${nameB}: expected ${expectedName} (${expectedId}), got ${JSON.stringify(edge.outcomes)}`,
            );
          }
        }
      }
    }

    // Surface coverage so a silent collapse (everything skipped) can't pass green.
    console.log(
      `[oracle harness] tested=${tested} skippedParent=${skippedParent} ` +
        `skippedSpecial=${skippedSpecial} skippedChild=${skippedChild} ` +
        `unresolvedOracleNames=${[...oracle.unresolved].join(',')}`,
    );

    expect(mismatches, mismatches.join('\n')).toEqual([]);
    // Real coverage: the vast majority of the 9591 (138·139/2) pairs must be exercised.
    expect(tested).toBeGreaterThan(8000);
  });

  it('forward() is symmetric in its parents', () => {
    const names = oracle.names.map((n) => oracle.toId(n)).filter((x): x is string => !!x);
    for (let i = 0; i < names.length; i += 7) {
      for (let j = 0; j < names.length; j += 11) {
        const ni = names[i]!;
        const nj = names[j]!;
        const ab = ruleset.forward(ni, nj).outcomes;
        const ba = ruleset.forward(nj, ni).outcomes;
        expect(ba, `${ni} × ${nj}`).toEqual(ab);
      }
    }
  });
});
