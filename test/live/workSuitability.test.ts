import { describe, it, expect } from 'vitest';
import type { Species } from '../../src/data/schema';
import { effectiveWorkSuitabilities } from '../../src/live/workSuitability';

function species(overrides: Partial<Species> & Pick<Species, 'id'>): Species {
  return {
    displayName: overrides.id,
    index: 0,
    standardBreedable: true,
    wildCatchable: true,
    otherObtainOnly: false,
    rank: 100,
    genderRatio: { male: 0.5, female: 0.5 },
    elements: [],
    ...overrides,
  };
}

describe('effectiveWorkSuitabilities', () => {
  it('sums species base level with the per-instance condense bonus', () => {
    const sp = species({
      id: 'Anubis',
      workSuitabilities: [
        { type: 'Handcraft', level: 4 },
        { type: 'Transport', level: 3 },
      ],
    });
    const result = effectiveWorkSuitabilities(sp, { extraWorkSuitabilities: { Handcraft: 2 } });
    expect(result).toEqual({ Handcraft: 6, Transport: 3 });
  });

  it('adds a bonus type the species has no base level for', () => {
    const sp = species({ id: 'Anubis', workSuitabilities: [{ type: 'Handcraft', level: 4 }] });
    const result = effectiveWorkSuitabilities(sp, { extraWorkSuitabilities: { Watering: 1 } });
    expect(result).toEqual({ Handcraft: 4, Watering: 1 });
  });

  it('returns an empty map when the species is unresolved and there is no bonus', () => {
    expect(effectiveWorkSuitabilities(undefined, { extraWorkSuitabilities: {} })).toEqual({});
  });
});
