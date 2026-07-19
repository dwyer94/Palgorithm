import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Pencil, Star, RefreshCw, Users, Search, Info } from 'lucide-react';
import type { Species, Passive } from '../data/schema';
import { useLiveContext } from '../live/LiveContext';
import { resolvePlayerDisplayName } from '../live/nameResolution';
import { shortBaseCampLabel, type LivePal, type LivePlayer, type PlayerIdentifier } from '../live/types';
import { effectiveWorkSuitabilities } from '../live/workSuitability';
import { useSettings } from '../store/hooks';
import { useRulesetContext } from './RulesetContext';
import {
  ElementDot,
  GenderGlyph,
  HoverTooltip,
  PalCard,
  PalIcon,
  PassiveChip,
  PassiveMultiSelect,
  SpeciesTypeahead,
  VirtualizedTable,
  WorkSuitabilityRow,
  WorkSuitabilityFilterEditor,
  WorkSuitabilitySortSelect,
  useIsDesktop,
  type WorkSuitabilityFilter,
} from './components';

const UNRESOLVED_SPECIES_EXPLANATION =
  "This pal's raw game ID isn't in the bundled dataset yet — usually a newer game patch or a mod the dataset hasn't caught up with. It's shown as-is but left out of planning until resolved.";
const UNRESOLVED_PASSIVES_EXPLANATION =
  "These passive IDs aren't in the bundled dataset yet (newer patch or mod) — kept out of planning odds instead of being silently dropped or miscounted.";

// A player's own pal table (Players tab) has no Owner column; Find-a-pal's cross-player
// results table adds one on the end. Kept as separate constants (not derived from one
// another) since the two tables' column weighting differs slightly.
const PLAYER_PAL_TABLE_COLUMNS =
  'minmax(150px,1.3fr) 48px 48px minmax(140px,1fr) minmax(120px,1fr) 90px minmax(110px,1fr)';
const FIND_A_PAL_TABLE_COLUMNS =
  'minmax(150px,1.2fr) 48px 48px minmax(130px,1fr) minmax(110px,1fr) 90px minmax(100px,1fr) minmax(100px,1fr)';

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
  // Mirrors App.tsx's outer-tab `visited` gating: only mount a sub-tab once it's actually
  // selected, not unconditionally up front. Mounting `FindAPalTab`'s VirtualizedTable while
  // its `hidden` ancestor is display:none freezes react-virtual's one-time container
  // measurement at 0 forever (see VirtualizedTable's doc comment in components.tsx) — gating
  // the mount means its first render always happens while genuinely visible.
  const [visitedTabs, setVisitedTabs] = useState<Set<'players' | 'search'>>(() => new Set(['players']));
  const live = useLiveContext();

  const selectTab = (key: 'players' | 'search') => {
    setTab(key);
    setVisitedTabs((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  };

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1000px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
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
              <RefreshCw size={13} /> Refresh
            </div>
          </div>
        </div>

        <div className="mb-[18px] flex gap-1 border-b-[1.5px] border-border-card">
          <div
            onClick={() => selectTab('players')}
            className={`inline-flex -mb-[1.5px] cursor-pointer items-center gap-1.5 border-b-[2.5px] px-4 py-2.5 font-sans text-[13.5px] font-semibold ${
              tab === 'players' ? 'border-brand text-ink' : 'border-transparent text-muted'
            }`}
          >
            <Users size={14} /> Players <span className="opacity-60">{live.players.length}</span>
          </div>
          <div
            onClick={() => selectTab('search')}
            className={`inline-flex -mb-[1.5px] cursor-pointer items-center gap-1.5 border-b-[2.5px] px-4 py-2.5 font-sans text-[13.5px] font-semibold ${
              tab === 'search' ? 'border-brand text-ink' : 'border-transparent text-muted'
            }`}
          >
            <Search size={14} /> Find a pal
          </div>
        </div>

        {/* Once visited, both stay mounted so switching sub-tabs doesn't lose expanded rows
            or search filters — see the same pattern in App.tsx for the outer view tabs. Unlike
            App.tsx's tabs, `visitedTabs` here also guards against mounting a tab's virtualized
            table for the first time while hidden (see `selectTab` above). */}
        <div className={tab === 'players' ? undefined : 'hidden'}>
          <PlayersTab active={tab === 'players'} />
        </div>
        {visitedTabs.has('search') && (
          <div className={tab === 'search' ? undefined : 'hidden'}>
            <FindAPalTab active={tab === 'search'} />
          </div>
        )}
      </div>
    </main>
  );
}

