import { useMemo, useState } from 'react';
import { Hourglass, X, TriangleAlert, ArrowLeft, Bookmark, BookmarkCheck, Download, Bug, Play } from 'lucide-react';
import { useRoster, useSavedPlans, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { computeOwnedUnassignedPassives } from '../solver/runSingleTargetPlan';
import { solverWorker } from '../solver/worker/client';
import type { GuaranteedCarrierOutcome } from '../solver/passivePlanner';
import type { ProfileSpan } from '../solver/profiler';
import type { RosterEntry, SpeciesPlannerOptions, SpeciesPlanResult } from '../solver/types';
import type { NextBestWhenOwnedSnapshot } from '../store/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateSpeciesPlan } from '../live/provenance';
import { buildDisplayNameMap } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { useSolverTask } from './useSolverTask';
import { PassiveMultiSelect, SpeciesSelect, SingleTargetResultView } from './shared';
import { PalIcon, PassiveChip, Toggle } from './components';

/** Single-target planner (design handoff README: reuses the Hub planner's shared pieces —
 * input rail shape, `SpeciesPlanView`'s graph/steps rendering, perk overlay). No hub
 * comparison here; that's Hub planner-only. */
export default function SingleTargetView() {
  const { species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const [savedPlans, setSavedPlans] = useSavedPlans();
  const live = useLiveContext();
  const [target, setTarget] = useState(species[0]?.id ?? '');
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [ignoreGender, setIgnoreGender] = useState(false);
  const [result, setResult] = useState<SpeciesPlanResult | null>(null);
  const [guaranteedCarrierOutcome, setGuaranteedCarrierOutcome] = useState<GuaranteedCarrierOutcome>({ status: 'not-requested' });
  const [nextBestWhenOwned, setNextBestWhenOwned] = useState<NextBestWhenOwnedSnapshot | undefined>(undefined);
  const [saved, setSavedFlash] = useState(false);
  const task = useSolverTask();
  // Captured at the moment `runPlan` actually fires, not re-read at export time — so a debug
  // bundle always matches the exact call that produced `result`, even if the user tweaks the
  // target/roster afterward but before clicking Debug Export.
  const [lastRunInputs, setLastRunInputs] = useState<{
    target: string;
    desiredPassives: string[];
    ignoreGender: boolean;
    options: SpeciesPlannerOptions;
    roster: RosterEntry[];
  } | null>(null);
  const [lastProfile, setLastProfile] = useState<ProfileSpan[] | null>(null);

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
    () => computeOwnedUnassignedPassives(guaranteedCarrierOutcome, rosterForSolver),
    [guaranteedCarrierOutcome, rosterForSolver],
  );

  const runPlan = () => {
    if (!target) return;
    const speciesOptions = { catchCost: settings.catchCost, allowCatching: settings.allowCatching, ignoreGender };
    setLastRunInputs({ target, desiredPassives, ignoreGender, options: speciesOptions, roster: rosterForSolver });
    task.run(() => solverWorker.runSingleTarget(rosterForSolver, target, desiredPassives, speciesOptions), {
      onSuccess: ({ result: plan, guaranteedCarrierOutcome: outcome, nextBestWhenOwned: nextBest }) => {
        setResult(plan);
        setSavedFlash(false);
        setGuaranteedCarrierOutcome(outcome);
        setNextBestWhenOwned(
          nextBest
            ? {
                result: nextBest.result,
                guaranteedCarrierOutcome: nextBest.guaranteedCarrierOutcome,
                ownedUnassignedPassives: computeOwnedUnassignedPassives(nextBest.guaranteedCarrierOutcome, rosterForSolver),
              }
            : undefined,
        );
        setLastProfile(solverWorker.getLastSingleTargetProfile());
      },
      // Never leave the view stuck on "Solving…" — surface the failure so the user (and we)
      // can see why no plan came back, rather than an infinite spinner.
      onError: () => {
        setResult(null);
        setNextBestWhenOwned(undefined);
        setGuaranteedCarrierOutcome({ status: 'not-requested' });
        setLastProfile(null);
      },
    });
  };

  const cancelPlan = () => task.cancel();

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
        guaranteedCarrierOutcome,
        ownedUnassignedPassives,
        ...(nextBestWhenOwned && { nextBestWhenOwned }),
      },
    ]);
    setSavedFlash(true);
  };

  const exportPlan = () => {
    if (!result) return;
    const exported = { result, guaranteedCarrierOutcome, ownedUnassignedPassives, nextBestWhenOwned };
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palgorithm-single-plan.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Full repro bundle for "something looked wrong" reports: the exact inputs that produced
   * `result` (target/perks/options/roster — `lastRunInputs`, captured at the moment `runPlan`
   * fired, not re-read now), the output, and the profiler trace for that run. `roster` here is
   * already the solver-facing shape (`buildRosterForSolver` output: `{species, gender,
   * passives}` only) — no player names/SteamIDs, which live solely in `settings.live` and
   * `live.players`, neither of which this touches. */
  const debugExport = () => {
    if (!result || !lastRunInputs) return;
    const bundle = {
      exportedAt: new Date().toISOString(),
      inputs: lastRunInputs,
      output: { result, guaranteedCarrierOutcome, ownedUnassignedPassives, nextBestWhenOwned },
      profile: lastProfile,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `palgorithm-debug-${Date.now()}.json`;
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
          <PassiveMultiSelect passives={passives} value={desiredPassives} onChange={setDesiredPassives} maxSelections={4} />
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
          onClick={task.isPlanning ? undefined : runPlan}
          className={`flex items-center justify-center gap-2.5 rounded-[10px] bg-sidebar-bg px-[13px] py-[13px] font-sans text-[14px] font-semibold tracking-[.3px] text-white shadow-[0_2px_5px_rgba(0,0,0,.14)] ${
            task.isPlanning ? 'opacity-60' : 'cursor-pointer hover:bg-sidebar-hover'
          }`}
        >
          {task.isPlanning ? (
            <>
              <Hourglass size={14} /> Running plan…
            </>
          ) : (
            <>
              <Play size={14} /> Run plan
            </>
          )}
        </div>
      </aside>

      <main className="flex-1 bg-canvas md:overflow-y-auto">
        <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
          {task.isPlanning && (
            <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
              <div className="mb-3 inline-flex items-center gap-1.5">
                <Hourglass size={14} />
                Solving breeding paths…
              </div>
              <div
                onClick={cancelPlan}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2 font-sans text-[12.5px] font-semibold text-[#6b655c] hover:border-muted-lighter"
              >
                <X size={13} /> Cancel
              </div>
            </div>
          )}

          {!task.isPlanning && task.error && (
            <div className="rounded-card border border-l-[4px] border-l-brand-hover border-border-card bg-white p-6 font-sans text-[13px] text-ink-strong">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-brand-hover">
                <TriangleAlert size={13} /> Couldn't compute a plan
              </div>
              <div className="text-muted">{task.error}</div>
              <div className="mt-2 text-[12px] text-muted-light">
                This is unexpected — if it keeps happening, the target/perk combination above is worth reporting.
              </div>
            </div>
          )}

          {!task.isPlanning && !result && !task.error && (
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
                    <ArrowLeft size={14} /> Back
                  </div>
                  <div
                    onClick={savePlan}
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold hover:border-brand-hover hover:text-brand-hover"
                  >
                    {saved ? (
                      <>
                        <BookmarkCheck size={14} /> Saved
                      </>
                    ) : (
                      <>
                        <Bookmark size={14} /> Save plan
                      </>
                    )}
                  </div>
                  <div
                    onClick={exportPlan}
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
                  >
                    <Download size={14} /> Export
                  </div>
                  <div
                    onClick={debugExport}
                    title="Download inputs, roster, timing, and output for troubleshooting"
                    className="flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
                  >
                    <Bug size={14} /> Debug Export
                  </div>
                </div>
              </div>

              <SingleTargetResultView
                result={result}
                guaranteedCarrierOutcome={guaranteedCarrierOutcome}
                desiredPassives={desiredPassives}
                ownedUnassignedPassives={ownedUnassignedPassives}
                nextBestWhenOwned={nextBestWhenOwned}
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
