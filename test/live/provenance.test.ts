import { describe, it, expect } from 'vitest';
import { annotateSpeciesPlan, matchProvenance } from '../../src/live/provenance';
import type { LivePal, LivePlayerPals } from '../../src/live/types';
import type { PlanIndividual, SpeciesPlanResult } from '../../src/solver/types';

function livePal(overrides: Partial<LivePal> & Pick<LivePal, 'instanceId' | 'species' | 'gender'>): LivePal {
  return {
    ownerIdentifier: 'p1',
    location: { kind: 'team' },
    rawPalId: overrides.species ?? 'Unknown',
    rawGender: overrides.gender ?? '',
    passives: [],
    unresolvedPassives: [],
    level: 1,
    nickname: '',
    shiny: false,
    ivs: { health: 0, attackMelee: 0, attackShot: 0, defense: 0 },
    ...overrides,
  };
}

const individual: PlanIndividual = { species: 'Boar', gender: 'male', passives: ['Legend'] };
const names = { p1: 'Alice', p2: 'Bob' };

describe('matchProvenance', () => {
  it('returns a confident match for a single unambiguous candidate', () => {
    const palsByPlayer = {
      p1: { identifier: 'p1', pals: [livePal({ instanceId: 'i1', species: 'Boar', gender: 'male', passives: ['Legend'] })] },
    };
    const claimed = new Set<string>();
    const match = matchProvenance(individual, new Set(['p1']), palsByPlayer, names, claimed);
    expect(match).toEqual({ ownerIdentifier: 'p1', ownerDisplayName: 'Alice', confident: true });
    expect(claimed.has('i1')).toBe(true);
  });

  it('returns undefined when nothing matches', () => {
    const claimed = new Set<string>();
    const match = matchProvenance(individual, new Set(['p1']), {}, names, claimed);
    expect(match).toBeUndefined();
  });

  it('marks ambiguous matches as not confident and claims distinct instances across a pass', () => {
    const palsByPlayer: Record<string, LivePlayerPals> = {
      p1: {
        identifier: 'p1',
        pals: [
          livePal({ instanceId: 'i1', species: 'Boar', gender: 'male' }),
          livePal({ instanceId: 'i2', species: 'Boar', gender: 'male' }),
        ],
      },
    };
    const cleanIndividual: PlanIndividual = { species: 'Boar', gender: 'male' };
    const claimed = new Set<string>();
    const first = matchProvenance(cleanIndividual, new Set(['p1']), palsByPlayer, names, claimed);
    const second = matchProvenance(cleanIndividual, new Set(['p1']), palsByPlayer, names, claimed);
    expect(first?.confident).toBe(false);
    expect(second?.confident).toBe(true); // only one candidate left once the first is claimed
    expect(first?.ownerIdentifier).toBe('p1');
    expect(second?.ownerIdentifier).toBe('p1');
  });

  it('prefers a passives-superset match over a same-species/gender candidate missing them', () => {
    const palsByPlayer: Record<string, LivePlayerPals> = {
      p1: { identifier: 'p1', pals: [livePal({ instanceId: 'plain', species: 'Boar', gender: 'male', passives: [] })] },
      p2: { identifier: 'p2', pals: [livePal({ instanceId: 'perked', species: 'Boar', gender: 'male', passives: ['Legend'] })] },
    };
    const claimed = new Set<string>();
    const match = matchProvenance(individual, new Set(['p1', 'p2']), palsByPlayer, names, claimed);
    expect(match?.ownerIdentifier).toBe('p2');
    expect(match?.confident).toBe(true);
  });
});

describe('annotateSpeciesPlan', () => {
  it('annotates step parents that match a live pal and leaves unmatched ones absent', () => {
    const plan: SpeciesPlanResult = {
      target: 'Foo',
      feasible: true,
      combinationCount: 1,
      cost: 1,
      steps: [
        {
          parentA: { species: 'Boar', gender: 'male' },
          parentB: { species: 'Deer', gender: 'female' },
          child: 'Foo',
        },
      ],
      catches: [],
    };
    const palsByPlayer: Record<string, LivePlayerPals> = {
      p1: { identifier: 'p1', pals: [livePal({ instanceId: 'i1', species: 'Boar', gender: 'male' })] },
    };
    const result = annotateSpeciesPlan(plan, new Set(['p1']), palsByPlayer, names);
    expect(result.get('step:0:A')).toEqual({ ownerIdentifier: 'p1', ownerDisplayName: 'Alice', confident: true });
    expect(result.has('step:0:B')).toBe(false);
  });
});
