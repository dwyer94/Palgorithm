import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useSettings } from '../store/hooks';
import { useRulesetContext } from '../ui/RulesetContext';
import { selectDataSource, type LiveDataSourceError } from './dataSource';
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
  error: LiveDataSourceError | null;
  palsByPlayer: Record<PlayerIdentifier, LivePlayerPals | undefined>;
  palsLoading: Set<PlayerIdentifier>;
  refreshPlayers: () => Promise<void>;
  refreshPlayerPals: (identifier: PlayerIdentifier) => Promise<void>;
  selectedPlayerIds: Set<PlayerIdentifier>;
  setSelectedPlayerIds: (ids: Set<PlayerIdentifier>) => void;
}

const LiveContext = createContext<LiveContextValue | null>(null);

export function LiveProvider({ children }: { children: ReactNode }) {
  const [settings] = useSettings();
  const { dataset } = useRulesetContext();

  const [status, setStatus] = useState<ConnectionStatus>('unconfigured');
  const [players, setPlayers] = useState<LivePlayer[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [error, setError] = useState<LiveDataSourceError | null>(null);
  const [palsByPlayer, setPalsByPlayer] = useState<Record<PlayerIdentifier, LivePlayerPals | undefined>>({});
  const [palsLoading, setPalsLoading] = useState<Set<PlayerIdentifier>>(new Set());
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<PlayerIdentifier>>(new Set());

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
    } else {
      setStatus('error');
      setError(result.error);
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
      // Per-player fetch failures aren't surfaced through the global `error` (that's for
      // player-list-level failures) — the row just keeps showing no pals, which the view
      // can pair with a retry action.
      if (result.ok) {
        setPalsByPlayer((prev) => ({ ...prev, [identifier]: result.data }));
      }
    },
    [source],
  );

  useEffect(() => {
    void refreshPlayers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    if (!settings.live.autoPollEnabled) return;
    const intervalMs = Math.max(5, settings.live.autoPollIntervalSeconds) * 1000;
    const interval = setInterval(() => {
      void refreshPlayers();
      for (const id of selectedPlayerIds) void refreshPlayerPals(id);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [settings.live.autoPollEnabled, settings.live.autoPollIntervalSeconds, selectedPlayerIds, refreshPlayers, refreshPlayerPals]);

  const value: LiveContextValue = {
    status,
    isUsingMock: isMock,
    players,
    lastRefreshedAt,
    error,
    palsByPlayer,
    palsLoading,
    refreshPlayers,
    refreshPlayerPals,
    selectedPlayerIds,
    setSelectedPlayerIds,
  };

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

export function useLiveContext(): LiveContextValue {
  const ctx = useContext(LiveContext);
  if (!ctx) throw new Error('useLiveContext must be used within LiveProvider');
  return ctx;
}
