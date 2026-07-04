import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseDataset, safeParseDataset } from '../src/data/loader';

// Read fresh each call so mutations in one test can't leak into another.
// Inferred `any` (from JSON.parse) is intentional here — these tests poke malformed shapes.
// Path is relative to the project root (vitest's cwd).
const load = () => JSON.parse(readFileSync('test/fixtures/dataset.sample.json', 'utf8'));

describe('dataset loader + schema', () => {
  it('accepts a valid provisional dataset', () => {
    const ds = parseDataset(load());
    expect(ds.species).toHaveLength(3);
    expect(ds.passiveModel.verified).toBe(false);
  });

  it('allows null rank/genderRatio while provisional (bootstrap data)', () => {
    const ds = parseDataset(load());
    const relax = ds.species.find((s) => s.id === 'Relaxaurus_Lux');
    expect(relax?.rank).toBeNull();
    expect(relax?.genderRatio).toBeNull();
  });

  it('applies defaults for omitted collection/optional fields', () => {
    const raw = load();
    delete raw.specialCombos;
    const ds = parseDataset(raw);
    expect(ds.specialCombos).toEqual([]);
  });

  it('rejects null rank when meta.provisional is false (the "final" contract)', () => {
    const bad = load();
    bad.meta.provisional = false;
    const res = safeParseDataset(bad);
    expect(res.success).toBe(false);
    if (!res.success) {
      expect(res.error.issues.some((i) => i.path.join('.').endsWith('rank'))).toBe(true);
    }
  });

  it('rejects special combos referencing unknown species', () => {
    const bad = load();
    bad.specialCombos.push({ parents: ['Ghost', 'Sparkit'], child: 'Lamball', genderRule: null });
    expect(safeParseDataset(bad).success).toBe(false);
  });

  it('rejects an invalid gender ratio (> 1)', () => {
    const bad = load();
    bad.species[0].genderRatio = { male: 1.5, female: 0.5 };
    expect(safeParseDataset(bad).success).toBe(false);
  });
});
