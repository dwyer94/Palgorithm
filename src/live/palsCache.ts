import type { LivePlayerPals, PlayerIdentifier } from './types';

/**
 * Last-known-good `/pals/<id>` responses, persisted across page loads/sessions. Exists
 * because PalDefender's `/pals/<id>` 404s (`PLAYER_NOT_FOUND`) for any player who isn't
 * currently online — the game-thread callback that serves it has nothing to read. Without
 * this, every offline player's box goes blank on refresh even though we saw it minutes ago.
 * `LiveContext` hydrates from here on mount and writes through on every successful fetch;
 * it never gets cleared on failure, so a fetch failure just means "keep showing the cache."
 */

const STORAGE_KEY = 'palcalc.live.palsCache';

interface CachedEntry {
  pals: LivePlayerPals;
  fetchedAt: string;
}

type CacheShape = Record<PlayerIdentifier, CachedEntry>;

function readCache(): CacheShape {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as CacheShape;
  } catch {
    return {};
  }
}

export function loadPalsCache(): CacheShape {
  return readCache();
}

export function savePalsCacheEntry(identifier: PlayerIdentifier, pals: LivePlayerPals): void {
  const cache = readCache();
  cache[identifier] = { pals, fetchedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}
