import { useEffect, useMemo, useState } from 'react';
import type { Species, Passive } from '../data/schema';
import { useLiveContext } from '../live/LiveContext';
import { resolvePlayerDisplayName } from '../live/nameResolution';
import type { LivePal, PlayerIdentifier } from '../live/types';
import { useSettings } from '../store/hooks';
import { useRulesetContext } from './RulesetContext';
import { ElementDot, GenderGlyph, PassiveChip, PassiveMultiSelect, SpeciesTypeahead } from './components';

/** Ticking "auto-poll in M:SS" label — a plain re-render of `nextPollAt` would go stale
 * between polls, so this owns its own 1s tick to keep the countdown live. */
function AutoPollCountdown({ nextPollAt }: { nextPollAt: number | null }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (nextPollAt === null) return;
    const id = setInterval(() => forceTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [nextPollAt]);
  if (nextPollAt === null) return null;
  const remaining = Math.max(0, Math.round((nextPollAt - Date.now()) / 1000));
  const mm = Math.floor(remaining / 60);
  const ss = String(remaining % 60).padStart(2, '0');
  return <span> · auto-poll in {mm}:{ss}</span>;
}

/** Server Pals: the Players browser (live boxes, all connection/loading/error states) plus
 * the new Find-a-pal cross-player search (design handoff README, Screen 2). */
export default function ServerPalsView() {
  const [tab, setTab] = useState<'players' | 'search'>('players');
  const live = useLiveContext();

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1000px] px-[34px] pb-[60px] pt-[26px]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="font-sans text-[22px] font-bold tracking-[-.4px]">Server Pals</div>
            <div className="mt-0.5 font-sans text-[13px] text-muted">
              Live boxes across the connected server · read-only, session-only source.
            </div>
          </div>
          <div className="flex items-center gap-3.5">
            <div className="flex flex-col items-end gap-0.5">
              <div className="flex items-center gap-1.5">
                <span
                  className={`h-2 w-2 rounded-full ${live.status === 'connected' ? 'bg-success-dot shadow-[0_0_0_3px_rgba(47,158,91,.18)]' : 'bg-offline'}`}
                />
                <span className={`font-sans text-[12.5px] font-semibold ${live.status === 'connected' ? 'text-success-text' : 'text-muted'}`}>
                  {live.status === 'connected' ? 'Connected' : live.status === 'connecting' ? 'Connecting…' : live.status === 'error' ? 'Error' : 'Not configured'}
                </span>
              </div>
              <div className="font-mono text-[11px] text-muted-light">
                {live.lastRefreshedAt ? `refreshed ${new Date(live.lastRefreshedAt).toLocaleTimeString()}` : 'never refreshed'}
                <AutoPollCountdown nextPollAt={live.nextPollAt} />
              </div>
            </div>
            <div
              onClick={() => void live.refreshPlayers()}
              className="flex cursor-pointer items-center gap-1.5 rounded-panel bg-sidebar-bg px-3.5 py-2.5 font-sans text-[13px] font-semibold text-white hover:bg-sidebar-hover"
            >
              ⟳ Refresh
            </div>
          </div>
        </div>

        <div className="mb-[18px] flex gap-1 border-b-[1.5px] border-border-card">
          <div
            onClick={() => setTab('players')}
            className={`-mb-[1.5px] cursor-pointer border-b-[2.5px] px-4 py-2.5 font-sans text-[13.5px] font-semibold ${
              tab === 'players' ? 'border-brand text-ink' : 'border-transparent text-muted'
            }`}
          >
            ▤ Players <span className="opacity-60">{live.players.length}</span>
          </div>
          <div
            onClick={() => setTab('search')}
            className={`-mb-[1.5px] cursor-pointer border-b-[2.5px] px-4 py-2.5 font-sans text-[13.5px] font-semibold ${
              tab === 'search' ? 'border-brand text-ink' : 'border-transparent text-muted'
            }`}
          >
            ⌕ Find a pal
          </div>
        </div>

        {tab === 'players' ? <PlayersTab /> : <FindAPalTab />}
      </div>
    </main>
  );
}

