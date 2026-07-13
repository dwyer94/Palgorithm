import { useMemo, useState } from 'react';
import { useRoster, useSettings } from '../store/hooks';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { runSingleTargetPlan, computeOwnedUnassignedPassives } from '../solver/runSingleTargetPlan';
import type { PassiveId, SpeciesId, Team, TeamSlot, TeamSlotPlan } from '../store/types';
import { useRulesetContext } from './RulesetContext';
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
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const live = useLiveContext();
  const [planningIndices, setPlanningIndices] = useState<Set<number>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(initialOpenIndex ?? null);

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);

  const updateSlot = (index: number, updater: (slot: TeamSlot) => TeamSlot) => {
    onUpdateTeam({ ...team, slots: team.slots.map((s, i) => (i === index ? updater(s) : s)) });
  };

  const runSlot = (index: number) => {
    const slot = team.slots[index];
    if (!slot || !slot.target || planningIndices.has(index)) return;
    const target = slot.target;
    setPlanningIndices((prev) => new Set(prev).add(index));
    setTimeout(() => {
      const speciesOptions = { catchCost: settings.catchCost, allowCatching: settings.allowCatching };
      const { result, guaranteedCarrierAlt } = runSingleTargetPlan(
        ruleset,
        rosterForSolver,
        target,
        slot.desiredPassives,
        speciesOptions,
      );
      const newPlan: TeamSlotPlan = {
        savedAt: new Date().toISOString(),
        target,
        desiredPassives: slot.desiredPassives,
        result,
        guaranteedCarrierAlt,
        ownedUnassignedPassives: computeOwnedUnassignedPassives(result, rosterForSolver),
      };
      updateSlot(index, (s) => (s.plan ? { ...s, pendingPlan: newPlan } : { ...s, plan: newPlan }));
      setPlanningIndices((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }, 0);
  };

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
            className="cursor-pointer rounded-panel border border-border-card bg-white px-3 py-1.5 font-sans text-[13px] font-semibold text-[#6b655c] hover:border-muted-lighter"
          >
            ← Teams
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
              isPlanning={planningIndices.has(index)}
              isOpen={openIndex === index}
              onPickTarget={(id) => pickTarget(index, id)}
              onSetDesiredPassives={(ids) => setDesiredPassives(index, ids)}
              onRun={() => runSlot(index)}
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
                    guaranteedCarrierAlt={openSlot.pendingPlan.guaranteedCarrierAlt ?? null}
                    desiredPassives={openSlot.pendingPlan.desiredPassives ?? []}
                    ownedUnassignedPassives={openSlot.pendingPlan.ownedUnassignedPassives ?? []}
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
                    guaranteedCarrierAlt={openSlot.plan.guaranteedCarrierAlt ?? null}
                    desiredPassives={openSlot.plan.desiredPassives ?? []}
                    ownedUnassignedPassives={openSlot.plan.ownedUnassignedPassives ?? []}
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
