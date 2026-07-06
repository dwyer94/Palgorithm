import { describe, it, expect } from 'vitest';
import { resolvePlayerDisplayName } from '../../src/live/nameResolution';
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
});
