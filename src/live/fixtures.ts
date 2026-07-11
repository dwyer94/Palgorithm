import type { RawPal, RawPalsResponse, RawPlayer, PlayerIdentifier } from './types';

/**
 * Synthetic PalDefender-shaped data for the mock data source (see `dataSource.ts`) and for
 * unit tests. Shaped exactly like the documented raw responses (`docs/PalDefenderAPI/*.md`), and
 * built against real species/passive ids from the bundled dataset so normalization exercises
 * real lookups, not just structural plumbing. Deliberately includes:
 *  - a player with no `Name` and no seeded override (falls back to raw identifier)
 *  - a player with an empty `Name` but a seeded override (override wins, if configured)
 *  - a player with an in-game `Name` and no override (API name wins)
 *  - a player with no pals at all (empty Team/Palbox/BaseCamps)
 *  - one pal with an unresolvable `PalID` and one with an unresolvable passive, so the
 *    "flag, don't drop" path is exercised by default rather than only in hand-written tests
 *
 * Names and identifiers here are entirely made up — not tied to any real player or SteamID64
 * (see nameOverrides.example.ts for how personal overrides are seeded, kept out of this repo).
 */

function rawPal(overrides: Partial<RawPal> & Pick<RawPal, 'PalID' | 'Gender'>): RawPal {
  return {
    Nickname: '',
    Level: 10,
    Shiny: false,
    Passives: [],
    IVs: { Health: 60, AttackMelee: 60, AttackShot: 60, Defense: 60 },
    ExtraWorkSuitabilities: {},
    ...overrides,
  };
}

export const FIXTURE_NOVA_UID: PlayerIdentifier = '76561198000000001';
export const FIXTURE_EMBER_UID: PlayerIdentifier = '76561198000000002';
export const FIXTURE_WANDERER_UID: PlayerIdentifier = 'fixture-player-uid-wanderer';
export const FIXTURE_UNKNOWN_UID: PlayerIdentifier = 'fixture-player-uid-unknown';

export const FIXTURE_PLAYERS: RawPlayer[] = [
  {
    Name: 'NovaIngame',
    IP: '',
    PlayerUID: FIXTURE_NOVA_UID,
    UserId: FIXTURE_NOVA_UID,
    GuildName: 'The Guild',
    GuildUUID: '',
    Status: 'Online',
    WorldLocation: { x: 0, y: 0, z: 0 },
    MapLocation: { x: 0, y: 0, z: 0 },
  },
  {
    Name: '',
    IP: '',
    PlayerUID: FIXTURE_EMBER_UID,
    UserId: FIXTURE_EMBER_UID,
    GuildName: 'The Guild',
    GuildUUID: '',
    Status: 'Online',
    WorldLocation: { x: 0, y: 0, z: 0 },
    MapLocation: { x: 0, y: 0, z: 0 },
  },
  {
    Name: 'Wanderer99',
    IP: '',
    PlayerUID: FIXTURE_WANDERER_UID,
    UserId: '',
    GuildName: '',
    GuildUUID: '',
    Status: 'Offline',
    WorldLocation: { x: 0, y: 0, z: 0 },
    MapLocation: { x: 0, y: 0, z: 0 },
  },
  {
    Name: '',
    IP: '',
    PlayerUID: FIXTURE_UNKNOWN_UID,
    UserId: '',
    GuildName: '',
    GuildUUID: '',
    Status: 'Offline',
    WorldLocation: { x: 0, y: 0, z: 0 },
    MapLocation: { x: 0, y: 0, z: 0 },
  },
];

// Nova and Ember are both "The Guild" — PalDefender embeds every guild base camp in *each*
// member's `/pals/<id>` response (docs/PalDefenderAPI/pals.md), so `camp-1` deliberately
// appears in both fixtures below, identically. This exercises the base-camp dedup path
// (`normalizeBaseCamps` + `LiveContext`'s `baseCamps` state) rather than double-counting
// `camp-1`'s worker once per guild member.
const SHARED_CAMP_1 = {
  id: 'camp-1',
  level: 3,
  state: 'Active',
  pals: { 'bc1': rawPal({ PalID: 'Boar', Gender: 'Male', Level: 15 }) },
};

export const FIXTURE_PALS_BY_IDENTIFIER: Record<PlayerIdentifier, RawPalsResponse> = {
  [FIXTURE_NOVA_UID]: {
    Meta: { PlayerUID: FIXTURE_NOVA_UID, Player: FIXTURE_NOVA_UID, TeamCount: 1, PalboxCount: 1, BaseCampCount: 1 },
    Pals: {
      Team: {
        't1': rawPal({
          PalID: 'Anubis',
          Gender: 'Male',
          Level: 50,
          Passives: ['CraftSpeed_up3', 'Deffence_up2'],
          // Condensed Pal Soul bonuses — exercises effectiveWorkSuitabilities' species+bonus merge.
          ExtraWorkSuitabilities: { Handcraft: 2, Transport: 1 },
        }),
      },
      Palbox: {
        'p1': rawPal({ PalID: 'GoldenHorse', Gender: 'Female', Level: 20, Passives: ['CraftSpeed_up1'] }),
      },
      BaseCamps: [SHARED_CAMP_1],
    },
  },
  [FIXTURE_EMBER_UID]: {
    Meta: { PlayerUID: FIXTURE_EMBER_UID, Player: FIXTURE_EMBER_UID, TeamCount: 1, PalboxCount: 1, BaseCampCount: 1 },
    Pals: {
      Team: {
        't1': rawPal({ PalID: 'ElecLion', Gender: 'Female', Level: 35, Passives: ['Deffence_up3', 'FakePassive_XYZ'] }),
      },
      Palbox: {
        // Deliberately unresolvable species — exercises the "flag, don't drop" path.
        'p1': rawPal({ PalID: 'TotallyFakeSpecies_XYZ', Gender: 'Male', Level: 5 }),
      },
      BaseCamps: [SHARED_CAMP_1],
    },
  },
  [FIXTURE_WANDERER_UID]: {
    Meta: { PlayerUID: FIXTURE_WANDERER_UID, Player: FIXTURE_WANDERER_UID, TeamCount: 1, PalboxCount: 0, BaseCampCount: 0 },
    Pals: {
      Team: {
        // lowercase gender string — exercises case-insensitive gender normalization.
        't1': rawPal({ PalID: 'Carbunclo', Gender: 'male', Level: 25, Passives: ['CraftSpeed_up2'] }),
      },
      Palbox: {},
      BaseCamps: [],
    },
  },
  [FIXTURE_UNKNOWN_UID]: {
    Meta: { PlayerUID: FIXTURE_UNKNOWN_UID, Player: FIXTURE_UNKNOWN_UID, TeamCount: 0, PalboxCount: 0, BaseCampCount: 0 },
    Pals: { Team: {}, Palbox: {}, BaseCamps: [] },
  },
};
