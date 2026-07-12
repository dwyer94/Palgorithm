import { useMemo, useState } from 'react';
import { useRoster, useSavedPlans, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { planSpecies } from '../solver/speciesPlanner';
import { findGuaranteedCarrierAlternative, type GuaranteedCarrierAlternative } from '../solver/passivePlanner';
import type { SpeciesPlanResult } from '../solver/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateSpeciesPlan } from '../live/provenance';
import { buildDisplayNameMap } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect, SpeciesPlanView } from './shared';
import { HoverTooltip, PalIcon, PassiveChip, Toggle } from './components';

/** Single-target planner (design handoff README: reuses the Hub planner's shared pieces —
 * input rail shape, `SpeciesPlanView`'s graph/steps rendering, perk overlay). No hub
 * comparison here; that's Hub planner-only. */
export default function SingleTargetView() {
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const [savedPlans, setSavedPlans] = useSavedPlans();
  const live = useLiveContext();
  const [target, setTarget] = useState(species[0]?.id ?? '');
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [ignoreGender, setIgnoreGender] = useState(false);
  const [result, setResult] = useState<SpeciesPlanResult | null>(null);
  const [guaranteedCarrierAlt, setGuaranteedCarrierAlt] = useState<GuaranteedCarrierAlternative | null>(null);
  const [saved, setSavedFlash] = useState(false);
  const [isPlanning, setIsPlanning] = useState(false);

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const displayNameByIdentifier = useMemo(
    () => buildDisplayNameMap(live.players, live.selectedPlayerIds, settings.live.nameOverrides, settings.live.identityLinks),
    [live.players, live.selectedPlayerIds, settings.live.nameOverrides, settings.live.identityLinks],
  );

  const provenance = useMemo(
    () => (result ? annotateSpeciesPlan(result, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier) : undefined),
    [result, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier],
  );

  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);

  const runPlan = () => {
    if (!target) return;
    setIsPlanning(true);
    setTimeout(() => {
      const speciesOptions = { catchCost: settings.catchCost, allowCatching: settings.allowCatching, ignoreGender };
      const plan = planSpecies(ruleset, rosterForSolver, target, {
        ...speciesOptions,
        ...(desiredPassives.length > 0 && { desiredPassives }),
      });
      setResult(plan);
      setSavedFlash(false);
      setGuaranteedCarrierAlt(
        plan.passivePlan?.unassigned.length
          ? findGuaranteedCarrierAlternative(ruleset, rosterForSolver, target, plan, speciesOptions)
          : null,
      );
      setIsPlanning(false);
    }, 0);
  };

  const savePlan = () => {
    if (!result) return;
    setSavedPlans([
      ...savedPlans,
      {
        id: newId(),
        name: speciesById.get(target)?.displayName ?? target,
        savedAt: new Date().toISOString(),
        kind: 'single',
        targets: [target],
        ...(desiredPassives.length > 0 && { desiredPassives }),
        result,
      },
    ]);
    setSavedFlash(true);
  };

  const exportPlan = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palgorithm-single-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const backToSelection = () => {
    setResult(null);
    setSavedFlash(false);
  };

  const targetSpecies = speciesById.get(target);

  return (
    <>
      <aside className="w-full flex-none border-b border-border-card bg-panel-subtle p-5 md:w-[266px] md:overflow-y-auto md:border-b-0 md:border-r">
        <div className="mb-0.5 font-sans text-[16px] font-bold tracking-[-.3px]">Single-target plan</div>
        <div className="mb-[22px] font-sans text-[12.5px] text-muted">Cheapest breeding path to one Pal.</div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Target</div>
        <div className="mb-[22px]">
          <SpeciesSelect species={species} value={target} onChange={setTarget} />
        </div>

        <div className="mb-[9px] font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Desired perks</div>
        <div className="mb-[22px]">
          <PassiveMultiSelect passives={passives} value={desiredPassives} onChange={setDesiredPassives} />
        </div>

        {live.selectedPlayerIds.size > 0 && (
          <div className="mb-[18px] font-sans text-[12px] text-muted">
            Including pals from {live.selectedPlayerIds.size} connected player(s).
          </div>
        )}

        <div className="mb-[18px] flex items-center gap-3 rounded-panel border border-border-inner bg-white px-3 py-[11px]">
          <div>
            <div className="font-sans text-[13px] font-semibold">Ignore gender</div>
            <div className="font-sans text-[11.5px] text-muted-light">Assume any Pal can be gender-swapped before breeding.</div>
          </div>
          <div className="ml-auto">
            <Toggle on={ignoreGender} onChange={setIgnoreGender} />
          </div>
        </div>

        <div
          onClick={isPlanning ? undefined : runPlan}
          className={`flex items-center justify-center gap-2.5 rounded-[10px] bg-sidebar-bg px-[13px] py-[13px] font-sans text-[14px] font-semibold tracking-[.3px] text-white shadow-[0_2px_5px_rgba(0,0,0,.14)] ${
            isPlanning ? 'opacity-60' : 'cursor-pointer hover:bg-sidebar-hover'
          }`}
        >
          {isPlanning ? '⏳ Running plan…' : '▶ Run plan'}
        </div>
      </aside>

      <main className="flex-1 bg-canvas md:overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
          {isPlanning && (
            <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
              ⏳ Solving breeding paths…
            </div>
          )}

          {!isPlanning && !result && (
            <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
              Pick a target species, then run the plan.
            </div>
          )}

          {result && (
            <>
              <div className="mb-5 flex items-baseline justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5 font-sans text-[11px] font-semibold uppercase tracking-[.8px] text-muted">
                    <span>Result · single target</span>
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
                  <div className="mt-0.5 flex items-center gap-2 font-sans text-[22px] font-bold tracking-[-.4px]">
                    <PalIcon icon={targetSpecies?.icon} size={30} />
                    {targetSpecies?.displayName ?? target}
                  </div>
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

              {result.passivePlan && result.passivePlan.unassigned.length > 0 && (
                <div className="mb-6">
                  <div className="flex items-center gap-2.5 rounded-t-card border border-b-0 border-l-[4px] border-l-brand border-border-card bg-[#fdfaf4] px-4 py-3">
                    <span className="flex-none rounded-[5px] bg-brand px-[7px] py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[.5px] text-white">
                      Alternative
                    </span>
                    <HoverTooltip description="Deliberately breeds in the Pal(s) that already carry your desired perks, so they're structurally part of the lineage instead of showing up by chance. This usually costs more breeding combinations than the cheapest path below, and the perks still aren't 100% guaranteed to land on any single egg — just far more likely.">
                      <span className="font-sans text-[13.5px] font-bold text-ink-strong">Guaranteed-carrier</span>
                    </HoverTooltip>
                    <span className="font-sans text-[11.5px] text-muted">forces the perk(s) into one lineage</span>
                  </div>
                  <div className="flex flex-col gap-2.5 rounded-b-card border border-t-0 border-l-[4px] border-l-brand border-border-card bg-panel-subtle p-3.5">
                    {guaranteedCarrierAlt && (
                      <details open className="overflow-hidden rounded-card border border-border-card bg-white">
                        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-[18px] py-3.5">
                          <span className="flex flex-none items-center -space-x-1.5">
                            {guaranteedCarrierAlt.sourceIndividuals.map((s, i) => (
                              <PalIcon key={i} icon={speciesById.get(s.species)?.icon} size={22} />
                            ))}
                          </span>
                          <span className="font-mono text-[13px] font-semibold">
                            Routes{' '}
                            {guaranteedCarrierAlt.sourceIndividuals
                              .map((s) => speciesById.get(s.species)?.displayName ?? s.species)
                              .join(', ')}{' '}
                            in for{' '}
                            {guaranteedCarrierAlt.routedPassives
                              .map((id) => passivesById.get(id)?.displayName ?? id)
                              .join(' + ')}
                          </span>
                          <span className="ml-auto flex items-center gap-2 font-mono text-[11.5px] font-semibold">
                            <span className="text-brand-hover">
                              +{guaranteedCarrierAlt.combinationDelta} combo{guaranteedCarrierAlt.combinationDelta === 1 ? '' : 's'}
                            </span>
                            <span className="text-muted">
                              {(guaranteedCarrierAlt.compoundedOdds * 100).toFixed(1)}% compounded odds/egg
                            </span>
                          </span>
                          <span className="font-sans text-[12px] text-muted-lighter">▾</span>
                        </summary>
                        <div className="border-t border-[#f2ecdf] p-[18px]">
                          <SpeciesPlanView
                            plan={guaranteedCarrierAlt.plan}
                            speciesById={speciesById}
                            passivesById={passivesById}
                            selectedPlayerIds={live.selectedPlayerIds}
                            palsByPlayer={live.palsByPlayer}
                            displayNameByIdentifier={displayNameByIdentifier}
                            note="guaranteed-carrier route"
                          />
                        </div>
                      </details>
                    )}

                    {(guaranteedCarrierAlt
                      ? result.passivePlan.unassigned.filter((p) => !guaranteedCarrierAlt.routedPassives.includes(p))
                      : result.passivePlan.unassigned
                    ).map((passiveId) => {
                      const label = passivesById.get(passiveId)?.displayName ?? passiveId;
                      const owned = rosterForSolver.some((r) => r.passives?.includes(passiveId));
                      return (
                        <div
                          key={passiveId}
                          className="rounded-card border border-dashed border-border-input bg-white px-[18px] py-3 font-sans text-[12.5px] text-muted"
                        >
                          {owned
                            ? `Even prioritizing the Pal that carries ${label}, no breeding route to ${targetSpecies?.displayName ?? target} was found under your current catch/roster settings.`
                            : `No Pal in your roster or connected servers carries ${label} — nothing to route in.`}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {desiredPassives.length > 0 ? (
                <div className="mb-5">
                  <div className="flex items-center gap-2.5 rounded-t-card border border-b-0 border-l-[4px] border-l-primary border-border-card bg-primary-tint px-4 py-3">
                    <span className="flex-none rounded-[5px] bg-primary px-[7px] py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[.5px] text-white">
                      Default
                    </span>
                    <HoverTooltip description="The cheapest breeding path to this Pal, full stop — no extra steps are spent trying to guarantee any perk. If a desired perk happens to sit on the final parents for free, you'll get a real shot at landing it; otherwise it only comes down to luck later on.">
                      <span className="font-sans text-[13.5px] font-bold text-ink-strong">Opportunistic</span>
                    </HoverTooltip>
                    <span className="font-sans text-[11.5px] text-muted">cheapest path, perks land only if free</span>
                  </div>
                  <div className="rounded-b-card border border-t-0 border-l-[4px] border-l-primary border-border-card bg-panel-subtle p-3.5">
                    <SpeciesPlanView
                      plan={result}
                      speciesById={speciesById}
                      provenance={provenance}
                      passivesById={passivesById}
                      selectedPlayerIds={live.selectedPlayerIds}
                      palsByPlayer={live.palsByPlayer}
                      displayNameByIdentifier={displayNameByIdentifier}
                      note="opportunistic route"
                    />
                  </div>
                </div>
              ) : (
                <SpeciesPlanView
                  plan={result}
                  speciesById={speciesById}
                  provenance={provenance}
                  passivesById={passivesById}
                  selectedPlayerIds={live.selectedPlayerIds}
                  palsByPlayer={live.palsByPlayer}
                  displayNameByIdentifier={displayNameByIdentifier}
                />
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}
