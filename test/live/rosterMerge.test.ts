import { describe, it, expect } from 'vitest';
import { buildRosterForSolver } from '../../src/live/rosterMerge';
import type { RosterEntry } from '../../src/store/types';
import type { LivePal, LivePlayerPals } from '../../src/live/types';

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

describe('buildRosterForSolver', () => {
  const localRoster: RosterEntry[] = [{ id: 'r1', species: 'Boar', gender: 'male', passives: ['Swift'] }];

  it('includes only the local roster when no players are selected', () => {
    const result = buildRosterForSolver(localRoster, new Set(), {});
    expect(result).toEqual([{ species: 'Boar', gender: 'male', passives: ['Swift'] }]);
  });

  it('merges in resolved pals from selected players', () => {
    const pals: LivePlayerPals = {
      identifier: 'p1',
      pals: [livePal({ instanceId: 'i1', species: 'Anubis', gender: 'female', passives: ['Legend'] })],
    };
    const result = buildRosterForSolver(localRoster, new Set(['p1']), { p1: pals });
    expect(result).toContainEqual({ species: 'Anubis', gender: 'female', passives: ['Legend'] });
    expect(result).toHaveLength(2);
  });

  it('excludes pals with unresolved species or gender', () => {
    const pals: LivePlayerPals = {
      identifier: 'p1',
      pals: [
        livePal({ instanceId: 'i1', species: null, gender: 'male' }),
        livePal({ instanceId: 'i2', species: 'Boar', gender: null }),
      ],
    };
    const result = buildRosterForSolver([], new Set(['p1']), { p1: pals });
    expect(result).toEqual([]);
  });

  it('does not crash when a selected player has no cached pals yet', () => {
    const result = buildRosterForSolver([], new Set(['p1', 'p2']), { p1: undefined });
    expect(result).toEqual([]);
  });

  it('ignores players present in the pal cache but not selected', () => {
    const pals: LivePlayerPals = { identifier: 'p1', pals: [livePal({ instanceId: 'i1', species: 'Boar', gender: 'male' })] };
    const result = buildRosterForSolver([], new Set(), { p1: pals });
    expect(result).toEqual([]);
  });
});