function PlayersTab() {
  const { speciesById, passives } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const [settings, setSettings] = useSettings();
  const live = useLiveContext();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const setLive = (patch: Partial<typeof settings.live>) => setSettings({ ...settings, live: { ...settings.live, ...patch } });

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

  const selectAll = () => live.setSelectedPlayerIds(new Set(live.players.map((p) => p.identifier)));
  const selectNone = () => live.setSelectedPlayerIds(new Set());

  const startOverride = (identifier: string, current: string) => {
    setEditingId(identifier);
    setDraftName(current);
  };
  const saveOverride = (identifier: string) => {
    if (draftName.trim()) setLive({ nameOverrides: { ...settings.live.nameOverrides, [identifier]: draftName.trim() } });
    setEditingId(null);
  };

  const totalSelectedPals = Array.from(live.selectedPlayerIds).reduce(
    (sum, id) => sum + (live.palsByPlayer[id]?.pals.length ?? 0),
    0,
  );

  return (
    <div>
      {live.isUsingMock && (
        <div className="mb-4 flex items-center gap-2 rounded-panel border border-[#e9d9a8] bg-unresolved-bg2 px-3.5 py-2.5">
          <span className="text-[14px]">ⓘ</span>
          <span className="font-sans text-[12.5px] font-medium text-provisional-text">
            Showing demo/mock data. Configure a proxy base URL in Settings → Live connection for live data.
          </span>
        </div>
      )}
      {live.error && (
        <div className="mb-4 rounded-panel border border-danger-border bg-danger-bg px-3.5 py-2.5 font-mono text-[12.5px] text-danger-text">
          {live.error.code} — {live.error.message}
        </div>
      )}

      <div className="mb-3.5 flex items-center gap-3.5 rounded-panel border border-border-card bg-panel-subtle px-4 py-[11px]">
        <span className="font-sans text-[12.5px] font-semibold text-ink-muted">{live.players.length} players</span>
        <span className="text-border-card">·</span>
        <a onClick={selectAll} className="cursor-pointer font-sans text-[12.5px] font-semibold text-primary">
          Select all
        </a>
        <a onClick={selectNone} className="cursor-pointer font-sans text-[12.5px] font-semibold text-muted">
          None
        </a>
        {live.selectedPlayerIds.size > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-pill border border-primary-border3 bg-primary-tint px-3 py-1">
            <span className="h-[7px] w-[7px] rounded-full bg-primary" />
            <span className="font-mono text-[12px] font-semibold text-primary-dark">
              {totalSelectedPals} pals from {live.selectedPlayerIds.size} player{live.selectedPlayerIds.size === 1 ? '' : 's'} feed the planner
            </span>
          </div>
        )}
      </div>

      {live.players.length === 0 && (
        <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-8 text-center font-sans text-[13px] text-muted">
          No players found.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {live.players.map((p) => {
          const isSelected = live.selectedPlayerIds.has(p.identifier);
          const isExpanded = expanded.has(p.identifier);
          const isOnline = p.status.toLowerCase() === 'online';
          const override = settings.live.nameOverrides[p.identifier];
          const name = resolvePlayerDisplayName(p, settings.live.nameOverrides);
          const hasName = !!override || !!p.apiName;
          const playerPals = live.palsByPlayer[p.identifier];
          const loading = live.palsLoading.has(p.identifier);
          const palError = live.palsError[p.identifier];
          const rowError = isExpanded && !loading && !!palError;

          return (
            <details
              key={p.identifier}
              open={isExpanded}
              onToggle={(e) => {
                const nowOpen = (e.target as HTMLDetailsElement).open;
                if (nowOpen !== isExpanded) toggleExpand(p.identifier);
              }}
              className={`overflow-hidden rounded-[13px] bg-white ${
                isSelected ? 'border-[1.5px] border-primary shadow-elevated-blue' : rowError ? 'border border-danger-border' : 'border border-border-card'
              }`}
            >
              <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3.5">
                <div
                  onClick={(e) => {
                    e.preventDefault();
                    toggleSelected(p.identifier);
                  }}
                  className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] ${
                    isSelected ? 'border-primary bg-primary text-white' : 'border-border-input bg-white'
                  }`}
                >
                  {isSelected && <span className="text-[11px]">✓</span>}
                </div>
                <span className={`h-2 w-2 flex-none rounded-full ${isOnline ? 'bg-success-dot' : 'bg-offline'}`} />
                {editingId === p.identifier ? (
                  <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      className="w-[130px] rounded-[7px] border-[1.5px] border-primary px-2 py-1 font-sans text-[13px] font-semibold text-ink outline-none"
                    />
                    <span
                      onClick={() => saveOverride(p.identifier)}
                      className="cursor-pointer rounded-[6px] bg-primary px-2 py-1 font-mono text-[11px] font-semibold text-white"
                    >
                      Save
                    </span>
                    <span onClick={() => setEditingId(null)} className="cursor-pointer px-1 py-1 font-mono text-[11px] font-semibold text-muted">
                      Cancel
                    </span>
                  </div>
                ) : hasName ? (
                  <>
                    <span className="font-sans text-[15px] font-bold">{name}</span>
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        startOverride(p.identifier, name);
                      }}
                      className="cursor-pointer rounded-[5px] bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-light hover:text-brand-hover"
                    >
                      ✎ override
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono text-[12.5px] font-semibold text-muted">{p.identifier}</span>
                    <span
                      onClick={(e) => {
                        e.preventDefault();
                        startOverride(p.identifier, '');
                      }}
                      className="cursor-pointer rounded-[5px] bg-unresolved-bg px-1.5 py-0.5 font-mono text-[10px] font-medium text-provisional-text underline"
                    >
                      no name — add override
                    </span>
                  </>
                )}
                {p.guildName && <span className="font-mono text-[12px] text-muted">{p.guildName}</span>}
                <span className="ml-auto font-mono text-[12px] text-muted">
                  {isOnline ? (playerPals ? `${playerPals.pals.length} pals` : loading ? 'loading…' : '— pals') : 'offline'}
                </span>
                <span className="font-mono text-[12px] font-semibold text-muted">{isExpanded ? '▾ hide' : '▸ show'}</span>
              </summary>

              {isExpanded && (
                <div className="border-t border-border-divider">
                  {loading && (
                    <div className="flex flex-col gap-2 px-4 py-3">
                      <div className="h-[11px] w-[60%] animate-pulse rounded-[5px] bg-[#f0ece2]" />
                      <div className="h-[11px] w-[80%] animate-pulse rounded-[5px] bg-[#f0ece2]" />
                      <div className="font-mono text-[11px] text-muted-light">Loading pals…</div>
                    </div>
                  )}
                  {!loading && rowError && (
                    <div className="flex items-center gap-3 bg-danger-bg px-4 py-3">
                      <span className="font-mono text-[12.5px] text-danger-text">
                        {palError?.code ?? 'ERROR'} — {palError?.message ?? 'failed to fetch this player’s pals.'}
                      </span>
                      <span
                        onClick={() => void live.refreshPlayerPals(p.identifier)}
                        className="ml-auto cursor-pointer rounded-panel border border-danger-border bg-white px-2.5 py-1 font-mono text-[12px] font-semibold text-danger-text hover:bg-[#fdeee5]"
                      >
                        ⟳ Retry
                      </span>
                    </div>
                  )}
                  {!loading && playerPals && playerPals.pals.length === 0 && (
                    <div className="px-4 py-3 font-sans text-[12.5px] text-muted">No pals.</div>
                  )}
                  {!loading && playerPals && playerPals.pals.length > 0 && (
                    <table className="w-full border-collapse font-mono">
                      <thead>
                        <tr className="text-left">
                          {['Species', 'Gen', 'Lvl', 'Passives', 'IVs H/A/D', 'Location'].map((h) => (
                            <th key={h} className="px-2.5 py-2 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {playerPals.pals.map((pal) => (
                          <PalRow key={pal.instanceId} pal={pal} speciesById={speciesById} passivesById={passivesById} />
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

function PalRow({
  pal,
  speciesById,
  passivesById,
}: {
  pal: LivePal;
  speciesById: Map<string, Species>;
  passivesById: Map<string, Passive>;
}) {
  const species = pal.species ? speciesById.get(pal.species) : undefined;
  const unresolved = pal.species === null;
  return (
    <tr className={`border-t border-panel-header ${unresolved ? 'bg-unresolved-bg2' : ''}`}>
      <td className="px-2.5 py-2">
        <span className="inline-flex items-center gap-1.5">
          <ElementDot elements={species?.elements} />
          <b className={`text-[12.5px] ${unresolved ? 'text-provisional-text' : ''}`}>
            {species?.displayName ?? `${pal.rawPalId} (unresolved)`}
          </b>
          {pal.shiny && <span className="text-shiny">★</span>}
          {unresolved && (
            <span className="rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[9px] font-semibold text-provisional-text">
              unresolved
            </span>
          )}
        </span>
      </td>
      <td className="px-2.5 py-2 text-muted">{pal.gender ? <GenderGlyph gender={pal.gender} /> : '?'}</td>
      <td className="px-2.5 py-2 text-ink-muted">{pal.level}</td>
      <td className="px-2.5 py-2">
        <span className="flex flex-wrap gap-1">
          {pal.passives.map((id) => (
            <PassiveChip
              key={id}
              label={passivesById.get(id)?.displayName ?? id}
              tier={passivesById.get(id)?.tier}
              description={passivesById.get(id)?.description}
            />
          ))}
          {pal.unresolvedPassives.length > 0 && (
            <span className="rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[10px] font-semibold text-provisional-text">
              +{pal.unresolvedPassives.length} unresolved
            </span>
          )}
        </span>
      </td>
      <td className="px-2.5 py-2 text-[11px] text-muted">
        {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
      </td>
      <td className="px-2.5 py-2 text-[12px] text-ink-muted">
        {pal.location.kind === 'baseCamp' ? `Base Camp ${pal.location.baseCampId}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
      </td>
    </tr>
  );
}

function FindAPalTab() {
  const { species, passives, speciesById } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const [settings] = useSettings();
  const live = useLiveContext();
  const [scope, setScope] = useState<Set<PlayerIdentifier> | null>(null); // null = all
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [traitFilter, setTraitFilter] = useState<string[]>([]);

  const inScope = (id: PlayerIdentifier) => scope === null || scope.has(id);

  useEffect(() => {
    for (const p of live.players) {
      if (inScope(p.identifier) && !live.palsByPlayer[p.identifier]) void live.refreshPlayerPals(p.identifier);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.players, scope]);

  const toggleScope = (id: PlayerIdentifier) => {
    const current = scope ?? new Set(live.players.map((p) => p.identifier));
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setScope(next);
  };

  const results = useMemo(() => {
    const out: { owner: string; pal: LivePal }[] = [];
    for (const p of live.players) {
      if (!inScope(p.identifier)) continue;
      const pals = live.palsByPlayer[p.identifier]?.pals ?? [];
      const ownerName = resolvePlayerDisplayName(p, settings.live.nameOverrides);
      for (const pal of pals) {
        if (speciesFilter && pal.species !== speciesFilter) continue;
        if (!traitFilter.every((t) => pal.passives.includes(t))) continue;
        out.push({ owner: ownerName, pal });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.players, live.palsByPlayer, scope, speciesFilter, traitFilter, settings.live.nameOverrides]);

  const ownersInResults = new Set(results.map((r) => r.owner)).size;

  return (
    <div>
      <div className="mb-3.5 rounded-xl border border-border-card bg-panel-subtle px-4 py-3.5">
        <div className="mb-2.5 flex items-center gap-2.5">
          <span className="font-sans text-[10.5px] font-semibold uppercase tracking-[.6px] text-muted">Search in</span>
          <a onClick={() => setScope(new Set(live.players.map((p) => p.identifier)))} className="cursor-pointer font-sans text-[11.5px] font-semibold text-ink">
            All
          </a>
          <a onClick={() => setScope(new Set())} className="cursor-pointer font-sans text-[11.5px] font-semibold text-muted">
            None
          </a>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {live.players.map((p) => {
            const on = inScope(p.identifier);
            const name = resolvePlayerDisplayName(p, settings.live.nameOverrides);
            return (
              <span
                key={p.identifier}
                onClick={() => toggleScope(p.identifier)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1 font-sans text-[12px] font-semibold ${
                  on ? 'border-[1.5px] border-primary bg-primary-tint text-primary-dark' : 'border-[1.5px] border-border-card bg-white text-muted-light'
                }`}
              >
                {on ? (
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-primary text-[9px] text-white">✓</span>
                ) : (
                  <span className="h-3.5 w-3.5 rounded-[4px] border-[1.5px] border-border-input" />
                )}
                {name}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 items-start gap-3.5">
        <div>
          <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Species</div>
          {speciesFilter ? (
            <div className="flex items-center gap-2 rounded-panel border-[1.5px] border-[#26241f] bg-white px-3 py-2">
              <span className="font-mono text-[13px] font-semibold">{speciesById.get(speciesFilter)?.displayName ?? speciesFilter}</span>
              <span onClick={() => setSpeciesFilter(null)} className="ml-auto cursor-pointer text-[16px] text-muted-lighter hover:text-brand-hover">
                ×
              </span>
            </div>
          ) : (
            <SpeciesTypeahead species={species} onPick={setSpeciesFilter} placeholder="Type a species… e.g. Anubis" />
          )}
        </div>
        <div>
          <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Must have traits</div>
          <PassiveMultiSelect passives={passives} value={traitFilter} onChange={setTraitFilter} />
        </div>
      </div>

      <div className="mb-2.5 flex items-baseline gap-2.5">
        <span className="font-mono text-[15px] font-bold">{results.length}</span>
        <span className="font-sans text-[12.5px] font-semibold text-muted">
          matches across {ownersInResults} player{ownersInResults === 1 ? '' : 's'}
        </span>
      </div>

      {results.length === 0 ? (
        <div className="rounded-card border-[1.5px] border-dashed border-[#d8cfbf] bg-panel-subtle p-10 text-center">
          <div className="mb-1 font-sans text-[14px] font-semibold text-[#6b655c]">No pal matches these filters</div>
          <div className="font-sans text-[12.5px] text-muted-light">Loosen a trait, or widen the player scope above.</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {results.map(({ owner, pal }, i) => {
            const sp = pal.species ? speciesById.get(pal.species) : undefined;
            return (
              <div key={pal.instanceId + i} className="flex flex-wrap items-center gap-3.5 rounded-[11px] border border-border-card bg-white px-3.5 py-2.5">
                <ElementDot elements={sp?.elements} />
                <span className="min-w-[104px] font-mono text-[13.5px] font-bold">{sp?.displayName ?? pal.rawPalId}</span>
                <GenderGlyph gender={pal.gender} className="font-mono text-[12px] text-muted" />
                <span className="font-mono text-[12px] text-muted">L{pal.level}</span>
                {pal.shiny && (
                  <span className="text-[13px] text-shiny" title="shiny">
                    ★
                  </span>
                )}
                <div className="flex flex-wrap gap-1">
                  {pal.passives.map((id) => (
                    <PassiveChip
                      key={id}
                      label={passivesById.get(id)?.displayName ?? id}
                      tier={passivesById.get(id)?.tier}
                      description={passivesById.get(id)?.description}
                      variant={traitFilter.includes(id) ? 'matched' : 'dim'}
                    />
                  ))}
                </div>
                <span className="ml-auto font-mono text-[11px] text-muted-light">
                  {pal.location.kind === 'baseCamp' ? `Base Camp ${pal.location.baseCampId}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-pill border border-primary-border3 bg-primary-tint px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-dark">
                  owned by {owner}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
