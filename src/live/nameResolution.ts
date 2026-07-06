import type { LivePlayer } from './types';

/**
 * Display name resolution order (docs/UI_REQUIREMENTS.md): a user-set override wins, then
 * PalDefender's own `Name` field (in-game character name, may be blank), then the raw
 * identifier as a last resort. This is deliberately NOT a live Steam Web API lookup — see
 * docs/UI_REQUIREMENTS.md for why (CORS blocks any browser-side call to Steam's API).
 */
export function resolvePlayerDisplayName(player: LivePlayer, overrides: Record<string, string>): string {
  return overrides[player.identifier] || player.apiName || player.identifier;
}