function PlayersTab({ active }: { active: boolean }) {
  const { speciesById, passives } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const live = useLiveContext();

  const selectAll = () => live.setSelectedPlayerIds(new Set(live.players.map((p) => p.identifier)));
  const selectNone = () => live.setSelectedPlayerIds(new Set());

  const totalSelectedPals = Array.from(live.selectedPlayerIds).reduce(
    (sum, id) => sum + (live.palsByPlayer[id]?.pals.length ?? 0),
    0,
  );

  return (
    <div>
      {live.isUsingMock && (
        <div className="mb-4 flex items-center gap-2 rounded-panel border border-[#e9d9a8] bg-unresolved-bg2 px-3.5 py-2.5">
          <Info size={14} className="flex-none" />
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

      {live.players.length === 0 && live.status === 'unconfigured' && !live.isUsingMock && (
        <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-8 text-center font-sans text-[13px] text-muted">
          Not connected. Configure a proxy base URL in Settings → Live connection to see your server's Pals.
        </div>
      )}
      {live.players.length === 0 && (live.status !== 'unconfigured' || live.isUsingMock) && (
        <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-8 text-center font-sans text-[13px] text-muted">
          No players found.
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {live.players.map((p) => (
          <PlayerRow key={p.identifier} p={p} speciesById={speciesById} passivesById={passivesById} tabActive={active} />
        ))}
      </div>
    </div>
  );
}

/** One player's row (checkbox/name/pal table), broken out of `PlayersTab` so each row owns
 * its own expand-state and pal-table rendering. Critically, the name-override *editing* state
 * lives one level further down in `NameOverrideEditor` — see that component's doc comment for
 * why that extra split matters, not just this one. */
function PlayerRow({
  p,
  speciesById,
  passivesById,
  tabActive,
}: {
  p: LivePlayer;
  speciesById: Map<string, Species>;
  passivesById: Map<string, Passive>;
  tabActive: boolean;
}) {
  const live = useLiveContext();
  const [settings, setSettings] = useSettings();
  const [isExpanded, setIsExpanded] = useState(false);
  const isDesktop = useIsDesktop();
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const setLive = (patch: Partial<typeof settings.live>) => setSettings({ ...settings, live: { ...settings.live, ...patch } });

  // PalDefender's `Status` field is "saved player account state," not live connectivity —
  // it does not flip when a player logs off, so it can't gate whether to attempt a fetch.
  // Just try; a stale/offline player naturally 404s (see `notFound` below).
  const ensurePalsLoaded = () => {
    if (!live.palsByPlayer[p.identifier]) void live.refreshPlayerPals(p.identifier);
  };

  const toggleExpand = () => {
    setIsExpanded((prev) => {
      const next = !prev;
      if (next) ensurePalsLoaded();
      return next;
    });
  };

  const isSelected = live.selectedPlayerIds.has(p.identifier);
  const toggleSelected = () => {
    const next = new Set(live.selectedPlayerIds);
    if (next.has(p.identifier)) next.delete(p.identifier);
    else {
      next.add(p.identifier);
      ensurePalsLoaded();
    }
    live.setSelectedPlayerIds(next);
  };

  const override = settings.live.nameOverrides[p.identifier];
  const name = resolvePlayerDisplayName(p, settings.live.nameOverrides, settings.live.identityLinks);
  const hasName = !!override || !!p.apiName;
  const playerPals = live.palsByPlayer[p.identifier];
  const fetchedAt = live.palsFetchedAt[p.identifier];
  const loading = live.palsLoading.has(p.identifier);
  const palError = live.palsError[p.identifier];
  // PLAYER_NOT_FOUND is PalDefender's way of saying "not currently online" — that's
  // expected and handled by the muted offline/cached notice below, not a real error.
  // Any other error code (auth, network, timeout) is a genuine failure worth flagging.
  const notFound = palError?.code === 'PLAYER_NOT_FOUND';
  const hardError = !!palError && !notFound;
  const rowError = isExpanded && !loading && hardError;

  return (
    <details
      open={isExpanded}
      onToggle={(e) => {
        const nowOpen = (e.target as HTMLDetailsElement).open;
        if (nowOpen !== isExpanded) toggleExpand();
      }}
      className={`overflow-hidden rounded-[13px] bg-white ${
        isSelected ? 'border-[1.5px] border-primary shadow-elevated-blue' : rowError ? 'border border-danger-border' : 'border border-border-card'
      }`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3.5">
        <div
          onClick={(e) => {
            e.preventDefault();
            toggleSelected();
          }}
          className={`flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] ${
            isSelected ? 'border-primary bg-primary text-white' : 'border-border-input bg-white'
          }`}
        >
          {isSelected && <Check size={12} />}
        </div>
        <span className={`h-2 w-2 flex-none rounded-full ${notFound ? 'bg-offline' : 'bg-success-dot'}`} />
        <NameOverrideEditor
          displayName={name}
          identifier={p.identifier}
          hasName={hasName}
          onSave={(newName) => setLive({ nameOverrides: { ...settings.live.nameOverrides, [p.identifier]: newName } })}
        />
        {p.guildName && <span className="font-mono text-[12px] text-muted">{p.guildName}</span>}
        <span className="ml-auto font-mono text-[12px] text-muted">
          {notFound
            ? playerPals
              ? `offline · ${playerPals.pals.length} cached`
              : 'offline'
            : playerPals
              ? `${playerPals.pals.length} pals`
              : loading
                ? 'loading…'
                : '— pals'}
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
                className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-panel border border-danger-border bg-white px-2.5 py-1 font-mono text-[12px] font-semibold text-danger-text hover:bg-[#fdeee5]"
              >
                <RefreshCw size={11} /> Retry
              </span>
            </div>
          )}
          {!loading && notFound && (
            <div className="flex items-center gap-3 bg-panel-subtle px-4 py-2.5">
              <span className="font-mono text-[11px] text-muted">
                {playerPals
                  ? `Offline — showing ${playerPals.pals.length} cached pal${playerPals.pals.length === 1 ? '' : 's'}${
                      fetchedAt ? ` from ${new Date(fetchedAt).toLocaleString()}` : ''
                    }.`
                  : 'Offline — no cached pals yet. They need to log in once while the proxy is running.'}
              </span>
              <span
                onClick={() => void live.refreshPlayerPals(p.identifier)}
                className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-input bg-white px-2.5 py-1 font-mono text-[12px] font-semibold text-muted hover:bg-panel-subtle"
              >
                <RefreshCw size={11} /> Check now
              </span>
            </div>
          )}
          {!loading && playerPals && playerPals.pals.length === 0 && (
            <div className="px-4 py-3 font-sans text-[12.5px] text-muted">No pals.</div>
          )}
          {!loading && playerPals && playerPals.pals.length > 0 && settings.iconDisplayMode === 'full' && (
            <div className="flex flex-wrap gap-2.5 p-3.5">
              {playerPals.pals.map((pal) => (
                <PalFullCard key={pal.instanceId} pal={pal} speciesById={speciesById} passivesById={passivesById} />
              ))}
            </div>
          )}
          {!loading && playerPals && playerPals.pals.length > 0 && settings.iconDisplayMode !== 'full' && (
            isDesktop ? (
              <div ref={tableScrollRef} className="max-h-[480px] overflow-y-auto">
                <VirtualizedTable
                  items={playerPals.pals}
                  getKey={(pal) => pal.instanceId}
                  columns={PLAYER_PAL_TABLE_COLUMNS}
                  header={['Species', 'Gen', 'Lvl', 'Passives', 'Work', 'IVs H/A/D', 'Location']}
                  getScrollElement={() => tableScrollRef.current}
                  estimateSize={44}
                  getRowClassName={(pal) => (pal.species === null ? 'bg-unresolved-bg2' : '')}
                  renderRow={(pal) => buildPalRowCells(pal, speciesById, passivesById)}
                  active={tabActive && isExpanded}
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono">
                  <thead>
                    <tr className="text-left">
                      {['Species', 'Gen', 'Lvl', 'Passives', 'Work', 'IVs H/A/D', 'Location'].map((h) => (
                        <th
                          key={h}
                          className="whitespace-nowrap px-2.5 py-2 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light"
                        >
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
              </div>
            )
          )}
        </div>
      )}
    </details>
  );
}

/** The player-name-override editor, split out as its own component with its own local
 * `editing`/`draft` state — not just for tidiness. Before this split, that state lived
 * directly in the per-player row alongside its (potentially very large, unvirtualized) pal
 * table; every keystroke while editing a name re-rendered and reconciled the *entire* row,
 * table included. Measured at ~100ms/keystroke with a ~1,500-pal roster expanded — the same
 * class of bug PERFORMANCE_REMEDIATION_PLAN.md's Phase 4 found and fixed for the Reference
 * view (33-82ms/keystroke at just 291 items). Isolating this input's state to its own
 * component means a keystroke here only ever re-renders these two spans. */
function NameOverrideEditor({
  identifier,
  displayName,
  hasName,
  onSave,
}: {
  identifier: string;
  displayName: string;
  hasName: boolean;
  onSave: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (editing) {
    return (
      <div className="flex items-center gap-1.5" onClick={(e) => e.preventDefault()}>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-[130px] rounded-[7px] border-[1.5px] border-primary px-2 py-1 font-sans text-[13px] font-semibold text-ink outline-none"
        />
        <span
          onClick={() => {
            if (draft.trim()) onSave(draft.trim());
            setEditing(false);
          }}
          className="cursor-pointer rounded-[6px] bg-primary px-2 py-1 font-mono text-[11px] font-semibold text-white"
        >
          Save
        </span>
        <span onClick={() => setEditing(false)} className="cursor-pointer px-1 py-1 font-mono text-[11px] font-semibold text-muted">
          Cancel
        </span>
      </div>
    );
  }

  if (hasName) {
    return (
      <>
        <span className="font-sans text-[15px] font-bold">{displayName}</span>
        <span
          onClick={(e) => {
            e.preventDefault();
            setDraft(displayName);
            setEditing(true);
          }}
          className="inline-flex cursor-pointer items-center gap-1 rounded-[5px] bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-light hover:text-brand-hover"
        >
          <Pencil size={9} /> override
        </span>
      </>
    );
  }

  return (
    <>
      <span className="font-mono text-[12.5px] font-semibold text-muted">{identifier}</span>
      <span
        onClick={(e) => {
          e.preventDefault();
          setDraft('');
          setEditing(true);
        }}
        className="cursor-pointer rounded-[5px] bg-unresolved-bg px-1.5 py-0.5 font-mono text-[10px] font-medium text-provisional-text underline"
      >
        no name — add override
      </span>
    </>
  );
}

/** Cell contents (no `<td>`/wrapper) shared by the plain `<table>` fallback (`PalRow`, mobile)
 * and `VirtualizedTable`'s `renderRow` (desktop) — one column list to keep in sync instead of
 * two copies drifting apart. Order matches the `header` arrays passed to each caller. */
function buildPalRowCells(pal: LivePal, speciesById: Map<string, Species>, passivesById: Map<string, Passive>): ReactNode[] {
  const species = pal.species ? speciesById.get(pal.species) : undefined;
  const unresolved = pal.species === null;
  return [
    <span key="species" className="inline-flex items-center gap-1.5">
      <PalIcon icon={species?.icon} size={20} />
      <ElementDot elements={species?.elements} />
      <b className={`text-[12.5px] ${unresolved ? 'text-provisional-text' : ''}`}>
        {species?.displayName ?? `${pal.rawPalId} (unresolved)`}
      </b>
      {pal.shiny && (
        <span className="text-shiny">
          <Star size={11} />
        </span>
      )}
      {unresolved && (
        <HoverTooltip description={UNRESOLVED_SPECIES_EXPLANATION}>
          <span className="cursor-help rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[9px] font-semibold text-provisional-text">
            unresolved
          </span>
        </HoverTooltip>
      )}
    </span>,
    <span key="gender" className="text-muted">
      {pal.gender ? <GenderGlyph gender={pal.gender} /> : '?'}
    </span>,
    <span key="level" className="text-ink-muted">
      {pal.level}
    </span>,
    <span key="passives" className="flex flex-wrap gap-1">
      {pal.passives.map((id) => (
        <PassiveChip
          key={id}
          label={passivesById.get(id)?.displayName ?? id}
          tier={passivesById.get(id)?.tier}
          description={passivesById.get(id)?.description}
        />
      ))}
      {pal.unresolvedPassives.length > 0 && (
        <HoverTooltip description={UNRESOLVED_PASSIVES_EXPLANATION}>
          <span className="cursor-help rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[10px] font-semibold text-provisional-text">
            +{pal.unresolvedPassives.length} unresolved
          </span>
        </HoverTooltip>
      )}
    </span>,
    <WorkSuitabilityRow key="work" levels={effectiveWorkSuitabilities(species, pal)} />,
    <span key="ivs" className="text-[11px] text-muted">
      {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
    </span>,
    <span key="location" className="text-[12px] text-ink-muted">
      {pal.location.kind === 'baseCamp' ? `Base Camp ${shortBaseCampLabel(pal.location.baseCampId)}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
    </span>,
  ];
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
  const unresolved = pal.species === null;
  return (
    <tr className={`border-t border-panel-header ${unresolved ? 'bg-unresolved-bg2' : ''}`}>
      {buildPalRowCells(pal, speciesById, passivesById).map((cell, i) => (
        <td key={i} className="px-2.5 py-2">
          {cell}
        </td>
      ))}
    </tr>
  );
}

function PalFullCard({
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
    <PalCard
      icon={species?.icon}
      elements={species?.elements}
      title={
        <span className={unresolved ? 'text-provisional-text' : ''}>
          {species?.displayName ?? `${pal.rawPalId} (unresolved)`}
          {pal.shiny && (
            <span className="ml-1 text-shiny">
              <Star size={11} />
            </span>
          )}
        </span>
      }
      meta={
        <span className="inline-flex items-center gap-1.5">
          {pal.gender ? <GenderGlyph gender={pal.gender} /> : '?'} · L{pal.level}
        </span>
      }
    >
      {unresolved && (
        <HoverTooltip description={UNRESOLVED_SPECIES_EXPLANATION}>
          <span className="cursor-help rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[9px] font-semibold text-provisional-text">
            unresolved
          </span>
        </HoverTooltip>
      )}
      {(pal.passives.length > 0 || pal.unresolvedPassives.length > 0) && (
        <div className="flex flex-wrap justify-center gap-1">
          {pal.passives.map((id) => (
            <PassiveChip
              key={id}
              label={passivesById.get(id)?.displayName ?? id}
              tier={passivesById.get(id)?.tier}
              description={passivesById.get(id)?.description}
              className="text-[9px]"
            />
          ))}
          {pal.unresolvedPassives.length > 0 && (
            <HoverTooltip description={UNRESOLVED_PASSIVES_EXPLANATION}>
              <span className="cursor-help rounded-[4px] bg-unresolved-bg px-1.5 py-px font-mono text-[9px] font-semibold text-provisional-text">
                +{pal.unresolvedPassives.length}
              </span>
            </HoverTooltip>
          )}
        </div>
      )}
      <WorkSuitabilityRow levels={effectiveWorkSuitabilities(species, pal)} />
      <div className="font-mono text-[10px] text-muted">
        IVs {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
      </div>
      <div className="font-sans text-[10px] text-muted-light">
        {pal.location.kind === 'baseCamp' ? `Base Camp ${shortBaseCampLabel(pal.location.baseCampId)}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
      </div>
    </PalCard>
  );
}

/** Cell contents shared by the mobile plain `<table>` fallback and the desktop
 * `VirtualizedTable` — same rationale as `buildPalRowCells` above. */
function buildFindAPalRowCells(
  entry: { owner: string; pal: LivePal; workLevels: Record<string, number> },
  speciesById: Map<string, Species>,
  passivesById: Map<string, Passive>,
  traitFilter: string[],
  workHighlight: Set<string> | undefined,
): ReactNode[] {
  const { owner, pal, workLevels } = entry;
  const sp = pal.species ? speciesById.get(pal.species) : undefined;
  return [
    <span key="species" className="inline-flex items-center gap-1.5">
      <PalIcon icon={sp?.icon} size={20} />
      <ElementDot elements={sp?.elements} />
      <b className="whitespace-nowrap text-[12.5px]">{sp?.displayName ?? pal.rawPalId}</b>
      {pal.shiny && (
        <span className="text-shiny" title="shiny">
          <Star size={11} />
        </span>
      )}
    </span>,
    <span key="gender" className="text-muted">
      <GenderGlyph gender={pal.gender} />
    </span>,
    <span key="level" className="text-ink-muted">
      {pal.level}
    </span>,
    <div key="passives" className="flex flex-wrap gap-1">
      {pal.passives.map((id) => (
        <PassiveChip
          key={id}
          label={passivesById.get(id)?.displayName ?? id}
          tier={passivesById.get(id)?.tier}
          description={passivesById.get(id)?.description}
          variant={traitFilter.includes(id) ? 'matched' : 'dim'}
        />
      ))}
    </div>,
    <WorkSuitabilityRow key="work" levels={workLevels} highlight={workHighlight} />,
    <span key="ivs" className="text-[11px] text-muted">
      {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
    </span>,
    <span key="location" className="whitespace-nowrap text-[12px] text-ink-muted">
      {pal.location.kind === 'baseCamp' ? `Base Camp ${shortBaseCampLabel(pal.location.baseCampId)}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
    </span>,
    <span
      key="owner"
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-primary-border3 bg-primary-tint px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-dark"
    >
      {owner}
    </span>,
  ];
}

function FindAPalTab({ active }: { active: boolean }) {
  const { species, passives, speciesById } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const [settings] = useSettings();
  const isFull = settings.iconDisplayMode === 'full';
  const live = useLiveContext();
  const [scope, setScope] = useState<Set<PlayerIdentifier> | null>(null); // null = all
  const [speciesFilter, setSpeciesFilter] = useState<string | null>(null);
  const [traitFilter, setTraitFilter] = useState<string[]>([]);
  const [workFilters, setWorkFilters] = useState<WorkSuitabilityFilter[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const workHighlight = useMemo(() => {
    const s = new Set(workFilters.map((f) => f.type));
    if (sortBy) s.add(sortBy);
    return s.size > 0 ? s : undefined;
  }, [workFilters, sortBy]);
  const isDesktop = useIsDesktop();
  const resultsRef = useRef<HTMLDivElement>(null);

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
    const out: { owner: string; pal: LivePal; workLevels: Record<string, number> }[] = [];
    for (const p of live.players) {
      if (!inScope(p.identifier)) continue;
      const pals = live.palsByPlayer[p.identifier]?.pals ?? [];
      const ownerName = resolvePlayerDisplayName(p, settings.live.nameOverrides, settings.live.identityLinks);
      for (const pal of pals) {
        if (speciesFilter && pal.species !== speciesFilter) continue;
        if (!traitFilter.every((t) => pal.passives.includes(t))) continue;
        const workLevels = effectiveWorkSuitabilities(pal.species ? speciesById.get(pal.species) : undefined, pal);
        if (!workFilters.every((f) => (workLevels[f.type] ?? 0) >= f.minLevel)) continue;
        out.push({ owner: ownerName, pal, workLevels });
      }
    }
    if (sortBy) out.sort((a, b) => (b.workLevels[sortBy] ?? 0) - (a.workLevels[sortBy] ?? 0));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    live.players,
    live.palsByPlayer,
    scope,
    speciesFilter,
    traitFilter,
    workFilters,
    sortBy,
    speciesById,
    settings.live.nameOverrides,
    settings.live.identityLinks,
  ]);

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
            const name = resolvePlayerDisplayName(p, settings.live.nameOverrides, settings.live.identityLinks);
            return (
              <span
                key={p.identifier}
                onClick={() => toggleScope(p.identifier)}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-pill px-3 py-1 font-sans text-[12px] font-semibold ${
                  on ? 'border-[1.5px] border-primary bg-primary-tint text-primary-dark' : 'border-[1.5px] border-border-card bg-white text-muted-light'
                }`}
              >
                {on ? (
                  <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[4px] bg-primary text-white">
                    <Check size={10} />
                  </span>
                ) : (
                  <span className="h-3.5 w-3.5 rounded-[4px] border-[1.5px] border-border-input" />
                )}
                {name}
              </span>
            );
          })}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 items-start gap-3.5 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Species</div>
          {speciesFilter ? (
            <div className="flex items-center gap-2 rounded-panel border-[1.5px] border-[#26241f] bg-white px-3 py-2">
              <PalIcon icon={speciesById.get(speciesFilter)?.icon} size={20} />
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

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-card bg-panel-subtle px-4 py-3.5">
        <div>
          <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Work suitability</div>
          <WorkSuitabilityFilterEditor filters={workFilters} onChange={setWorkFilters} />
        </div>
        <WorkSuitabilitySortSelect value={sortBy} onChange={setSortBy} />
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
      ) : isFull ? (
        <div className="flex flex-wrap gap-2.5">
          {results.map(({ owner, pal, workLevels }, i) => {
            const sp = pal.species ? speciesById.get(pal.species) : undefined;
            return (
              <PalCard
                key={pal.instanceId + i}
                icon={sp?.icon}
                elements={sp?.elements}
                title={
                  <span>
                    {sp?.displayName ?? pal.rawPalId}
                    {pal.shiny && (
                      <span className="ml-1 text-shiny">
                        <Star size={11} />
                      </span>
                    )}
                  </span>
                }
                meta={
                  <span className="inline-flex items-center gap-1.5">
                    <GenderGlyph gender={pal.gender} /> · L{pal.level}
                  </span>
                }
              >
                <div className="flex flex-wrap justify-center gap-1">
                  {pal.passives.map((id) => (
                    <PassiveChip
                      key={id}
                      label={passivesById.get(id)?.displayName ?? id}
                      tier={passivesById.get(id)?.tier}
                      description={passivesById.get(id)?.description}
                      variant={traitFilter.includes(id) ? 'matched' : 'dim'}
                      className="text-[9px]"
                    />
                  ))}
                </div>
                <WorkSuitabilityRow levels={workLevels} highlight={workHighlight} />
                <div className="font-mono text-[10px] text-muted">
                  IVs {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
                </div>
                <div className="font-sans text-[10px] text-muted-light">
                  {pal.location.kind === 'baseCamp' ? `Base Camp ${shortBaseCampLabel(pal.location.baseCampId)}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
                </div>
                <span className="inline-flex items-center gap-1 rounded-pill border border-primary-border3 bg-primary-tint px-2 py-0.5 font-mono text-[10px] font-semibold text-primary-dark">
                  {owner}
                </span>
              </PalCard>
            );
          })}
        </div>
      ) : isDesktop ? (
        // Virtualized (PERFORMANCE_REMEDIATION_PLAN.md Phase 4 pattern): only the rows in
        // view are ever mounted, regardless of how many pals `results` holds — a live roster
        // can run into the thousands, unlike the fixed ~291-species reference dataset Phase 4
        // was built for.
        <div ref={resultsRef} className="max-h-[600px] overflow-y-auto">
          <VirtualizedTable
            items={results}
            getKey={(r, i) => r.pal.instanceId + i}
            columns={FIND_A_PAL_TABLE_COLUMNS}
            header={['Species', 'Gen', 'Lvl', 'Passives', 'Work', 'IVs H/A/D', 'Location', 'Owner']}
            getScrollElement={() => resultsRef.current}
            estimateSize={45}
            renderRow={(r) => buildFindAPalRowCells(r, speciesById, passivesById, traitFilter, workHighlight)}
            active={active}
          />
        </div>
      ) : (
        // Mobile fallback: a real <table> rather than a flex-wrap row (with a
        // Species/Passives/Work/Owner combo whose lengths vary wildly per Pal, a flex row
        // reflows its whole layout row-to-row) — not virtualized, matching Phase 4's mobile
        // fallback (the CSS-grid virtualization trick isn't compatible with real table layout).
        <div className="overflow-x-auto rounded-[13px] border border-border-card bg-white">
          <table className="w-full border-collapse font-mono">
            <thead>
              <tr className="text-left">
                {['Species', 'Gen', 'Lvl', 'Passives', 'Work', 'IVs H/A/D', 'Location', 'Owner'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map(({ owner, pal, workLevels }, i) => {
                const sp = pal.species ? speciesById.get(pal.species) : undefined;
                return (
                  <tr key={pal.instanceId + i} className="border-t border-panel-header">
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5">
                        <PalIcon icon={sp?.icon} size={20} />
                        <ElementDot elements={sp?.elements} />
                        <b className="whitespace-nowrap text-[12.5px]">{sp?.displayName ?? pal.rawPalId}</b>
                        {pal.shiny && (
                          <span className="text-shiny" title="shiny">
                            <Star size={11} />
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted">
                      <GenderGlyph gender={pal.gender} />
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{pal.level}</td>
                    <td className="px-3 py-2.5">
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
                    </td>
                    <td className="px-3 py-2.5">
                      <WorkSuitabilityRow levels={workLevels} highlight={workHighlight} />
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-muted">
                      {pal.ivs.health}/{pal.ivs.attackMelee}/{pal.ivs.defense}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-[12px] text-ink-muted">
                      {pal.location.kind === 'baseCamp' ? `Base Camp ${shortBaseCampLabel(pal.location.baseCampId)}` : pal.location.kind === 'team' ? 'Team' : 'Palbox'}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border border-primary-border3 bg-primary-tint px-2.5 py-1 font-mono text-[11px] font-semibold text-primary-dark">
                        {owner}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
