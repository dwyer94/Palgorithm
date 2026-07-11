import type { Gender, PassiveId, SpeciesId } from '../ruleset/types';

export type { Gender, PassiveId, SpeciesId };

/**
 * Raw PalDefender REST API shapes (subset of fields we read), per docs/PalDefenderAPI/*.md and
 * https://ultimeit.github.io/PalDefender/RESTAPI/. `/pals/<id>` groups pals by location
 * (Team/Palbox/BaseCamps) and keys each group by pal instance ID — NOT a flat array.
 */

export interface RawLocation {
  x: number;
  y: number;
  z: number;
}

export interface RawPlayer {
  Name: string;
  IP: string;
  PlayerUID: string;
  UserId: string;
  GuildName: string;
  GuildUUID: string;
  Status: string;
  WorldLocation: RawLocation;
  MapLocation: RawLocation;
}

export interface RawPlayersResponse {
  Meta: { PlayerCount: number; OnlineCount: number };
  Players: RawPlayer[];
}

export interface RawIVs {
  Health: number;
  AttackMelee: number;
  AttackShot: number;
  Defense: number;
}

export interface RawPal {
  PalID: string;
  Nickname: string;
  Gender: string;
  Level: number;
  Shiny: boolean;
  Passives: string[];
  IVs: RawIVs;
}

export interface RawBaseCamp {
  id: string;
  level: number;
  state: string;
  pals: Record<string, RawPal>;
}

export interface RawPalsResponse {
  Meta: {
    PlayerUID: string;
    Player: string;
    TeamCount: number;
    PalboxCount: number;
    BaseCampCount: number;
  };
  Pals: {
    Team: Record<string, RawPal>;
    Palbox: Record<string, RawPal>;
    BaseCamps: RawBaseCamp[];
  };
}

export interface RawApiError {
  Error: { Code: string; Message: string; Details: unknown };
}

// --- Normalized shapes (what the rest of the app consumes) --------------------------------

/** PalDefender's `PlayerUID` — always populated, unlike `UserId` ("platform user ID, or
 * empty string when unavailable"), so it's the stable identifier we key on throughout.
 * VERIFY once the real proxy is live: confirm `PlayerUID` is in fact stable/reliable and
 * decide whether `UserId` needs surfacing for cross-referencing SteamID64s directly. */
export type PlayerIdentifier = string;

export interface LivePlayer {
  identifier: PlayerIdentifier;
  userId: string;
  apiName: string;
  guildName: string;
  status: string;
}

export type LivePalLocation = { kind: 'team' } | { kind: 'palbox' } | { kind: 'baseCamp'; baseCampId: string };

/** Base camps are guild-wide, not player-owned: PalDefender's `/pals/<id>` embeds every
 * guild base camp in *each* member's response (docs/PalDefenderAPI/pals.md: "Guild base
 * camps and their assigned worker Pals"). So the same camp — and its worker Pals — shows up
 * once per online guild member who gets fetched. Treating those workers as owned by whichever
 * player happened to be fetched double- (or N-times-) counts them once more than one guild
 * member is selected. Instead each unique camp is normalized as its own entity, keyed by this
 * synthetic identifier, so it is fetched/deduped/selected exactly once regardless of guild size. */
export function baseCampIdentifier(campId: string): PlayerIdentifier {
  return `basecamp:${campId}`;
}

export function isBaseCampIdentifier(identifier: PlayerIdentifier): boolean {
  return identifier.startsWith('basecamp:');
}

export interface LiveBaseCamp {
  identifier: PlayerIdentifier;
  campId: string;
  level: number;
  state: string;
  /** The guild the reporting player belonged to, for display — base camps have no owner of
   * their own, so this is inherited from whichever player's response we saw it in. */
  guildName: string;
}

/**
 * One normalized pal. `species`/`gender` are `null` when the raw value didn't resolve
 * against the bundled dataset — never guessed (CLAUDE.md: don't invent data). Unresolved
 * passives are dropped from `passives` but kept in `unresolvedPassives` so the UI can flag
 * them rather than silently under-counting a pal's perks.
 */
export interface LivePal {
  instanceId: string;
  ownerIdentifier: PlayerIdentifier;
  location: LivePalLocation;
  rawPalId: string;
  species: SpeciesId | null;
  rawGender: string;
  gender: Gender | null;
  passives: PassiveId[];
  unresolvedPassives: string[];
  level: number;
  nickname: string;
  shiny: boolean;
  ivs: { health: number; attackMelee: number; attackShot: number; defense: number };
}

export interface LivePlayerPals {
  identifier: PlayerIdentifier;
  pals: LivePal[];
}
