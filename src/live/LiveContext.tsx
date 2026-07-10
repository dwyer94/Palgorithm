import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSettings, setSettings as writeSettings } from '../store/localStore';
import { useSelectedPlayerIds, useSettings } from '../store/hooks';
import { useRulesetContext } from '../ui/RulesetContext';
import { selectDataSource, type LiveDataSourceError, type LiveResultMeta } from './dataSource';
import { FIXTURE_PALS_BY_IDENTIFIER, FIXTURE_PLAYERS } from './fixtures';
import { mergeIdentityLinks } from './nameResolution';
import { loadPalsCache, savePalsCacheEntry } from './palsCache';
import type { LivePlayer, LivePlayerPals, PlayerIdentifier } from './types';

/**
 * Live connection state, mirroring `RulesetContext`'s "load once, expose via context"
 * pattern but stateful: connection status, cached player/pal data, refresh controls, and
 * `selectedPlayerIds` (which connected players feed the planner views). Selection lives
 * here rather than per-view since it's cross-cutting and should survive tab switches; it is
 * persisted to localStorage (see `useSelectedPlayerIds`) so it survives reloads too.
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
  /** When each player's `palsByPlayer` entry was last fetched successfully — may predate
   * this session (hydrated from `palsCache`) when a player is currently offline. */
  palsFetchedAt: Record<PlayerIdentifier, string | undefined>;
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
  const [palsByPlayer, setPalsByPlayer] = useState<Record<PlayerIdentifier, LivePlayerPals | undefined>>(() => {
    const cache = loadPalsCache();
    return Object.fromEntries(Object.entries(cache).map(([id, entry]) => [id, entry.pals]));
  });
  const [palsFetchedAt, setPalsFetchedAt] = useState<Record<PlayerIdentifier, string | undefined>>(() => {
    const cache = loadPalsCache();
    return Object.fromEntries(Object.entries(cache).map(([id, entry]) => [id, entry.fetchedAt]));
  });
  const [palsLoading, setPalsLoading] = useState<Set<PlayerIdentifier>>(new Set());
  const [palsError, setPalsError] = useState<Record<PlayerIdentifier, LiveDataSourceError | undefined>>({});
  const [selectedPlayerIds, setSelectedPlayerIds] = useSelectedPlayerIds();
  const [nextPollAt, setNextPollAt] = useState<number | null>(null);

  const { source, isMock } = useMemo(
    () => selectDataSource(settings, dataset, { players: FIXTURE_PLAYERS, palsByIdentifier: FIXTURE_PALS_BY_IDENTIFIER }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.live.baseUrl, settings.live.bearerToken, dataset],
  );

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
        const fetchedAt = new Date().toISOString();
        setPalsFetchedAt((prev) => ({ ...prev, [identifier]: fetchedAt }));
        savePalsCacheEntry(identifier, result.data);
      } else {
        // Deliberately leave `palsByPlayer`/`palsFetchedAt` untouched on failure — a player
        // going offline (PLAYER_NOT_FOUND) shouldn't wipe out the last-known-good box, it
        // should just stop refreshing it. Callers show the stale data with its fetch time.
        setPalsError((prev) => ({ ...prev, [identifier]: result.error }));
      }
    },
    [source],
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
      // Read/write the store directly (not the `settings` hook value) so this doesn't need
      // `settings` in this callback's deps — that would recreate `refreshPlayers` on every
      // unrelated settings edit and reset the auto-poll interval below.
      const current = getSettings();
      const nextLinks = mergeIdentityLinks(result.data, current.live.identityLinks);
      if (nextLinks !== current.live.identityLinks) {
        writeSettings({ ...current, live: { ...current.live, identityLinks: nextLinks } });
      }
      // Keep every player's pal cache warm on every refresh (manual or auto-poll), not just
      // selected/expanded ones — the whole point of `palsCache` is that a player who's about
      // to go offline already has a fresh snapshot saved. Deliberately not gated on `status`:
      // PalDefender's `Status` is "saved player account state," not live connectivity — it
      // does not flip when a player logs off, so it can't tell us who's actually reachable.
      // A currently-offline player just 404s (PLAYER_NOT_FOUND), which `refreshPlayerPals`
      // already treats as "keep the cache, don't wipe it" rather than a real error.
      for (const player of result.data) {
        void refreshPlayerPals(player.identifier);
      }
    } else {
      setStatus('error');
      setError(result.error);
      setLastConnectionMeta(null);
    }
  }, [source, refreshPlayerPals]);

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
      // `refreshPlayers` itself now refreshes every online player's pals too — see there.
      void refreshPlayers();
      setNextPollAt(Date.now() + intervalMs);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [settings.live.autoPollEnabled, settings.live.autoPollIntervalSeconds, refreshPlayers]);

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
    palsFetchedAt,
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
