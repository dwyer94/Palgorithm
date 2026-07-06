import { Fragment, useState } from 'react';
import { useLiveContext } from '../live/LiveContext';
import { resolvePlayerDisplayName } from '../live/nameResolution';
import { useSettings } from '../store/hooks';
import { useRulesetContext } from './RulesetContext';

/** Server Pals browser (docs/UI_REQUIREMENTS.md): connected players, resolved display
 * names, per-player pal browsing, and selection for inclusion in the planner views. */
export default function ServerPalsView() {
  const { speciesById } = useRulesetContext();
  const [settings] = useSettings();
  const live = useLiveContext();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const ensurePalsLoaded = (identifier: string) => {
    if (!live.palsByPlayer[identifier]) void live.refreshPlayerPals(identifier);
  };

  const toggleExpand = (identifier: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(identifier)) next.delete(identifier);
      else {
        next.add(identifier);
        ensurePalsLoaded(identifier);
      }
      return next;
    });
  };

  const toggleSelected = (identifier: string) => {
    const next = new Set(live.selectedPlayerIds);
    if (next.has(identifier)) next.delete(identifier);
    else {
      next.add(identifier);
      ensurePalsLoaded(identifier);
    }
    live.setSelectedPlayerIds(next);
  };

  return (
    <section>
      <h2>Server Pals</h2>
      <p>
        Status: <strong>{live.status}</strong>
        {live.isUsingMock && ' — using demo/mock data (configure a proxy base URL in Settings for live data)'}
        {live.lastRefreshedAt && ` — last refreshed ${new Date(live.lastRefreshedAt).toLocaleTimeString()}`}
      </p>
      {live.error && (
        <p>
          Error: {live.error.code} — {live.error.message}
        </p>
      )}
      <button onClick={() => live.refreshPlayers()}>Refresh players</button>

      {live.players.length === 0 && live.status !== 'connecting' && <p>No players found.</p>}

      {live.players.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Include in planner</th>
              <th>Player</th>
              <th>Guild</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live.players.map((p) => {
              const name = resolvePlayerDisplayName(p, settings.live.nameOverrides);
              const isExpanded = expanded.has(p.identifier);
              const playerPals = live.palsByPlayer[p.identifier];
              const loading = live.palsLoading.has(p.identifier);
              return (
                <Fragment key={p.identifier}>
                  <tr>
                    <td>
                      <input
                        type="checkbox"
                        checked={live.selectedPlayerIds.has(p.identifier)}
                        onChange={() => toggleSelected(p.identifier)}
                      />
                    </td>
                    <td>{name}</td>
                    <td>{p.guildName}</td>
                    <td>{p.status}</td>
                    <td>
                      <button onClick={() => toggleExpand(p.identifier)}>{isExpanded ? 'Hide pals' : 'Show pals'}</button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={5}>
                        {loading && <p>Loading pals…</p>}
                        {!loading && playerPals && playerPals.pals.length === 0 && <p>No pals.</p>}
                        {!loading && playerPals && playerPals.pals.length > 0 && (
                          <table>
                            <thead>
                              <tr>
                                <th>Species</th>
                                <th>Gender</th>
                                <th>Level</th>
                                <th>Passives</th>
                                <th>Location</th>
                              </tr>
                            </thead>
                            <tbody>
                              {playerPals.pals.map((pal) => (
                                <tr key={pal.instanceId}>
                                  <td>
                                    {pal.species
                                      ? (speciesById.get(pal.species)?.displayName ?? pal.species)
                                      : `${pal.rawPalId} (unresolved)`}
                                  </td>
                                  <td>{pal.gender ?? `${pal.rawGender} (unresolved)`}</td>
                                  <td>{pal.level}</td>
                                  <td>
                                    {pal.passives.join(', ')}
                                    {pal.unresolvedPassives.length > 0 && ` (unresolved: ${pal.unresolvedPassives.join(', ')})`}
                                  </td>
                                  <td>{pal.location.kind === 'baseCamp' ? `base camp ${pal.location.baseCampId}` : pal.location.kind}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
