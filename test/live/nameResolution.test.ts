import { describe, it, expect } from 'vitest';
import { buildDisplayNameMap, extractSteamId64, mergeIdentityLinks, resolvePlayerDisplayName } from '../../src/live/nameResolution';
import { baseCampIdentifier, type LivePlayer } from '../../src/live/types';

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
    const p = player({ identifier: 'player-uid-1', userId: 'steam_76561198000000099', apiName: '' });
    expect(resolvePlayerDisplayName(p, { '76561198000000099': 'Ember' })).toBe('Ember');
  });

  it('resolves a SteamID64-keyed override via identityLinks when the player is offline (blank userId)', () => {
    const p = player({ identifier: 'player-uid-1', userId: '', apiName: '' });
    const identityLinks = { 'player-uid-1': '76561198000000099' };
    expect(resolvePlayerDisplayName(p, { '76561198000000099': 'Ember' }, identityLinks)).toBe('Ember');
  });
});

describe('extractSteamId64', () => {
  it('strips the steam_ prefix', () => {
    expect(extractSteamId64('steam_76561198000000099')).toBe('76561198000000099');
  });

  it('returns null for a blank or non-Steam userId', () => {
    expect(extractSteamId64('')).toBeNull();
    expect(extractSteamId64('xbox_abc123')).toBeNull();
  });
});

describe('buildDisplayNameMap', () => {
  it('resolves every known player via resolvePlayerDisplayName', () => {
    const p = player({ identifier: 'id-1', apiName: 'InGameName' });
    const map = buildDisplayNameMap([p], ['id-1'], {});
    expect(map).toEqual({ 'id-1': 'InGameName' });
  });

  it('falls back to a short readable label for a selected base camp missing from `players`', () => {
    // Simulates the whole guild being offline this session — the camp's `LiveBaseCamp`
    // metadata (and thus its `LivePlayer` row) never got discovered, but its identifier is
    // still in `selectedPlayerIds` from a previous session (persisted to localStorage).
    const id = baseCampIdentifier('33A9250A-405B2528-D9A32299-67712BC9');
    const map = buildDisplayNameMap([], [id], {});
    expect(map[id]).toBe('Base Camp 67712BC9');
  });

  it('falls back to the raw identifier for a selected non-camp id missing from `players`', () => {
    const map = buildDisplayNameMap([], ['some-uid'], {});
    expect(map['some-uid']).toBe('some-uid');
  });
});

describe('mergeIdentityLinks', () => {
  it('learns a new PlayerUID -> SteamID64 link', () => {
    const p = player({ identifier: 'player-uid-1', userId: 'steam_76561198000000099' });
    expect(mergeIdentityLinks([p], {})).toEqual({ 'player-uid-1': '76561198000000099' });
  });

  it('returns the same reference when nothing new was learned (offline players have blank userId)', () => {
    const existing = { 'player-uid-1': '76561198000000099' };
    const online = player({ identifier: 'player-uid-1', userId: 'steam_76561198000000099' });
    const offline = player({ identifier: 'player-uid-2', userId: '' });
    expect(mergeIdentityLinks([online, offline], existing)).toBe(existing);
  });
});
