import { useState } from 'react';
import { TriangleAlert, X, Play, Eye, RotateCcw, Pencil, Check, Trash2 } from 'lucide-react';
import type { Species, Passive } from '../data/schema';
import type { PassiveId, SpeciesId, TeamSlot } from '../store/types';
import { PalIcon, PassiveChip } from './components';
import { SpeciesSelect, PassiveMultiSelect, effectiveSlotCombos } from './shared';

/** One Team party slot: pick a target + desired perks, run/re-run the single-target planner
 * against it, and resolve any pending re-run preview. Mirrors `SingleTargetView`'s
 * picker/result shapes so a slot reads like a compact version of that planner. */
export default function TeamSlotCard({
  slot,
  species,
  passives,
  speciesById,
  passivesById,
  isPlanning,
  error,
  isOpen,
  onPickTarget,
  onSetDesiredPassives,
  onRun,
  onCancel,
  onToggleView,
  onKeepNew,
  onKeepOld,
  onClearSlot,
}: {
  slot: TeamSlot;
  species: Species[];
  passives: Passive[];
  speciesById: Map<string, Species>;
  passivesById: Map<string, Passive>;
  isPlanning: boolean;
  error?: string | undefined;
  isOpen: boolean;
  onPickTarget: (id: SpeciesId | null) => void;
  onSetDesiredPassives: (ids: PassiveId[]) => void;
  onRun: () => void;
  onCancel: () => void;
  onToggleView: () => void;
  onKeepNew: () => void;
  onKeepOld: () => void;
  onClearSlot: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const showPickers = !slot.plan || editing;
  const targetSpecies = slot.target ? speciesById.get(slot.target) : undefined;

  const currentCombos = slot.plan ? effectiveSlotCombos(slot.plan) : undefined;
  const pendingCombos = slot.pendingPlan ? effectiveSlotCombos(slot.pendingPlan) : undefined;

  if (confirmingClear) {
    return (
      <div className="flex flex-col gap-3 rounded-card border border-brand-hover bg-white p-4 shadow-card">
        <div className="font-sans text-[13px] font-semibold">
          Remove {targetSpecies?.displayName ?? 'this Pal'} from this slot?
        </div>
        {slot.plan && <div className="font-sans text-[12px] text-muted">This deletes its attached plan too.</div>}
        <div className="flex gap-1.5">
          <span
            onClick={() => {
              setConfirmingClear(false);
              onClearSlot();
            }}
            className="cursor-pointer rounded-panel bg-brand-hover px-2.5 py-1.5 font-sans text-[12px] font-semibold text-white hover:opacity-90"
          >
            Yes, remove
          </span>
          <span
            onClick={() => setConfirmingClear(false)}
            className="cursor-pointer rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:border-muted-lighter"
          >
            Cancel
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-card bg-white p-4 shadow-card">
      {showPickers && (
        <>
          <div className="font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Target</div>
          <SpeciesSelect species={species} value={slot.target ?? ''} onChange={(id) => onPickTarget(id || null)} allowEmpty />

          <div className="font-sans text-[10.5px] font-semibold uppercase tracking-[.8px] text-muted">Desired perks</div>
          <PassiveMultiSelect passives={passives} value={slot.desiredPassives} onChange={onSetDesiredPassives} maxSelections={4} />

          {slot.plan && (
            <span
              onClick={() => setEditing(false)}
              className="cursor-pointer self-start font-sans text-[12px] font-semibold text-muted hover:text-brand-hover"
            >
              Done editing
            </span>
          )}
        </>
      )}

      {!showPickers && targetSpecies && (
        <div className="flex items-start gap-2.5">
          <PalIcon icon={targetSpecies.icon} size={34} variant="card" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-sans text-[15px] font-bold">{targetSpecies.displayName}</div>
            {slot.desiredPassives.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {slot.desiredPassives.map((id) => (
                  <PassiveChip
                    key={id}
                    label={passivesById.get(id)?.displayName ?? id}
                    tier={passivesById.get(id)?.tier}
                    description={passivesById.get(id)?.description}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!isPlanning && error && (
        <div className="rounded-panel border border-l-[3px] border-l-brand-hover border-border-card bg-white px-2.5 py-2 font-sans text-[11.5px] text-ink-strong">
          <div className="flex items-center gap-1 font-semibold text-brand-hover">
            <TriangleAlert size={12} /> Plan failed
          </div>
          <div className="text-muted">{error}</div>
        </div>
      )}

      {!slot.plan && (
        <div
          onClick={isPlanning ? onCancel : slot.target ? onRun : undefined}
          className={`flex items-center justify-center gap-2 rounded-[10px] bg-sidebar-bg px-3 py-2.5 font-sans text-[13px] font-semibold text-white ${
            slot.target || isPlanning ? 'cursor-pointer hover:bg-sidebar-hover' : 'cursor-not-allowed opacity-50'
          }`}
        >
          {isPlanning ? (
            <>
              <X size={13} /> Cancel
            </>
          ) : (
            <>
              <Play size={13} /> Run plan
            </>
          )}
        </div>
      )}

      {slot.plan && !slot.pendingPlan && (
        <>
          <div
            className={`font-mono text-[12px] font-semibold ${
              currentCombos!.feasible ? 'text-success-text' : 'text-brand-hover'
            }`}
          >
            {currentCombos!.qualifier}
            {currentCombos!.feasible ? `${currentCombos!.combinationCount} combos` : 'infeasible'}
          </div>
          {/* Suppressed when owned outright — the main badge above already reflects
              `nextBestWhenOwned`'s own guaranteed-carrier route in that case (via
              `effectiveSlotCombos`), so this would just show a second, differently-scoped
              number for the same "guaranteed-perk" question. */}
          {!slot.plan.nextBestWhenOwned && slot.plan.guaranteedCarrierOutcome?.status === 'routed' && (
            <div className="font-mono text-[11px] text-muted">
              guaranteed-carrier: +{slot.plan.guaranteedCarrierOutcome.alt.combinationDelta} combos (
              {slot.plan.guaranteedCarrierOutcome.alt.plan.combinationCount} total)
            </div>
          )}

          <div className="flex flex-wrap gap-1.5">
            <span
              onClick={onToggleView}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold hover:border-primary hover:text-primary-dark"
            >
              {isOpen ? '▾ Hide' : (
                <>
                  <Eye size={12} /> View
                </>
              )}
            </span>
            <span
              onClick={isPlanning ? onCancel : onRun}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold hover:border-primary hover:text-primary-dark"
            >
              {isPlanning ? (
                <>
                  <X size={12} /> Cancel
                </>
              ) : (
                <>
                  <RotateCcw size={12} /> Re-run
                </>
              )}
            </span>
            <span
              onClick={() => setEditing(true)}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:text-brand-hover"
            >
              <Pencil size={12} /> Edit target
            </span>
          </div>
        </>
      )}

      {slot.pendingPlan && (
        <div className="flex flex-col gap-2 rounded-panel border border-dashed border-primary bg-panel-subtle p-3">
          <div className="font-sans text-[11px] font-semibold uppercase tracking-[.6px] text-muted">New re-run result</div>
          <div className="flex items-center gap-4">
            <div>
              <div className="font-sans text-[10.5px] text-muted-light">Current</div>
              <div className={`font-mono text-[13px] font-semibold ${currentCombos && currentCombos.feasible ? 'text-success-text' : 'text-brand-hover'}`}>
                {currentCombos ? (
                  <>
                    {currentCombos.qualifier}
                    {currentCombos.feasible ? `${currentCombos.combinationCount} combos` : 'infeasible'}
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div>
              <div className="font-sans text-[10.5px] text-muted-light">New</div>
              <div
                className={`font-mono text-[13px] font-semibold ${
                  pendingCombos!.feasible ? 'text-success-text' : 'text-brand-hover'
                }`}
              >
                {pendingCombos!.qualifier}
                {pendingCombos!.feasible ? `${pendingCombos!.combinationCount} combos` : 'infeasible'}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span
              onClick={onKeepNew}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel bg-primary px-2.5 py-1.5 font-sans text-[12px] font-semibold text-white hover:bg-primary-dark"
            >
              <Check size={12} /> Keep new
            </span>
            <span
              onClick={onKeepOld}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:border-brand-hover hover:text-brand-hover"
            >
              <X size={12} /> Keep old
            </span>
            <span
              onClick={onToggleView}
              className="inline-flex cursor-pointer items-center gap-1 rounded-panel border border-border-card px-2.5 py-1.5 font-sans text-[12px] font-semibold hover:border-primary hover:text-primary-dark"
            >
              {isOpen ? (
                '▾ Hide compare'
              ) : (
                <>
                  <Eye size={12} /> Compare
                </>
              )}
            </span>
          </div>
        </div>
      )}

      {slot.target && (
        <span
          onClick={() => setConfirmingClear(true)}
          className="inline-flex cursor-pointer items-center gap-1 self-start font-mono text-[11px] font-semibold text-muted-lighter hover:text-brand-hover"
        >
          <Trash2 size={11} /> Clear slot
        </span>
      )}
    </div>
  );
}
