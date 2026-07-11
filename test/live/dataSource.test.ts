import { describe, it, expect, vi } from 'vitest';
import type { Dataset } from '../../src/data/schema';
import { createHttpDataSource, createMockDataSource } from '../../src/live/dataSource';
import { FIXTURE_NOVA_UID, FIXTURE_PALS_BY_IDENTIFIER, FIXTURE_PLAYERS } from '../../src/live/fixtures';

function emptyDataset(): Dataset {
  return {
    meta: { version: 't', ruleset: 'combirank-0.6', provisional: true, source: 'test', generatedAt: '2026-01-01T00:00:00Z' },
    species: [],
    specialCombos: [],
    passives: [],
    passiveModel: { maxSlots: 4, inheritCountDist: [1], mutationDist: [1], verified: false },
  };
}

describe('createMockDataSource', () => {
  const dataset = emptyDataset();

  it('resolves fixture players through the real normalizer', async () => {
    const source = createMockDataSource({ players: FIXTURE_PLAYERS, palsByIdentifier: FIXTURE_PALS_BY_IDENTIFIER }, dataset);
    const result = await source.listPlayers();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.length).toBe(FIXTURE_PLAYERS.length);
  });

  it('resolves a specific player\'s pals, split from its base camps', async () => {
    const source = createMockDataSource({ players: FIXTURE_PLAYERS, palsByIdentifier: FIXTURE_PALS_BY_IDENTIFIER }, dataset);
    const result = await source.getPlayerPals(FIXTURE_NOVA_UID, 'The Guild');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.player.pals.length).toBeGreaterThan(0);
      expect(result.data.baseCamps.length).toBeGreaterThan(0);
    }
  });

  it('returns PLAYER_NOT_FOUND for an unknown identifier', async () => {
    const source = createMockDataSource({ players: FIXTURE_PLAYERS, palsByIdentifier: FIXTURE_PALS_BY_IDENTIFIER }, dataset);
    const result = await source.getPlayerPals('nope', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PLAYER_NOT_FOUND');
  });

  it('honors simulateError for both endpoints', async () => {
    const source = createMockDataSource(
      { players: [], palsByIdentifier: {}, simulateError: { code: 'INVALID_TOKEN', message: 'bad token' } },
      dataset,
    );
    const players = await source.listPlayers();
    expect(players.ok).toBe(false);
  });
});

describe('createHttpDataSource', () => {
  const dataset = emptyDataset();

  it('builds the documented request URL and omits Authorization when no token is set', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Meta: { PlayerCount: 0, OnlineCount: 0 }, Players: [] }),
    });
    const source = createHttpDataSource({ baseUrl: 'https://example.ts.net', fetchImpl }, dataset);
    await source.listPlayers();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.ts.net/v1/pdapi/players');
    expect((options.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('sends the Authorization header when a bearer token is configured', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ Meta: {}, Pals: { Team: {}, Palbox: {}, BaseCamps: [] } }),
    });
    const source = createHttpDataSource({ baseUrl: 'https://example.ts.net', bearerToken: 'secret', fetchImpl }, dataset);
    await source.getPlayerPals('player-1', '');

    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://example.ts.net/v1/pdapi/pals/player-1');
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer secret');
  });

  it('maps the documented error body shape on non-2xx responses', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ Error: { Code: 'PLAYER_NOT_FOUND', Message: 'no such player', Details: {} } }),
    });
    const source = createHttpDataSource({ baseUrl: 'https://example.ts.net', fetchImpl }, dataset);
    const result = await source.getPlayerPals('missing', '');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ code: 'PLAYER_NOT_FOUND', message: 'no such player' });
  });

  it('maps a network failure to NETWORK_ERROR without throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const source = createHttpDataSource({ baseUrl: 'https://example.ts.net', fetchImpl }, dataset);
    const result = await source.listPlayers();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('NETWORK_ERROR');
  });

  it('maps malformed JSON to INVALID_RESPONSE without throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('bad json');
      },
    });
    const source = createHttpDataSource({ baseUrl: 'https://example.ts.net', fetchImpl }, dataset);
    const result = await source.listPlayers();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_RESPONSE');
  });
});
