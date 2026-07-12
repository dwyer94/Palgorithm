import { useMemo, useState } from 'react';
import { useSavedPlans } from '../store/hooks';
import type { SavedPlan } from '../store/types';
import type { SpeciesPlanResult, UnionPlanResult } from '../solver/types';
import { useRulesetContext } from './RulesetContext';
import { UnionPlanView, SingleTargetResultView } from './shared';

/** Saved plans (design handoff README: "wire up Saved Plans" — not mocked separately,
 * reuses `UnionPlanView`/`SpeciesPlanView`). Re-opening renders the stored result as-is,
 * never recomputes — a saved plan is a snapshot, not a live query. */
export default function SavedPlansView() {
  const [plans, setPlans] = useSavedPlans();
  const [openId, setOpenId] = useState<string | null>(null);

  const remove = (id: string) => {
    setPlans(plans.filter((p) => p.id !== id));
    if (openId === id) setOpenId(null);
  };

  const rename = (id: string, name: string) => {
    setPlans(plans.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Saved plans</div>
        <div className="mb-6 font-sans text-[13px] text-muted">
          Snapshots from the Hub and Single-target planners — reopening replays the stored result, it never recomputes.
        </div>

        {plans.length === 0 && (
          <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-10 text-center font-sans text-[13px] text-muted">
            No saved plans yet. Use "★ Save plan" from a planner result.
          </div>
        )}

        <div className="flex flex-col gap-3">
          {plans.map((plan) => (
            <SavedPlanCard
              key={plan.id}
              plan={plan}
              open={openId === plan.id}
              onToggle={() => setOpenId(openId === plan.id ? null : plan.id)}
              onRemove={() => remove(plan.id)}
              onRename={(name) => rename(plan.id, name)}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function SavedPlanCard({
  plan,
  open,
  onToggle,
  onRemove,
  onRename,
}: {
  plan: SavedPlan;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (name: string) => void;
}) {
  const { speciesById, passives } = useRulesetContext();
  const passivesById = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const combinationCount = plan.result.combinationCount;
  const feasible = plan.result.feasible;
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState(plan.name);

  return (
    <div className="overflow-hidden rounded-card border border-border-card bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {editingName ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              className="rounded-[7px] border-[1.5px] border-primary px-2 py-1 font-sans text-[14px] font-bold text-ink outline-none"
            />
            <span
              onClick={() => {
                if (draftName.trim()) onRename(draftName.trim());
                setEditingName(false);
              }}
              className="cursor-pointer rounded-[6px] bg-primary px-2 py-1 font-mono text-[11px] font-semibold text-white"
            >
              Save
            </span>
            <span
              onClick={() => {
                setDraftName(plan.name);
                setEditingName(false);
              }}
              className="cursor-pointer px-1 py-1 font-mono text-[11px] font-semibold text-muted"
            >
              Cancel
            </span>
          </div>
        ) : (
          <>
            <span className="font-sans text-[15px] font-bold">{plan.name}</span>
            <span
              onClick={() => {
                setDraftName(plan.name);
                setEditingName(true);
              }}
              className="cursor-pointer rounded-[5px] bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-medium text-muted-light hover:text-brand-hover"
            >
              ✎ rename
            </span>
          </>
        )}
        <span className="rounded-pill bg-[#f0ece2] px-[7px] py-[2px] font-sans text-[10px] font-semibold text-muted">
          {plan.kind === 'union' ? 'multi-target' : 'single-target'}
        </span>
        <span className="font-mono text-[11px] text-muted">{new Date(plan.savedAt).toLocaleString()}</span>
        <span className={`font-mono text-[12px] font-semibold ${feasible ? 'text-success-text' : 'text-brand-hover'}`}>
          {feasible ? `${combinationCount} combos` : 'infeasible'}
        </span>
        <div className="ml-auto flex gap-2">
          <span
            onClick={onToggle}
            className="cursor-pointer rounded-panel border border-border-card px-3 py-1.5 font-sans text-[12px] font-semibold hover:border-primary hover:text-primary-dark"
          >
            {open ? '▾ Hide' : '▸ Open'}
          </span>
          <span
            onClick={onRemove}
            className="cursor-pointer rounded-panel border border-border-card px-3 py-1.5 font-sans text-[12px] font-semibold text-muted-light hover:border-brand-hover hover:text-brand-hover"
          >
            Delete
          </span>
        </div>
      </div>
      {open && (
        <div className="border-t border-border-divider bg-panel-inset p-5">
          {plan.kind === 'union' ? (
            <UnionPlanView plan={plan.result as UnionPlanResult} speciesById={speciesById} passivesById={passivesById} />
          ) : (
            <SingleTargetResultView
              result={plan.result as SpeciesPlanResult}
              guaranteedCarrierAlt={plan.guaranteedCarrierAlt ?? null}
              desiredPassives={plan.desiredPassives ?? []}
              ownedUnassignedPassives={plan.ownedUnassignedPassives ?? []}
              speciesById={speciesById}
              passivesById={passivesById}
            />
          )}
        </div>
      )}
    </div>
  );
}
