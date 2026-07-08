import { describe, it, expect } from 'vitest';
import type { Species, Passive } from '../../src/data/schema';
import {
  normalizeGender,
  normalizePal,
  normalizePlayer,
  normalizePlayerPals,
  resolvePassiveId,
  resolveSpeciesId,
} from '../../src/live/normalize';
import type { RawPal, RawPalsResponse, RawPlayer } from '../../src/live/types';

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

function passive(overrides: Partial<Passive> & Pick<Passive, 'id'>): Passive {
  return { displayName: overrides.id, categories: [], ...overrides };
}

const SPECIES: Species[] = [
  species({ id: 'Relaxaurus_Lux', internalName: 'SheepBall_Dark' }),
  species({ id: 'Boar', aliases: ['WildBoar'] }),
];
const PASSIVES: Passive[] = [passive({ id: 'CraftSpeed_up3' }), passive({ id: 'Deffence_up2' })];

function rawPal(overrides: Partial<RawPal> & Pick<RawPal, 'PalID' | 'Gender'>): RawPal {
  return {
    Nickname: '',
    Level: 10,
    Shiny: false,
    Passives: [],
    IVs: { Health: 50, AttackMelee: 50, AttackShot: 50, Defense: 50 },
    ...overrides,
  };
}

function rawPlayer(overrides: Partial<RawPlayer> & Pick<RawPlayer, 'PlayerUID'>): RawPlayer {
  return {
    Name: '',
    IP: '',
    UserId: '',
    GuildName: '',
    GuildUUID: '',
    Status: 'Online',
    WorldLocation: { x: 0, y: 0, z: 0 },
    MapLocation: { x: 0, y: 0, z: 0 },
    ...overrides,
  };
}

describe('normalizePlayer', () => {
  it('maps all fields, passing empty strings through as-is', () => {
    const raw = rawPlayer({ PlayerUID: 'uid-1', UserId: '', Name: 'Alice', GuildName: 'G' });
    expect(normalizePlayer(raw)).toEqual({
      identifier: 'uid-1',
      userId: '',
      apiName: 'Alice',
      guildName: 'G',
      status: 'Online',
    });
  });
});

describe('normalizeGender', () => {
  it.each(['Male', 'male', 'MALE', 'm'])('maps %s to male', (v) => {
    expect(normalizeGender(v)).toBe('male');
  });
  it.each(['Female', 'female', 'FEMALE', 'f'])('maps %s to female', (v) => {
    expect(normalizeGender(v)).toBe('female');
  });
  it('never guesses on an unrecognized string', () => {
    expect(normalizeGender('Unknown')).toBeNull();
    expect(normalizeGender('')).toBeNull();
  });
});

describe('resolveSpeciesId', () => {
  it('matches on id (case-insensitive)', () => {
    expect(resolveSpeciesId('boar', SPECIES)).toBe('Boar');
  });
  it('matches on internalName (case-insensitive)', () => {
    expect(resolveSpeciesId('sheepball_dark', SPECIES)).toBe('Relaxaurus_Lux');
  });
  it('matches on aliases', () => {
    expect(resolveSpeciesId('WildBoar', SPECIES)).toBe('Boar');
  });
  it('returns null for no match, never throws', () => {
    expect(resolveSpeciesId('NotARealSpecies', SPECIES)).toBeNull();
  });
});

describe('resolvePassiveId', () => {
  it('matches on id only, case-insensitive', () => {
    expect(resolvePassiveId('craftspeed_up3', PASSIVES)).toBe('CraftSpeed_up3');
  });
  it('returns null for no match', () => {
    expect(resolvePassiveId('NotARealPassive', PASSIVES)).toBeNull();
  });
});

describe('normalizePal', () => {
  it('resolves species/gender/passives and renames IV fields', () => {
    const raw = rawPal({
      PalID: 'Boar',
      Gender: 'Male',
      Level: 42,
      Shiny: true,
      Nickname: 'Bacon',
      Passives: ['CraftSpeed_up3', 'FakePassive'],
      IVs: { Health: 1, AttackMelee: 2, AttackShot: 3, Defense: 4 },
    });
    const pal = normalizePal(raw, 'inst-1', 'owner-1', { kind: 'team' }, SPECIES, PASSIVES);
    expect(pal).toEqual({
      instanceId: 'inst-1',
      ownerIdentifier: 'owner-1',
      location: { kind: 'team' },
      rawPalId: 'Boar',
      species: 'Boar',
      rawGender: 'Male',
      gender: 'male',
      passives: ['CraftSpeed_up3'],
      unresolvedPassives: ['FakePassive'],
      level: 42,
      nickname: 'Bacon',
      shiny: true,
      ivs: { health: 1, attackMelee: 2, attackShot: 3, defense: 4 },
    });
  });

  it('flags an unresolvable species instead of dropping the pal', () => {
    const raw = rawPal({ PalID: 'TotallyFake', Gender: 'Female' });
    const pal = normalizePal(raw, 'inst-2', 'owner-1', { kind: 'palbox' }, SPECIES, PASSIVES);
    expect(pal.species).toBeNull();
    expect(pal.rawPalId).toBe('TotallyFake');
  });
});

describe('normalizePlayerPals', () => {
  it('flattens Team + Palbox + multiple BaseCamps, tagging each with its location', () => {
    const raw: RawPalsResponse = {
      Meta: { PlayerUID: 'owner-1', Player: 'owner-1', TeamCount: 1, PalboxCount: 1, BaseCampCount: 2 },
      Pals: {
        // Overlapping instance-id-looking keys across buckets — location must disambiguate.
        Team: { same_id: rawPal({ PalID: 'Boar', Gender: 'Male' }) },
        Palbox: { same_id: rawPal({ PalID: 'Relaxaurus_Lux', Gender: 'Female' }) },
        BaseCamps: [
          { id: 'camp-a', level: 1, state: 'Active', pals: { same_id: rawPal({ PalID: 'Boar', Gender: 'Female' }) } },
          { id: 'camp-b', level: 2, state: 'Active', pals: { other_id: rawPal({ PalID: 'Boar', Gender: 'Male' }) } },
        ],
      },
    };

    const result = normalizePlayerPals('owner-1', raw, SPECIES, PASSIVES);
    expect(result.identifier).toBe('owner-1');
    expect(result.pals).toHaveLength(4);

    const byLocation = result.pals.map((p) => p.location);
    expect(byLocation).toContainEqual({ kind: 'team' });
    expect(byLocation).toContainEqual({ kind: 'palbox' });
    expect(byLocation).toContainEqual({ kind: 'baseCamp', baseCampId: 'camp-a' });
    expect(byLocation).toContainEqual({ kind: 'baseCamp', baseCampId: 'camp-b' });

    // Same raw instance id, different buckets -> both present, distinguished by location.
    const sameIdPals = result.pals.filter((p) => p.instanceId === 'same_id');
    expect(sameIdPals).toHaveLength(3);
  });
});
