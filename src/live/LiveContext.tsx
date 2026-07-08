import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSettings } from '../store/hooks';
import { useRulesetContext } from '../ui/RulesetContext';
import { selectDataSource, type LiveDataSourceError, type LiveResultMeta } from './dataSource';
import { FIXTURE_PALS_BY_IDENTIFIER, FIXTURE_PLAYERS } from './fixtures';
import type { LivePlayer, LivePlayerPals, PlayerIdentifier } from './types';

/**
 * Live connection state, mirroring `RulesetContext`'s "load once, expose via context"
 * pattern but stateful: connection status, cached player/pal data, refresh controls, and
 * `selectedPlayerIds` (which connected players feed the planner views). Selection lives
 * here rather than per-view since it's cross-cutting and should survive tab switches; it is
 * deliberately NOT persisted to localStorage (re-established each session).
 */

export type ConnectionStatus = 'unconfigured' | 'connecting' | 'connected' | 'error';

interface LiveContextValue {
  status: ConnectionStatus;
  isUsingMock: boolean;
  players: LivePlayer[];
  lastRefreshedAt: string | null;
  lastConnectionMeta: LiveResultMeta | null;
  error: LiveDataSourceError | null;
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>;
  palsLoading: Set<PlayerIdentifier>;
  /** Per-player pal-fetch failures, distinct from the whole-list `error` above — a single
   * player's box failing to load shouldn't be indistinguishable from every player failing. */
  palsError: Record<PlayerIdentifier, LiveDataSourceError | undefined>;
  refreshPlayers: () => Promise<void>;
  refreshPlayerPals: (identifier: PlayerIdentifier) => Promise<void>;
  selectedPlayerIds: Set<PlayerIdentifier>;
  setSelectedPlayerIds: (ids: Set<PlayerIdentifier>) => void;
  /** Epoch ms of the next scheduled auto-poll, or null when auto-poll is off. */
  nextPollAt: number | null;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [settings] = useSettings();
  const { dataset } = useRulesetContext();

  const [status, setStatus] = useState<ConnectionStatus>('unconfigured');
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [lastConnectionMeta, setLastConnectionMeta] = useState<LiveResultMeta | null>(null);
  const [error, setError] = useState<LiveDataSourceError | null>(null);
  const [palsByPlayer, setPalsByPlayer] = useState<Record<PlayerIdentifier, LivePlayerPals | undefined>>({});
  const [palsLoading, setPalsLoading] = useState<Set<PlayerIdentifier>>(new Set());
  const [palsError, setPalsError] = useState<Record<PlayerIdentifier, LiveDataSourceError | undefined>>({});
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<PlayerIdentifier>>(new Set());
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);

  const { source, isMock } = useMemo(
    () => selectDataSource(settings, dataset, { players: FIXTURE_PLAYERS, palsByIdentifier: FIXTURE_PALS_BY_IDENTIFIER }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.live.baseUrl, settings.live.bearerToken, dataset],
  );

  const refreshPlayers = useCallback(async () => {
    setStatus((s) => (s === 'connected' ? s : 'connecting'));
    const result = await source.listPlayers();
    if (result.ok) {
      setPlayers(result.data);
      setStatus('connected');
      setError(null);
      setLastRefreshedAt(new Date().toISOString());
      setLastConnectionMeta(result.meta ?? null);
    } else {
      setStatus('error');
      setError(result.error);
      setLastConnectionMeta(null);
    }
  }, [source]);

  const refreshPlayerPals = useCallback(
    async (identifier: PlayerIdentifier) => {
      setPalsLoading((prev) => new Set(prev).add(identifier));
      const result = await source.getPlayerPals(identifier);
      setPalsLoading((prev) => {
        const next = new Set(prev);
        next.delete(identifier);
        return next;
      });
      // Per-player fetch failures are tracked in `palsError`, distinct from the whole-list
      // `error` (which is for player-list-level failures) — the row can show a targeted
      // retry rather than being lumped in with a total connection failure.
      if (result.ok) {
        setPalsByPlayer((prev) => ({ ...prev, [identifier]: result.data }));
        setPalsError((prev) => ({ ...prev, [identifier]: undefined }));
      } else {
        setPalsError((prev) => ({ ...prev, [identifier]: result.error }));
      }
    },
    [source],
  );

  useEffect(() => {
    void refreshPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (!settings.live.autoPollEnabled) {
      setNextPollAt(null);
      return;
    }
    const intervalMs = Math.max(5, settings.live.autoPollIntervalSeconds) * 1000;
    setNextPollAt(Date.now() + intervalMs);
    const interval = setInterval(() => {
      void refreshPlayers();
      for (const id of selectedPlayerIds) void refreshPlayerPals(id);
      setNextPollAt(Date.now() + intervalMs);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [settings.live.autoPollEnabled, settings.live.autoPollIntervalSeconds, selectedPlayerIds, refreshPlayers, refreshPlayerPals]);

  const value: LiveContextValue = {
    status,
    isUsingMock: isMock,
    players,
    lastRefreshedAt,
    lastConnectionMeta,
    error,
    palsByPlayer,
    palsLoading,
    palsError,
    refreshPlayers,
    refreshPlayerPals,
    selectedPlayerIds,
    setSelectedPlayerIds,
    nextPollAt,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveContext(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLiveContext must be used within LiveProvider');
  return ctx;
}
