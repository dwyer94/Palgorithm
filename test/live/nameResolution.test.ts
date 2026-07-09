import { describe, it, expect } from 'vitest';
import { extractSteamId64, mergeIdentityLinks, resolvePlayerDisplayName } from '../../src/live/nameResolution';
import type { LivePlayer } from '../../src/live/types';

function player(overrides: Partial<LivePlayer> & Pick<LivePlayer, 'identifier'>): LivePlayer {
  return { userId: '', apiName: '', guildName: '', status: 'Online', ...overrides };
}

describe('resolvePlayerDisplayName', () => {
  it('prefers a manual override over the API name', () => {
    const p = player({ identifier: 'id-1', apiName: 'InGameName' });
    expect(resolvePlayerDisplayName(p, { 'id-1': 'Override' })).toBe('Override');
  });

  it('falls back to the API name when there is no override', () => {
    const p = player({ identifier: 'id-1', apiName: 'InGameName' });
    expect(resolvePlayerDisplayName(p, {})).toBe('InGameName');
  });

  it('falls back to the raw identifier when both override and API name are absent', () => {
    const p = player({ identifier: 'id-1', apiName: '' });
    expect(resolvePlayerDisplayName(p, {})).toBe('id-1');
  });

  it('resolves a SteamID64-keyed override via the live userId when identifier is the PlayerUID', () => {
    const p = player({ identifier: 'player-uid-1', userId: 'steam_76561198061667425', apiName: '' });
    expect(resolvePlayerDisplayName(p, { '76561198061667425': 'InputComet' })).toBe('InputComet');
  });

  it('resolves a SteamID64-keyed override via identityLinks when the player is offline (blank userId)', () => {
    const p = player({ identifier: 'player-uid-1', userId: '', apiName: '' });
    const identityLinks = { 'player-uid-1': '76561198061667425' };
    expect(resolvePlayerDisplayName(p, { '76561198061667425': 'InputComet' }, identityLinks)).toBe('InputComet');
  });
});

describe('extractSteamId64', () => {
  it('strips the steam_ prefix', () => {
    expect(extractSteamId64('steam_76561198061667425')).toBe('76561198061667425');
  });

  it('returns null for a blank or non-Steam userId', () => {
    expect(extractSteamId64('')).toBeNull();
    expect(extractSteamId64('xbox_abc123')).toBeNull();
  });
});

describe('mergeIdentityLinks', () => {
  it('learns a new PlayerUID -> SteamID64 link', () => {
    const p = player({ identifier: 'player-uid-1', userId: 'steam_76561198061667425' });
    expect(mergeIdentityLinks([p], {})).toEqual({ 'player-uid-1': '76561198061667425' });
  });

  it('returns the same reference when nothing new was learned (offline players have blank userId)', () => {
    const existing = { 'player-uid-1': '76561198061667425' };
    const online = player({ identifier: 'player-uid-1', userId: 'steam_76561198061667425' });
    const offline = player({ identifier: 'player-uid-2', userId: '' });
    expect(mergeIdentityLinks([online, offline], existing)).toBe(existing);
  });
});
