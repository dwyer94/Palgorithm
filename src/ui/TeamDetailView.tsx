import { useMemo, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useRoster, useSettings } from '../store/hooks';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { computeOwnedUnassignedPassives } from '../solver/runSingleTargetPlan';
import { solverWorker } from '../solver/worker/client';
import type { PassiveId, SpeciesId, Team, TeamSlot, TeamSlotPlan } from '../store/types';
import { useRulesetContext } from './RulesetContext';
import { useKeyedSolverTasks } from './useSolverTask';
import { SingleTargetResultView } from './shared';
import TeamSlotCard from './TeamSlotCard';

/** One team's fixed 5-slot party grid. Each slot solves independently via the same
 * single-target planner `SingleTargetView` uses (`runSingleTargetPlan`); a slot's first run
 * attaches `plan`, every run after that lands in `pendingPlan` until the user picks Keep
 * new/Keep old — the saved plan is never silently overwritten. */
export default function TeamDetailView({
  team,
  onUpdateTeam,
  onBack,
  initialOpenIndex,
}: {
  team: Team;
  onUpdateTeam: (team: Team) => void;
  onBack: () => void;
  initialOpenIndex?: number | null;
}) {
  const { species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const live = useLiveContext();
  // Keyed by slot index, since each slot's solve is independent — cancelling/erroring one slot
  // must never touch another slot's (or another view's) in-flight request.
  const tasks = useKeyedSolverTasks<number>();
  const [openIndex, setOpenIndex] = useState<number | null>(initialOpenIndex ?? null);
  // Since multiple slots can now solve concurrently (worker-backed, no longer main-thread-
  // blocking), a slower slot's `updateSlot` call can fire after a faster slot's already landed
  // and re-rendered this component with a new `team` prop. Reading `team` directly here would
  // apply that update against the *stale* team snapshot captured when this slot's solve
  // started, silently discarding the other slot's already-committed plan. `teamRef` is kept in
  // sync with the latest prop on every render so `updateSlot` always bases its patch on the
  // most current team, however it got there.
  const teamRef = useRef(team);
  teamRef.current = team;

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);

  const updateSlot = (index: number, updater: (slot: TeamSlot) => TeamSlot) => {
    const current = teamRef.current;
    onUpdateTeam({ ...current, slots: current.slots.map((s, i) => (i === index ? updater(s) : s)) });
  };

  const runSlot = (index: number) => {
    const slot = team.slots[index];
    if (!slot || !slot.target || tasks.isPlanning(index)) return;
    const target = slot.target;
    const speciesOptions = { catchCost: settings.catchCost, allowCatching: settings.allowCatching };
    tasks.run(index, () => solverWorker.runSingleTarget(rosterForSolver, target, slot.desiredPassives, speciesOptions), {
      onSuccess: ({ result, guaranteedCarrierOutcome, nextBestWhenOwned }) => {
        const newPlan: TeamSlotPlan = {
          savedAt: new Date().toISOString(),
          target,
          desiredPassives: slot.desiredPassives,
          result,
          guaranteedCarrierOutcome,
          ownedUnassignedPassives: computeOwnedUnassignedPassives(guaranteedCarrierOutcome, rosterForSolver),
          ...(nextBestWhenOwned && {
            nextBestWhenOwned: {
              result: nextBestWhenOwned.result,
              guaranteedCarrierOutcome: nextBestWhenOwned.guaranteedCarrierOutcome,
              ownedUnassignedPassives: computeOwnedUnassignedPassives(nextBestWhenOwned.guaranteedCarrierOutcome, rosterForSolver),
            },
          }),
        };
        updateSlot(index, (s) => (s.plan ? { ...s, pendingPlan: newPlan } : { ...s, plan: newPlan }));
      },
      onError: (err) => console.error(`Team slot ${index} plan failed:`, err),
    });
  };

  const cancelSlot = (index: number) => tasks.cancel(index);

  const keepNew = (index: number) => {
    updateSlot(index, (s) => {
      if (!s.pendingPlan) return s;
      const { pendingPlan, ...rest } = s;
      return { ...rest, plan: pendingPlan };
    });
  };

  const keepOld = (index: number) => {
    updateSlot(index, (s) => {
      const { pendingPlan: _pendingPlan, ...rest } = s;
      return rest;
    });
  };

  const pickTarget = (index: number, id: SpeciesId | null) => {
    updateSlot(index, (s) => ({ ...s, target: id }));
  };

  const setDesiredPassives = (index: number, ids: PassiveId[]) => {
    updateSlot(index, (s) => ({ ...s, desiredPassives: ids }));
  };

  const clearSlot = (index: number) => {
    updateSlot(index, () => ({ target: null, desiredPassives: [] }));
    if (openIndex === index) setOpenIndex(null);
  };

  const toggleView = (index: number) => {
    setOpenIndex((prev) => (prev === index ? null : index));
  };

  const openSlot = openIndex !== null ? team.slots[openIndex] : null;

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
        <div className="mb-4 flex items-center gap-3">
          <span
            onClick={onBack}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3 py-1.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
          >
            <ArrowLeft size={13} /> Teams
          </span>
          <div className="font-sans text-[22px] font-bold tracking-[-.4px]">{team.name}</div>
        </div>

        {live.selectedPlayerIds.size > 0 && (
          <div className="mb-4 font-sans text-[12px] text-muted">
            Including pals from {live.selectedPlayerIds.size} connected player(s).
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {team.slots.map((slot, index) => (
            <TeamSlotCard
              key={index}
              slot={slot}
              species={species}
              passives={passives}
              speciesById={speciesById}
              passivesById={passivesById}
              isPlanning={tasks.isPlanning(index)}
              error={tasks.error(index)}
              isOpen={openIndex === index}
              onPickTarget={(id) => pickTarget(index, id)}
              onSetDesiredPassives={(ids) => setDesiredPassives(index, ids)}
              onRun={() => runSlot(index)}
              onCancel={() => cancelSlot(index)}
              onToggleView={() => toggleView(index)}
              onKeepNew={() => keepNew(index)}
              onKeepOld={() => keepOld(index)}
              onClearSlot={() => clearSlot(index)}
            />
          ))}
        </div>

        {openSlot && (openSlot.plan || openSlot.pendingPlan) && (
          <div className="mt-6 flex flex-col gap-5">
            {openSlot.pendingPlan && (
              <div>
                <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-muted">
                  New re-run result
                </div>
                <div className="rounded-card border border-primary bg-panel-inset p-5">
                  <SingleTargetResultView
                    result={openSlot.pendingPlan.result}
                    guaranteedCarrierOutcome={openSlot.pendingPlan.guaranteedCarrierOutcome ?? { status: 'not-requested' }}
                    desiredPassives={openSlot.pendingPlan.desiredPassives ?? []}
                    ownedUnassignedPassives={openSlot.pendingPlan.ownedUnassignedPassives ?? []}
                    nextBestWhenOwned={openSlot.pendingPlan.nextBestWhenOwned}
                    speciesById={speciesById}
                    passivesById={passivesById}
                  />
                </div>
              </div>
            )}
            {openSlot.plan && (
              <div>
                {openSlot.pendingPlan && (
                  <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-muted">
                    Current saved plan
                  </div>
                )}
                <div className="rounded-card border border-border-divider bg-panel-inset p-5">
                  <SingleTargetResultView
                    result={openSlot.plan.result}
                    guaranteedCarrierOutcome={openSlot.plan.guaranteedCarrierOutcome ?? { status: 'not-requested' }}
                    desiredPassives={openSlot.plan.desiredPassives ?? []}
                    ownedUnassignedPassives={openSlot.plan.ownedUnassignedPassives ?? []}
                    nextBestWhenOwned={openSlot.plan.nextBestWhenOwned}
                    speciesById={speciesById}
                    passivesById={passivesById}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
