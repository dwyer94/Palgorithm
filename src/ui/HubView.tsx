import { useMemo, useState } from 'react';
import { useRoster, useSavedPlans, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { planUnion, findHubs } from '../solver/hubFinder';
import type { UnionPlanResult, HubFinderResult } from '../solver/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateUnionPlan } from '../live/provenance';
import { resolvePlayerDisplayName } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { UnionPlanView, HubList } from './shared';
import { ComboCount, ElementDot, PassiveChip, PassiveMultiSelect, Pill, SpeciesTypeahead } from './components';

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

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const displayNameByIdentifier = useMemo(
    () =>
      Object.fromEntries(live.players.map((p) => [p.identifier, resolvePlayerDisplayName(p, settings.live.nameOverrides)])),
    [live.players, settings.live.nameOverrides],
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
    setSavedFlash(false);
  };

  const selectedHubCandidate = hubResult?.hubs.find((h) => h.species === selectedHub);
  const hubInjectTotal = selectedHubCandidate?.injectCost?.reduce((sum, ic) => sum + ic.combos, 0) ?? 0;
  const hubTotal = selectedHubCandidate ? selectedHubCandidate.obtainCost + hubInjectTotal : undefined;
  const hubDelta = unionResult && hubTotal !== undefined ? hubTotal - unionResult.combinationCount : undefined;

  const rosterLiveNames = Array.from(live.selectedPlayerIds).map((id) => displayNameByIdentifier[id] ?? id);
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

  return (
    <>
      {/* ============ INPUT RAIL ============ */}
      <aside className="w-[266px] flex-none overflow-y-auto border-r border-border-card bg-panel-subtle p-5">
        <div className="mb-0.5 font-sans text-[16px] font-bold tracking-[-.3px]">Multi-target plan</div>
        <div className="mb-[22px] font-sans text-[12.5px] text-muted">Breed several targets from one strategy.</div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Targets</div>
        <div className="mb-[10px] flex flex-col gap-[7px]">
          {targets.map((t) => {
            const s = speciesById.get(t);
            return (
              <div key={t} className="flex items-center gap-2.5 rounded-panel border border-border-inner bg-white px-[10px] py-2">
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
      <main className="flex-1 overflow-y-auto bg-canvas">
        <div className="mx-auto max-w-[1080px] px-[34px] pb-[60px] pt-[26px]">
          {!unionResult && (
            <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
              Add at least one target species, then run the plan.
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
                        className="normal-case tracking-normal"
                      />
                    ))}
                  </div>
                  <div className="mt-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Union vs. hub strategy</div>
                </div>
                <div className="flex gap-2">
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
              <div className="mb-[26px] grid grid-cols-[1fr_1fr_250px] gap-3.5">
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
                      <span className="font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-primary-dark">
                        Hub · {speciesById.get(selectedHubCandidate.species)?.displayName ?? selectedHubCandidate.species}
                      </span>
                      <Pill className="bg-primary text-white">best</Pill>
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
                />
              </div>

              <UnionPlanView
                plan={unionResult}
                speciesById={speciesById}
                provenance={provenance}
                hubSpeciesId={selectedHub}
                passivesById={passivesById}
              />
            </>
          )}
        </div>
      </main>
    </>
  );
}
