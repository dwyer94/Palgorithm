import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDataset } from '../src/data/loader';
import { createCombiRank06 } from '../src/ruleset/combirank';

/**
 * The live dataset the app actually ships (src/ui/RulesetContext.tsx imports this file).
 * dataset.0.6.test.ts guards the pre-1.0 extraction; this guards the 1.0 one, and in
 * particular the facts that are easy to lose silently on a normalizer re-run.
 */
const ds = parseDataset(JSON.parse(readFileSync('src/data/dataset.1.0.json', 'utf8')));
const ruleset = createCombiRank06(ds);
const byId = new Map(ds.species.map((s) => [s.id, s]));

describe('dataset.1.0 (extracted, final)', () => {
  it('validates as a non-provisional dataset targeting combirank-0.6', () => {
    expect(ds.meta.provisional).toBe(false);
    expect(ds.meta.ruleset).toBe('combirank-0.6');
    expect(ds.species.length).toBeGreaterThan(290);
  });

  it('keeps icon paths populated (a re-normalize without the texture export wipes them)', () => {
    expect(ds.species.filter((s) => s.icon).length).toBeGreaterThan(280);
  });
});

/**
 * Breeding-station eligibility. Panthalus is a live-reported case (2026-08-01): a rank-20
 * Pal the solver loved as a rare anchor, which the game will not let you assign to a breeding
 * station at all. See PARENT_ELIGIBILITY_OVERRIDES in src/pipeline/normalize.ts for how this
 * is derived and how to correct it.
 */
describe('dataset.1.0 breeding-station eligibility', () => {
  it('flags Panthalus as unusable as a parent', () => {
    expect(byId.get('KingWhale')?.displayName).toBe('Panthalus');
    expect(byId.get('KingWhale')?.breedingParentEligible).toBe(false);
    expect(ruleset.canBeParent('KingWhale')).toBe(false);
  });

  it('leaves the ordinary Pals eligible (the flag is the rare exception, not the rule)', () => {
    const ineligible = ds.species.filter((s) => s.breedingParentEligible === false);
    expect(ineligible.length).toBeLessThan(5);
    expect(ruleset.canBeParent('SheepBall')).toBe(true); // Lamball
    expect(ruleset.canBeParent('JetDragon')).toBe(true); // Jetragon — legendary, but farmable
  });

  it('never lets an ineligible species appear as a parent anywhere in the graph', () => {
    const ineligible = ds.species.filter((s) => s.breedingParentEligible === false).map((s) => s.id);
    expect(ineligible.length).toBeGreaterThan(0);
    for (const id of ineligible) {
      for (const other of Object.keys(ruleset.rankTable)) {
        expect(ruleset.forward(id, other).outcomes, `${id} x ${other}`).toEqual([]);
      }
    }
    // reverse() is defined in terms of forward(), so the sweep above already implies it —
    // spot-check a spread of real targets anyway so a future reverse() rewrite can't drift.
    for (const s of ds.species.filter((_, i) => i % 25 === 0)) {
      for (const { parentA, parentB } of ruleset.reverse(s.id)) {
        expect(ineligible, `${s.id} <- ${parentA}`).not.toContain(parentA);
        expect(ineligible, `${s.id} <- ${parentB}`).not.toContain(parentB);
      }
    }
  });
});
