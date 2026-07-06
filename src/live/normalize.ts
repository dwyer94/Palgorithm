import type { Species, Passive } from '../data/schema';
import type { Gender } from '../ruleset/types';
import type {
  RawPal,
  RawPalsResponse,
  RawPlayer,
  LivePlayer,
  LivePal,
  LivePalLocation,
  LivePlayerPals,
  PlayerIdentifier,
  SpeciesId,
  PassiveId,
} from './types';

/**
 * The one adapter boundary between PalDefender's wire shape and our internal types
 * (spec-equivalent to `src/pipeline/normalize.ts`'s "quarantine all source messiness in one
 * file", but this runs in-browser against a live API rather than offline against a dump).
 * Every function here is pure — no I/O — so both the mock and real data sources can share it.
 */

export function normalizePlayer(raw: RawPlayer): LivePlayer {
  return {
    identifier: raw.PlayerUID,
    userId: raw.UserId,
    apiName: raw.Name,
    guildName: raw.GuildName,
    status: raw.Status,
  };
}

/** Never guesses (CLAUDE.md: don't invent data) — an unrecognized string resolves to `null`
 * so the UI can flag it rather than silently defaulting to a gender. */
export function normalizeGender(raw: string): Gender | null {
  const v = raw.trim().toLowerCase();
  if (v === 'male' || v === 'm') return 'male';
  if (v === 'female' || v === 'f') return 'female';
  return null;
}

function buildSpeciesIndex(speciesList: Species[]): Map<string, SpeciesId> {
  const index = new Map<string, SpeciesId>();
  for (const s of speciesList) {
    index.set(s.id.toLowerCase(), s.id);
    if (s.internalName) index.set(s.internalName.toLowerCase(), s.id);
    for (const alias of s.aliases ?? []) index.set(alias.toLowerCase(), s.id);
  }
  return index;
}

function buildPassiveIndex(passivesList: Passive[]): Map<string, PassiveId> {
  const index = new Map<string, PassiveId>();
  for (const p of passivesList) index.set(p.id.toLowerCase(), p.id);
  return index;
}

/** Matches against `Species.id`, then `internalName`, then `aliases` — the precedence the
 * schema's own doc comments anticipate ("internalName: raw game name, for matching across
 * sources"). Case-insensitive. Returns `null` (never throws) on no match. */
export function resolveSpeciesId(rawPalId: string, speciesList: Species[]): SpeciesId | null {
  return buildSpeciesIndex(speciesList).get(rawPalId.toLowerCase()) ?? null;
}

/** Matches against `Passive.id` only — the schema has no `internalName`/`aliases` on
 * `Passive`. Case-insensitive. Returns `null` on no match. */
export function resolvePassiveId(rawId: string, passivesList: Passive[]): PassiveId | null {
  return buildPassiveIndex(passivesList).get(rawId.toLowerCase()) ?? null;
}

function normalizePalWithIndices(
  raw: RawPal,
  instanceId: string,
  ownerIdentifier: PlayerIdentifier,
  location: LivePalLocation,
  speciesIndex: Map<string, SpeciesId>,
  passiveIndex: Map<string, PassiveId>,
): LivePal {
  const passives: PassiveId[] = [];
  const unresolvedPassives: string[] = [];
  for (const rawPassive of raw.Passives) {
    const resolved = passiveIndex.get(rawPassive.toLowerCase());
    if (resolved) passives.push(resolved);
    else unresolvedPassives.push(rawPassive);
  }

  return {
    instanceId,
    ownerIdentifier,
    location,
    rawPalId: raw.PalID,
    species: speciesIndex.get(raw.PalID.toLowerCase()) ?? null,
    rawGender: raw.Gender,
    gender: normalizeGender(raw.Gender),
    passives,
    unresolvedPassives,
    level: raw.Level,
    nickname: raw.Nickname,
    shiny: raw.Shiny,
    ivs: {
      health: raw.IVs.Health,
      attackMelee: raw.IVs.AttackMelee,
      attackShot: raw.IVs.AttackShot,
      defense: raw.IVs.Defense,
    },
  };
}

export function normalizePal(
  raw: RawPal,
  instanceId: string,
  ownerIdentifier: PlayerIdentifier,
  location: LivePalLocation,
  speciesList: Species[],
  passivesList: Passive[],
): LivePal {
  return normalizePalWithIndices(
    raw,
    instanceId,
    ownerIdentifier,
    location,
    buildSpeciesIndex(speciesList),
    buildPassiveIndex(passivesList),
  );
}

/** Flattens `Team` + `Palbox` + every `BaseCamps[].pals` into one array, tagging each with
 * its source location — the one place that understands the three-bucket `/pals/<id>` shape. */
export function normalizePlayerPals(
  identifier: PlayerIdentifier,
  raw: RawPalsResponse,
  speciesList: Species[],
  passivesList: Passive[],
): LivePlayerPals {
  const speciesIndex = buildSpeciesIndex(speciesList);
  const passiveIndex = buildPassiveIndex(passivesList);
  const pals: LivePal[] = [];

  for (const [instanceId, rawPal] of Object.entries(raw.Pals.Team)) {
    pals.push(normalizePalWithIndices(rawPal, instanceId, identifier, { kind: 'team' }, speciesIndex, passiveIndex));
  }
  for (const [instanceId, rawPal] of Object.entries(raw.Pals.Palbox)) {
    pals.push(normalizePalWithIndices(rawPal, instanceId, identifier, { kind: 'palbox' }, speciesIndex, passiveIndex));
  }
  for (const camp of raw.Pals.BaseCamps) {
    for (const [instanceId, rawPal] of Object.entries(camp.pals)) {
      pals.push(
        normalizePalWithIndices(
          rawPal,
          instanceId,
          identifier,
          { kind: 'baseCamp', baseCampId: camp.id },
          speciesIndex,
          passiveIndex,
        ),
      );
    }
  }

  return { identifier, pals };
}
