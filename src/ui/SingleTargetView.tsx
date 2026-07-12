import { useMemo, useState } from 'react';
import { useRoster, useSavedPlans, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { runSingleTargetPlan, computeOwnedUnassignedPassives } from '../solver/runSingleTargetPlan';
import type { GuaranteedCarrierAlternative } from '../solver/passivePlanner';
import type { SpeciesPlanResult } from '../solver/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateSpeciesPlan } from '../live/provenance';
import { buildDisplayNameMap } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect, SingleTargetResultView } from './shared';
import { PalIcon, PassiveChip, Toggle } from './components';

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

  const ownedUnassignedPassives = useMemo(
    () => (result ? computeOwnedUnassignedPassives(result, rosterForSolver) : []),
    [result, rosterForSolver],
  );

  const runPlan = () => {
    if (!target) return;
    setIsPlanning(true);
    setTimeout(() => {
      const speciesOptions = { catchCost: settings.catchCost, allowCatching: settings.allowCatching, ignoreGender };
      const { result: plan, guaranteedCarrierAlt: alt } = runSingleTargetPlan(
        ruleset,
        rosterForSolver,
        target,
        desiredPassives,
        speciesOptions,
      );
      setResult(plan);
      setSavedFlash(false);
      setGuaranteedCarrierAlt(alt);
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
        guaranteedCarrierAlt,
        ownedUnassignedPassives,
      },
    ]);
    setSavedFlash(true);
  };

  const exportPlan = () => {
    if (!result) return;
    const exported = { result, guaranteedCarrierAlt, ownedUnassignedPassives };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
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

              <SingleTargetResultView
                result={result}
                guaranteedCarrierAlt={guaranteedCarrierAlt}
                desiredPassives={desiredPassives}
                ownedUnassignedPassives={ownedUnassignedPassives}
                speciesById={speciesById}
                provenance={provenance}
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
