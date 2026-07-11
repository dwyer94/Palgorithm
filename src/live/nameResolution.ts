import { baseCampIdFromIdentifier, isBaseCampIdentifier, shortBaseCampLabel, type LivePlayer, type PlayerIdentifier } from './types';

/**
 * Display name resolution order (docs/UI_REQUIREMENTS.md): a user-set override wins, then
 * PalDefender's own `Name` field (in-game character name, may be blank), then the raw
 * identifier as a last resort. This is deliberately NOT a live Steam Web API lookup — see
 * docs/UI_REQUIREMENTS.md for why (CORS blocks any browser-side call to Steam's API).
 *
 * `overrides` is keyed by SteamID64, not `PlayerUID` (see `LiveConnectionSettings`), so a
 * match also requires resolving the player's SteamID64 — from their live `userId` when
 * online, or from `identityLinks` (learned the last time they were online) when not.
 */
export function resolvePlayerDisplayName(
  player: LivePlayer,
  overrides: Record<string, string>,
  identityLinks: Record<PlayerIdentifier, string> = {},
): string {
  const steamId = extractSteamId64(player.userId) ?? identityLinks[player.identifier];
  return overrides[player.identifier] || (steamId && overrides[steamId]) || player.apiName || player.identifier;
}

/** PalDefender's `UserId` for Steam players looks like `steam_76561198000000001` — strips
 * the platform prefix to get the bare SteamID64 that `nameOverrides` is keyed by. Returns
 * `null` for blank/non-Steam ids rather than guessing. */
export function extractSteamId64(userId: string): string | null {
  const match = /^steam_(\d+)$/i.exec(userId.trim());
  return match?.[1] ?? null;
}

/** Builds an identifier -> display name lookup covering every currently known player/camp,
 * plus a readable fallback for any `selectedPlayerIds` entry that isn't currently in
 * `players` — most commonly a base camp whose entire guild is offline this session (a camp's
 * display metadata only ever comes from a live fetch, see `LiveContext`, never from
 * `selectedPlayerIds` alone, which is what's persisted). Without this fallback, downstream
 * views (Hub/Single-target "Pal pools", plan provenance owner tags) render the raw
 * `basecamp:<guid>` synthetic identifier instead of something a human can read. */
export function buildDisplayNameMap(
  players: LivePlayer[],
  selectedPlayerIds: Iterable<PlayerIdentifier>,
  overrides: Record<string, string>,
  identityLinks: Record<PlayerIdentifier, string> = {},
): Record<PlayerIdentifier, string> {
  const map: Record<PlayerIdentifier, string> = {};
  for (const p of players) {
    map[p.identifier] = resolvePlayerDisplayName(p, overrides, identityLinks);
  }
  for (const id of selectedPlayerIds) {
    if (id in map) continue;
    map[id] = isBaseCampIdentifier(id) ? `Base Camp ${shortBaseCampLabel(baseCampIdFromIdentifier(id))}` : id;
  }
  return map;
}

/** Learns PlayerUID -> SteamID64 links from a fresh players list, merging into `existing`
 * (persisted so offline players keep resolving — see `LiveConnectionSettings.identityLinks`).
 * Returns `existing` unchanged (same reference) when nothing new was learned, so callers can
 * skip a write. */
export function mergeIdentityLinks(
  players: LivePlayer[],
  existing: Record<PlayerIdentifier, string>,
): Record<PlayerIdentifier, string> {
  let next: Record<PlayerIdentifier, string> | null = null;
  for (const p of players) {
    const steamId = extractSteamId64(p.userId);
    if (steamId && existing[p.identifier] !== steamId) {
      next ??= { ...existing };
      next[p.identifier] = steamId;
    }
  }
  return next ?? existing;
}
