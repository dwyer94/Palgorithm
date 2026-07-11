import { useMemo, useState } from 'react';
import { useRoster, useSavedPlans, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { planUnion, findHubs } from '../solver/hubFinder';
import type { UnionPlanResult, HubFinderResult } from '../solver/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateUnionPlan } from '../live/provenance';
import { buildDisplayNameMap } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { UnionPlanView, HubList } from './shared';
import { ComboCount, ElementDot, PalIcon, PassiveChip, PassiveMultiSelect, Pill, SpeciesTypeahead } from './components';
import rawSuggestedHubs from '../data/suggestedHubs.1.0.json';
import { SuggestedHubsSchema, type RoleSuggestion } from '../data/suggestedHubsSchema';

/** Precomputed "if you want popular combat/worker/mount pals, here's a hub to aim for"
 * shortcuts (src/pipeline/suggestHubs.ts). Parsed once at module load — static bundled
 * data, not user data, so it doesn't need to live behind a hook. */
const suggestedHubs = SuggestedHubsSchema.parse(rawSuggestedHubs);

const ROLE_META: Record<string, { label: string; icon: string }> = {
  combat: { label: 'Combat', icon: '⚔' },
  worker: { label: 'Worker', icon: '🔧' },
  mount: { label: 'Mount', icon: '🐎' },
};

/** Multi-target / hub planner — the flagship view (design handoff README, "Hub planner").
 * Compares the always-valid union plan against ranked hub strategies; the union plan is
 * the only one ever actually rendered as a graph (hubs are cost comparisons, never a
 * fabricated alternate plan — see PlanView.tsx). */
export default function HubView() {
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const [savedPlans, setSavedPlans] = useSavedPlans();
  const live = useLiveContext();
  const [targets, setTargets] = useState<string[]>([]);
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [unionResult, setUnionResult] = useState<UnionPlanResult | null>(null);
  const [hubResult, setHubResult] = useState<HubFinderResult | null>(null);
  const [selectedHub, setSelectedHub] = useState<string | undefined>(undefined);
  const [saved, setSavedFlash] = useState(false);
  /** 'quick' = the hub list only re-scored a precomputed 3-candidate shortlist against
   * the live roster (fast, but not exhaustive); 'full' = every candidate species was
   * swept, same as before this feature existed. Surfaced in the UI rather than left
   * silent — the two answer genuinely different questions (spec discussion: quick-pick
   * can miss a hub the real roster makes cheaper). */
  const [hubScope, setHubScope] = useState<'quick' | 'full' | undefined>(undefined);
  /** True while the "search all hubs" full sweep is running — it's a synchronous,
   * potentially many-second computation over every candidate species, so this drives a
   * visible loading state instead of leaving the UI looking frozen with no feedback. */
  const [searchingAllHubs, setSearchingAllHubs] = useState(false);

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const displayNameByIdentifier = useMemo(
    () => buildDisplayNameMap(live.players, live.selectedPlayerIds, settings.live.nameOverrides, settings.live.identityLinks),
    [live.players, live.selectedPlayerIds, settings.live.nameOverrides, settings.live.identityLinks],
  );

  const provenance = useMemo(
    () =>
      unionResult ? annotateUnionPlan(unionResult, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier) : undefined,
    [unionResult, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier],
  );

  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);

  const addTarget = (id: string) => {
    if (id && !targets.includes(id)) setTargets([...targets, id]);
  };
  const removeTarget = (id: string) => setTargets(targets.filter((t) => t !== id));

  const applySavedSet = (id: string) => {
    const set = settings.savedPerkSets.find((s) => s.id === id);
    if (set) setDesiredPassives(Array.from(new Set([...desiredPassives, ...set.passives])));
  };

  const runPlan = () => {
    if (targets.length === 0) return;
    const options = {
      catchCost: settings.catchCost,
      allowCatching: settings.allowCatching,
      ...(desiredPassives.length > 0 && { desiredPassives }),
    };
    const union = planUnion(ruleset, rosterForSolver, targets, options);
    const hubs = findHubs(ruleset, rosterForSolver, { ...options, targets });
    setUnionResult(union);
    setHubResult(hubs);
    setSelectedHub(hubs.hubs[0]?.species);
    setHubScope('full');
    setSavedFlash(false);
  };

  /** Suggestion-card quick-start (design brief: "auto jump to the next step"). Fills the
   * curated target list and immediately shows results, but only re-scores the 3
   * precomputed hub candidates against the real roster instead of the full ~200-species
   * sweep `runPlan` does — cheap enough to run on click with no separate button press.
   *
   * Uses the same allowCatching:true + excludeTargetsFromCatching assumption
   * suggestHubs.ts used to compute the card's advertised numbers, regardless of the
   * user's own roster-only Settings toggle — the card already promised e.g. "union 7
   * combos"; recomputing under stricter live settings would silently contradict that and
   * show "not reachable" instead. The user's real roster is still used, so anything they
   * already own reduces cost same as always; "search all hubs" / manual Run plan still
   * respect the real settings for open-ended target picks. */
  const applySuggestion = (roleData: RoleSuggestion) => {
    setTargets(roleData.targets);
    setDesiredPassives([]);
    const options = { allowCatching: true, excludeTargetsFromCatching: true };
    const union = planUnion(ruleset, rosterForSolver, roleData.targets, options);
    const hubs = findHubs(ruleset, rosterForSolver, {
      ...options,
      targets: roleData.targets,
      candidates: roleData.topHubs.map((h) => h.species),
    });
    setUnionResult(union);
    setHubResult(hubs);
    setSelectedHub(hubs.hubs[0]?.species);
    setHubScope('quick');
    setSavedFlash(false);
  };

  /** Upgrades a quick-pick to the full exhaustive sweep — deliberately its own handler,
   * not a call into `runPlan`: it must keep the SAME allowCatching:true +
   * excludeTargetsFromCatching assumption `applySuggestion` used, not the user's live
   * Settings, or the result would silently contradict the numbers already on screen.
   * `findHubs` now solves the base roster once and reuses it across candidates (skipping the
   * anchor-hint sweep that used to make an unreachable full search take 70+ seconds), so this
   * is typically well under a second; the setTimeout defer + "searching…" state is kept as
   * cheap insurance for the rare target set that still forces per-candidate solves. */
  const searchAllHubsFromSuggestion = () => {
    setSearchingAllHubs(true);
    setTimeout(() => {
      const options = { allowCatching: true, excludeTargetsFromCatching: true };
      const hubs = findHubs(ruleset, rosterForSolver, { ...options, targets });
      setHubResult(hubs);
      setSelectedHub(hubs.hubs[0]?.species);
      setHubScope('full');
      setSearchingAllHubs(false);
    }, 0);
  };

  const selectedHubCandidate = hubResult?.hubs.find((h) => h.species === selectedHub);
  const hubInjectTotal = selectedHubCandidate?.injectCost?.reduce((sum, ic) => sum + ic.combos, 0) ?? 0;
  const hubTotal = selectedHubCandidate ? selectedHubCandidate.obtainCost + hubInjectTotal : undefined;
  const hubDelta = unionResult && hubTotal !== undefined ? hubTotal - unionResult.combinationCount : undefined;

  const rosterLiveNames = Array.from(live.selectedPlayerIds).map((id) => displayNameByIdentifier[id]!);
  const rosterLivePalCount = Array.from(live.selectedPlayerIds).reduce(
    (sum, id) => sum + (live.palsByPlayer[id]?.pals.length ?? 0),
    0,
  );

  const savePlan = () => {
    if (!unionResult) return;
    setSavedPlans([
      ...savedPlans,
      {
        id: newId(),
        name: `${targets.map((t) => speciesById.get(t)?.displayName ?? t).join(' + ')}`,
        savedAt: new Date().toISOString(),
        kind: 'union',
        targets,
        ...(desiredPassives.length > 0 && { desiredPassives }),
        result: unionResult,
      },
    ]);
    setSavedFlash(true);
  };

  const exportPlan = () => {
    if (!unionResult) return;
    const blob = new Blob([JSON.stringify(unionResult, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palgorithm-union-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const backToSelection = () => {
    setUnionResult(null);
    setHubResult(null);
    setSelectedHub(undefined);
    setHubScope(undefined);
    setSavedFlash(false);
  };

  return (
    <>
      {/* ============ INPUT RAIL ============ */}
      <aside className="w-full flex-none border-b border-border-card bg-panel-subtle p-5 md:w-[266px] md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="mb-0.5 font-sans text-[16px] font-bold tracking-[-.3px]">Multi-target plan</div>
        <div className="mb-[22px] font-sans text-[12.5px] text-muted">Breed several targets from one strategy.</div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Targets</div>
        <div className="mb-[10px] flex flex-col gap-[7px]">
          {targets.map((t) => {
            const s = speciesById.get(t);
            return (
              <div key={t} className="flex items-center gap-2.5 rounded-panel border border-border-inner bg-white px-[10px] py-2">
                <PalIcon icon={s?.icon} size={22} />
                <ElementDot elements={s?.elements} />
                <span className="font-mono text-[13px] font-semibold">{s?.displayName ?? t}</span>
                {s?.rank != null && (
                  <span className="rounded font-mono text-[10px] font-medium text-[#9a7b3a] bg-[#f0e8d7] px-[5px] py-px">
                    r{s.rank}
                  </span>
                )}
                <span
                  onClick={() => removeTarget(t)}
                  className="ml-auto cursor-pointer text-[15px] text-muted-lighter hover:text-brand-hover"
                >
                  ×
                </span>
              </div>
            );
          })}
        </div>
        <div className="mb-[22px]">
          <SpeciesTypeahead
            species={species}
            onPick={addTarget}
            placeholder="＋ Add target species…"
            exclude={new Set(targets)}
          />
        </div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Shared perks</div>
        <PassiveMultiSelect passives={passives} value={desiredPassives} onChange={setDesiredPassives} />
        {settings.savedPerkSets.length > 0 && (
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) applySavedSet(e.target.value);
              e.target.value = '';
            }}
            className="mt-2 w-full rounded-panel border border-border-inner bg-white px-2.5 py-1.5 font-sans text-[12px] text-muted"
          >
            <option value="">apply saved set…</option>
            {settings.savedPerkSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div className="mb-[22px] mt-2 font-sans text-[11.5px] text-muted-light">Injected at the final cross only.</div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Pal pools</div>
        <div className="mb-6 rounded-panel border border-border-inner bg-white px-3 py-[11px]">
          <div className="mb-2 flex items-center gap-2 font-sans text-[13px]">
            <span className="h-[7px] w-[7px] rounded-full bg-success-text" /> Local roster
            <span className="ml-auto font-mono text-[11px] font-medium text-muted">{roster.length}</span>
          </div>
          {rosterLiveNames.length > 0 && (
            <div className="flex items-center gap-2 font-sans text-[13px] text-ink-muted">
              <span className="h-[7px] w-[7px] rounded-full bg-primary" /> {rosterLiveNames.join(', ')}
              <span className="ml-auto font-mono text-[11px] font-medium text-muted">+{rosterLivePalCount}</span>
            </div>
          )}
        </div>

        <div
          onClick={runPlan}
          className="flex cursor-pointer items-center justify-center gap-2.5 rounded-[10px] bg-sidebar-bg px-[13px] py-[13px] font-sans text-[14px] font-semibold tracking-[.3px] text-white shadow-[0_2px_5px_rgba(0,0,0,.14)] hover:bg-sidebar-hover"
        >
          ▶ Run plan
        </div>
      </aside>

      {/* ============ RESULT ============ */}
      <main className="flex-1 bg-canvas md:overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
          {!unionResult && (
            <div>
              <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
                Add at least one target species, then run the plan.
              </div>
              <div className="mb-2.5 mt-[26px] font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">
                Or jump-start with a popular pick
              </div>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                {Object.entries(suggestedHubs.roles).map(([role, roleData]) => {
                  const meta = ROLE_META[role] ?? { label: role, icon: '★' };
                  const top = roleData.topHubs[0];
                  return (
                    <div
                      key={role}
                      onClick={() => applySuggestion(roleData)}
                      className="cursor-pointer rounded-card border border-border-card bg-white p-[18px] shadow-card hover:border-brand-hover"
                    >
                      <div className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-muted">
                        {meta.icon} {meta.label}
                      </div>
                      <div className="flex items-center gap-2 font-mono text-[16px] font-bold text-ink-strong">
                        {top && <PalIcon icon={speciesById.get(top.species)?.icon} size={26} />}
                        {top ? (speciesById.get(top.species)?.displayName ?? top.species) : '—'}
                      </div>
                      <div className="mt-1 font-sans text-[12px] text-muted-light">
                        {roleData.targets.length} popular targets · union {roleData.unionCombinationCount} combos
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1 border-t border-dashed border-border-inner pt-2.5">
                        {roleData.targets.map((t) => (
                          <span
                            key={t}
                            className="rounded font-mono text-[10.5px] font-medium text-muted bg-panel-inset px-[6px] py-[2px]"
                          >
                            {speciesById.get(t)?.displayName ?? t}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {unionResult && (
            <>
              <div className="mb-5 flex items-baseline justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[.8px] text-muted">
                    <span>
                      Result · {targets.length} target{targets.length === 1 ? '' : 's'}
                      {desiredPassives.length > 0 && ' · shared'}
                    </span>
                    {desiredPassives.map((id) => (
                      <PassiveChip
                        key={id}
                        label={passivesById.get(id)?.displayName ?? id}
                        tier={passivesById.get(id)?.tier}
                        description={passivesById.get(id)?.description}
                        className="normal-case tracking-normal"
                      />
                    ))}
                  </div>
                  <div className="mt-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Union vs. hub strategy</div>
                </div>
                <div className="flex gap-2">
                  <div
                    onClick={backToSelection}
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
                  >
                    ← Back
                  </div>
                  <div
                    onClick={savePlan}
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold hover:border-brand-hover hover:text-brand-hover"
                  >
                    {saved ? '✓ Saved' : '★ Save plan'}
                  </div>
                  <div
                    onClick={exportPlan}
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
                  >
                    ⤓ Export
                  </div>
                </div>
              </div>

              {/* COMPARE STRIP */}
              <div className="mb-[26px] grid grid-cols-1 gap-3.5 lg:grid-cols-[1fr_1fr_250px]">
                <div className="rounded-card border border-border-card bg-white p-[18px] px-5 shadow-card">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-muted">Union plan</span>
                    <Pill className="bg-[#f0ece2] text-muted">baseline</Pill>
                  </div>
                  <ComboCount
                    value={unionResult.combinationCount}
                    caption="distinct combinations"
                    meta={`cost ${unionResult.cost}${unionResult.catches.length > 0 ? ` · ${unionResult.catches.length} catch${unionResult.catches.length === 1 ? '' : 'es'}` : ''}`}
                  />
                  <div className="mt-2.5 border-t border-dashed border-border-inner pt-2.5 font-sans text-[12.5px] text-muted-light">
                    Always valid — the strategy that never needs a hub.
                  </div>
                </div>

                {selectedHubCandidate ? (
                  <div className="rounded-card border-[1.5px] border-primary bg-primary-tint2 p-[18px] px-5 shadow-elevated-blue">
                    <div className="mb-1.5 flex items-center gap-2">
                      <PalIcon icon={speciesById.get(selectedHubCandidate.species)?.icon} size={20} />
                      <span className="font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-primary-dark">
                        Hub · {speciesById.get(selectedHubCandidate.species)?.displayName ?? selectedHubCandidate.species}
                      </span>
                      <Pill className="bg-primary text-white">best</Pill>
                      {hubScope === 'quick' && (
                        <>
                          <Pill className="bg-[#fdf1d8] text-[#9a7b3a]">quick pick</Pill>
                          <span
                            onClick={searchingAllHubs ? undefined : searchAllHubsFromSuggestion}
                            className={`ml-auto font-sans text-[11px] font-semibold text-primary-dark ${
                              searchingAllHubs ? 'opacity-60' : 'cursor-pointer hover:underline'
                            }`}
                          >
                            {searchingAllHubs ? '⏳ searching every hub…' : '🔍 search all hubs'}
                          </span>
                        </>
                      )}
                    </div>
                    <ComboCount
                      value={hubTotal ?? '—'}
                      valueClassName="text-primary-darker"
                      caption={
                        hubDelta !== undefined ? (
                          <span className="font-semibold text-primary-dark">
                            {hubDelta === 0 ? 'same as union' : `${hubDelta > 0 ? '+' : ''}${hubDelta} vs union`}
                          </span>
                        ) : (
                          ''
                        )
                      }
                      meta={
                        <span className="text-[#5a7fb8]">
                          obtain {selectedHubCandidate.obtainCost}
                          {selectedHubCandidate.score !== undefined && ` · score ${selectedHubCandidate.score}`}
                        </span>
                      }
                    />
                    <div className="mt-2.5 flex flex-col gap-1.5 border-t border-dashed border-primary-border pt-2.5">
                      {(selectedHubCandidate.injectCost ?? []).map((ic) => (
                        <div key={ic.target} className="flex items-center gap-2 text-[12.5px]">
                          <PalIcon icon={speciesById.get(ic.target)?.icon} size={18} />
                          <span className="font-mono text-[12.5px] font-semibold text-ink-strong">
                            → {speciesById.get(ic.target)?.displayName ?? ic.target}
                          </span>
                          <span
                            className={`ml-auto rounded-[5px] border px-1.5 py-px font-mono text-[10px] font-semibold ${
                              ic.direct
                                ? 'border-primary-border2 bg-[#e2edfc] text-primary-dark'
                                : 'border-border-inner bg-[#f0ece2] text-muted'
                            }`}
                          >
                            {ic.direct ? 'direct · 1 cross' : `via ${ic.combos}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center rounded-card border border-dashed border-border-input bg-white p-5 font-sans text-[12.5px] text-muted">
                    No hub candidates.
                  </div>
                )}

                <HubList
                  hubs={hubResult?.hubs ?? []}
                  speciesById={speciesById}
                  selected={selectedHub}
                  onSelect={setSelectedHub}
                  scopeLabel={
                    hubScope === 'quick'
                      ? `Quick pick · ${hubResult?.hubs.length ?? 0} checked`
                      : hubScope === 'full'
                        ? `Ranked hubs · ${Object.keys(ruleset.rankTable).length - targets.length} checked`
                        : undefined
                  }
                />
              </div>

              <UnionPlanView
                plan={unionResult}
                speciesById={speciesById}
                provenance={provenance}
                hubSpeciesId={selectedHub}
                passivesById={passivesById}
                selectedPlayerIds={live.selectedPlayerIds}
                palsByPlayer={live.palsByPlayer}
                displayNameByIdentifier={displayNameByIdentifier}
              />
            </>
          )}
        </div>
      </main>
    </>
  );
}
