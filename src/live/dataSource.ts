import type { Dataset } from '../data/schema';
import { normalizeBaseCamps, normalizePlayer, normalizePlayerPals } from './normalize';
import type {
  LiveBaseCamp,
  LivePlayer,
  LivePlayerPals,
  PlayerIdentifier,
  RawApiError,
  RawPalsResponse,
  RawPlayer,
  RawPlayersResponse,
} from './types';

/**
 * The swappable seam for where live pal data comes from — a real PalDefender-mirroring
 * proxy (`createHttpDataSource`) or in-memory fixtures (`createMockDataSource`) for
 * developing/testing this feature before the proxy exists (piece 2). Both implementations
 * funnel raw data through the same `normalize.ts` functions, so the mock exercises the real
 * adapter rather than standing in for it.
 */

export interface LiveDataSourceError {
  code: string;
  message: string;
}

/** `meta` carries the HTTP status + round-trip latency when the request actually hit the
 * network — absent for the mock source, whose "connection" is synthetic. Used by the
 * Settings "Test connection" affordance (design handoff: `✓ 200 OK · 6 players · 128ms`). */
export type LiveResultMeta = { status: number; latencyMs: number };
export type LiveResult<T> = { ok: true; data: T; meta?: LiveResultMeta | undefined } | { ok: false; error: LiveDataSourceError };

/** `/pals/<id>` embeds every guild base camp in each member's response, so it's split here
 * into the player's own Team/Palbox (`player`) and the guild's base camps (`baseCamps`) —
 * see `LiveBaseCamp` in types.ts for why camps can't stay attributed to the reporting player. */
export interface PlayerPalsResult {
  player: LivePlayerPals;
  baseCamps: { camp: LiveBaseCamp; pals: LivePlayerPals }[];
}

export interface LiveDataSource {
  listPlayers(): Promise<LiveResult<LivePlayer[]>>;
  getPlayerPals(identifier: PlayerIdentifier, reporterGuildName: string): Promise<LiveResult<PlayerPalsResult>>;
}

// --- HTTP implementation --------------------------------------------------------------

export interface HttpDataSourceConfig {
  baseUrl: string;
  bearerToken?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8000;

function isRawApiError(body: unknown): body is RawApiError {
  return typeof body === 'object' && body !== null && 'Error' in body;
}

async function pdFetch<T>(
  path: string,
  config: HttpDataSourceConfig,
): Promise<LiveResult<T>> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const base = config.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (config.bearerToken) headers.Authorization = `Bearer ${config.bearerToken}`;
  const start = performance.now();

  let response: Response;
  try {
    response = await fetchImpl(`${base}${path}`, {
      headers,
      signal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      return { ok: false, error: { code: 'REQUEST_TIMEOUT', message: 'Request to the proxy timed out.' } };
    }
    return { ok: false, error: { code: 'NETWORK_ERROR', message: err instanceof Error ? err.message : String(err) } };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, error: { code: 'INVALID_RESPONSE', message: 'Response was not valid JSON.' } };
  }

  if (!response.ok) {
    if (isRawApiError(body)) {
      return { ok: false, error: { code: body.Error.Code, message: body.Error.Message } };
    }
    return { ok: false, error: { code: 'HTTP_ERROR', message: `HTTP ${response.status}` } };
  }

  return { ok: true, data: body as T, meta: { status: response.status, latencyMs: Math.round(performance.now() - start) } };
}

export function createHttpDataSource(config: HttpDataSourceConfig, dataset: Dataset): LiveDataSource {
  return {
    async listPlayers() {
      const result = await pdFetch<RawPlayersResponse>('/v1/pdapi/players', config);
      if (!result.ok) return result;
      return { ok: true, data: result.data.Players.map((p: RawPlayer) => normalizePlayer(p)) };
    },
    async getPlayerPals(identifier: PlayerIdentifier, reporterGuildName: string) {
      const result = await pdFetch<RawPalsResponse>(`/v1/pdapi/pals/${encodeURIComponent(identifier)}`, config);
      if (!result.ok) return result;
      return {
        ok: true,
        data: {
          player: normalizePlayerPals(identifier, result.data, dataset.species, dataset.passives),
          baseCamps: normalizeBaseCamps(result.data, reporterGuildName, dataset.species, dataset.passives),
        },
        meta: result.meta,
      };
    },
  };
}

// --- Mock implementation --------------------------------------------------------------

export interface MockDataSourceConfig {
  players: RawPlayer[];
  palsByIdentifier: Record<PlayerIdentifier, RawPalsResponse>;
  simulateLatencyMs?: number;
  simulateError?: LiveDataSourceError;
}

async function maybeDelay(ms: number | undefined): Promise<void> {
  if (ms && ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockDataSource(config: MockDataSourceConfig, dataset: Dataset): LiveDataSource {
  return {
    async listPlayers() {
      await maybeDelay(config.simulateLatencyMs);
      if (config.simulateError) return { ok: false, error: config.simulateError };
      return { ok: true, data: config.players.map((p) => normalizePlayer(p)) };
    },
    async getPlayerPals(identifier: PlayerIdentifier, reporterGuildName: string) {
      await maybeDelay(config.simulateLatencyMs);
      if (config.simulateError) return { ok: false, error: config.simulateError };
      const raw = config.palsByIdentifier[identifier];
      if (!raw) return { ok: false, error: { code: 'PLAYER_NOT_FOUND', message: `No fixture pals for ${identifier}` } };
      return {
        ok: true,
        data: {
          player: normalizePlayerPals(identifier, raw, dataset.species, dataset.passives),
          baseCamps: normalizeBaseCamps(raw, reporterGuildName, dataset.species, dataset.passives),
        },
      };
    },
  };
}

// --- Selection -------------------------------------------------------------------------

/** Empty base URL -> mock data source; otherwise the real HTTP client. No manual toggle in
 * the UI — the moment a base URL is entered, the real thing is used. */
export function selectDataSource(
  settings: { live: { baseUrl: string; bearerToken: string } },
  dataset: Dataset,
  mockConfig: MockDataSourceConfig,
): { source: LiveDataSource; isMock: boolean } {
  if (!settings.live.baseUrl.trim()) {
    return { source: createMockDataSource(mockConfig, dataset), isMock: true };
  }
  return {
    source: createHttpDataSource(
      { baseUrl: settings.live.baseUrl, ...(settings.live.bearerToken && { bearerToken: settings.live.bearerToken }) },
      dataset,
    ),
    isMock: false,
  };
}
