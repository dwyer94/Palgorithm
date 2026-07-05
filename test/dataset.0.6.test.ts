import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDataset } from '../src/data/loader';

/**
 * The 0.1 done-when gate: the real extracted dataset (produced by src/pipeline/normalize.ts
 * from the FModel export) must pass the same loader the app uses. This is the contract the
 * pipeline output has to satisfy — and, when the 1.0 ruleset lands, the first thing to stay
 * green. Beyond schema validity we assert a few source-agnostic facts we know to be true so
 * a silent normalizer regression (dropped combos, mangled ranks, gender/element mapping)
 * fails loudly.
 */
const ds = parseDataset(JSON.parse(readFileSync('src/data/dataset.0.6.json', 'utf8')));

describe('dataset.0.6 (extracted, final)', () => {
  it('validates as a non-provisional dataset', () => {
    expect(ds.meta.provisional).toBe(false);
    expect(ds.meta.ruleset).toBe('combirank-0.6');
    expect(ds.species.length).toBeGreaterThan(200);
  });

  it('populates rank + genderRatio for every species (the final contract)', () => {
    for (const s of ds.species) {
      expect(s.rank, s.id).not.toBeNull();
      expect(s.genderRatio, s.id).not.toBeNull();
    }
  });

  it('assigns a unique, gapless game-file index', () => {
    const idx = ds.species.map((s) => s.index).sort((a, b) => a - b);
    expect(new Set(idx).size).toBe(idx.length);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(idx.length - 1);
  });

  it('maps known Pals correctly (rank, elements, name)', () => {
    const byId = new Map(ds.species.map((s) => [s.id, s]));
    const lamball = byId.get('SheepBall');
    expect(lamball?.displayName).toBe('Lamball');
    expect(lamball?.rank).toBe(1470);
    expect(lamball?.elements).toEqual(['Neutral']);

    const relaxLux = byId.get('LazyDragon_Electric');
    expect(relaxLux?.displayName).toBe('Relaxaurus Lux');
    expect(relaxLux?.elements).toEqual(['Dragon', 'Electric']);
  });

  it('classifies special-combo-only variants as not standard-breedable', () => {
    const byId = new Map(ds.species.map((s) => [s.id, s]));
    const pengulletLux = byId.get('Penguin_Electric');
    expect(pengulletLux?.standardBreedable).toBe(false);
    expect(pengulletLux?.otherObtainOnly).toBe(true);
  });

  it('encodes the gender-dependent special combo as two gendered outcomes', () => {
    const gendered = ds.specialCombos.filter(
      (c) => c.parents.includes('CatMage') && c.parents.includes('FoxMage'),
    );
    expect(gendered).toHaveLength(2);
    for (const c of gendered) {
      expect(c.genderRule).not.toBeNull();
      // the child is produced when genderRule.femaleParent is the female
      expect(c.genderRule?.child).toBe(c.child);
    }
    const children = gendered.map((c) => c.child).sort();
    expect(children).toEqual(['CatMage_Fire', 'FoxMage_Dark']);
  });

  it('keeps every special-combo reference resolvable (referential integrity)', () => {
    const ids = new Set(ds.species.map((s) => s.id));
    for (const c of ds.specialCombos) {
      expect(ids.has(c.parents[0]), c.parents[0]).toBe(true);
      expect(ids.has(c.parents[1]), c.parents[1]).toBe(true);
      expect(ids.has(c.child), c.child).toBe(true);
    }
  });
});
