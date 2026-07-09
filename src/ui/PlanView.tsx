import { useMemo, useState, type ReactNode } from 'react';
import type { Species, SpeciesId, Passive } from '../data/schema';
import type { PlanIndividual, SpeciesPlanStep } from '../solver/types';
import type { ProvenanceMatch } from '../live/provenance';
import { buildPlanGraph, edgePath, type PlanGraphNode } from './graphLayout';
import { GenderGlyph, PalIcon, PalNode, PassiveChip, SegmentedControl, type PalNodeVariant } from './components';

/**
 * The "Selected plan" panel shared by the Hub planner and Single-target planner (design
 * handoff README, "Plan graph" + steps list). Renders either the layered DAG or the
 * numbered steps list from the same `steps`/`catches` data — no separate mock state.
 */

const NODE_ANCHOR_Y = 24;

function speciesName(speciesById: Map<string, Species>, id: SpeciesId): string {
  return speciesById.get(id)?.displayName ?? id;
}

function provenanceHint(provenance: Map<string, ProvenanceMatch> | undefined, key: string): string {
  const match = provenance?.get(key);
  if (!match) return '';
  return match.confident ? ` (owned by ${match.ownerDisplayName})` : ` (possibly ${match.ownerDisplayName}'s)`;
}

interface PlanGraphContext {
  speciesById: Map<string, Species>;
  hubSpeciesId?: string | undefined;
  desiredPassives?: string[] | undefined;
  passivesById?: Map<string, Passive> | undefined;
}

function nodeVariant(node: PlanGraphNode, ctx: PlanGraphContext): PalNodeVariant {
  if (node.isTarget) return 'target';
  if (ctx.hubSpeciesId && node.species === ctx.hubSpeciesId && node.kind === 'produced') return 'hub';
  if (node.isShared) return 'shared';
  if (node.kind === 'leaf') return 'leaf';
  return 'bred';
}

function nodeSubLabel(node: PlanGraphNode, ctx: PlanGraphContext): { label: ReactNode; className: string } {
  if (node.kind === 'leaf') {
    if (node.isCatch) {
      const rank = ctx.speciesById.get(node.species)?.rank;
      return { label: `catch${rank !== null && rank !== undefined ? ` · r${rank}` : ''}`, className: 'text-brand-hover' };
    }
    if (!node.passives || node.passives.length === 0) {
      return { label: 'owned', className: 'text-success-text' };
    }
    return {
      label: (
        <span className="inline-flex flex-wrap items-center gap-1">
          owned ·
          {node.passives.map((id) => {
            const p = ctx.passivesById?.get(id);
            return (
              <PassiveChip
                key={id}
                label={p?.displayName ?? id}
                tier={p?.tier}
                description={p?.description}
                className="px-1 py-0 text-[9px] leading-[14px]"
              />
            );
          })}
        </span>
      ),
      className: 'text-success-text',
    };
  }
  if (node.isShared) {
    return { label: 'shared · used ×2', className: 'text-brand-hover font-semibold' };
  }
  if (ctx.hubSpeciesId && node.species === ctx.hubSpeciesId) {
    return { label: `step ${(node.stepIndex ?? 0) + 1} · hub`, className: 'text-primary-dark' };
  }
  return { label: `step ${(node.stepIndex ?? 0) + 1}`, className: 'text-muted' };
}

export function PlanGraphPanel({
  steps,
  catches,
  targets,
  speciesById,
  hubSpeciesId,
  desiredPassives,
  passivesById,
}: {
  steps: SpeciesPlanStep[];
  catches: PlanIndividual[];
  targets: SpeciesId[];
  speciesById: Map<string, Species>;
  hubSpeciesId?: string | undefined;
  desiredPassives?: string[] | undefined;
  passivesById?: Map<string, Passive> | undefined;
}) {
  const layout = useMemo(() => buildPlanGraph(steps, catches, targets), [steps, catches, targets]);
  const ctx: PlanGraphContext = { speciesById, hubSpeciesId, desiredPassives, passivesById };
  const targetPassiveChips = desiredPassives?.map((id) => {
    const p = passivesById?.get(id);
    return { id, label: p?.displayName ?? id, tier: p?.tier, description: p?.description };
  });

  if (layout.nodes.length === 0) {
    return <p className="p-5 font-sans text-[13px] text-muted">Nothing to render yet — run a plan first.</p>;
  }

  return (
    <div className="overflow-x-auto p-5">
      <div className="relative mx-auto" style={{ width: layout.width, height: layout.height }}>
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} className="pointer-events-none absolute inset-0">
          <defs>
            <marker id="pg-arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill="#b3aa99" />
            </marker>
            <marker id="pg-arrow-shared" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill="#d2691e" />
            </marker>
          </defs>
          {layout.edges.map((e, i) => {
            const from = layout.nodeById.get(e.from);
            const to = layout.nodeById.get(e.to);
            if (!from || !to) return null;
            const x1 = from.x + 150;
            const y1 = from.y + NODE_ANCHOR_Y;
            const x2 = to.x;
            const y2 = to.y + NODE_ANCHOR_Y;
            return (
              <path
                key={i}
                d={edgePath(x1, y1, x2, y2)}
                fill="none"
                stroke={e.fromShared ? '#d2691e' : '#c4bbaa'}
                strokeWidth={e.fromShared ? 2.1 : 1.6}
                markerEnd={e.fromShared ? 'url(#pg-arrow-shared)' : 'url(#pg-arrow)'}
              />
            );
          })}
        </svg>
        {layout.columns.map((col) => (
          <div
            key={col.index}
            className="absolute font-mono text-[9.5px] font-semibold tracking-[1px] text-muted-lighter"
            style={{ left: col.index === 0 ? 8 : col.index * 236 + 8, top: 2 }}
          >
            {col.label}
          </div>
        ))}
        {layout.nodes.map((node) => {
          const variant = nodeVariant(node, ctx);
          const { label, className } = nodeSubLabel(node, ctx);
          const isTarget = variant === 'target';
          return (
            <PalNode
              key={node.id}
              species={speciesName(speciesById, node.species)}
              icon={speciesById.get(node.species)?.icon}
              elements={speciesById.get(node.species)?.elements}
              gender={node.gender}
              variant={variant}
              subLabel={label}
              subLabelClassName={className}
              passiveChips={isTarget ? targetPassiveChips : undefined}
              style={{ position: 'absolute', left: node.x, top: node.y + 22 }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function StepsList({
  steps,
  catches,
  targets,
  speciesById,
  provenance,
  hubSpeciesId,
}: {
  steps: SpeciesPlanStep[];
  catches: PlanIndividual[];
  targets: SpeciesId[];
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  hubSpeciesId?: string | undefined;
}) {
  const targetSet = new Set(targets);
  const catchKeySet = new Set(catches.map((c) => `${c.species}:${c.gender}`));
  const producedSpecies = new Map<SpeciesId, number>();
  const outDegreeBySpecies = new Map<SpeciesId, number>();
  steps.forEach((step, i) => {
    for (const parent of [step.parentA, step.parentB]) {
      const producerStep = producedSpecies.get(parent.species);
      if (producerStep !== undefined) outDegreeBySpecies.set(parent.species, (outDegreeBySpecies.get(parent.species) ?? 0) + 1);
    }
    producedSpecies.set(step.child, i);
  });

  return (
    <div className="py-1.5">
      {steps.map((step, i) => {
        const isTarget = targetSet.has(step.child);
        const isHub = hubSpeciesId === step.child;
        const wasSharedProducer = (outDegreeBySpecies.get(step.child) ?? 0) >= 2;
        const parentIsCatch = (ind: PlanIndividual) => catchKeySet.has(`${ind.species}:${ind.gender}`);
        return (
          <div key={i} className="flex flex-wrap items-center gap-3 border-b border-[#f2ecdf] px-[22px] py-3 last:border-b-0">
            <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-sidebar-bg font-mono text-[11px] font-bold text-white">
              {i + 1}
            </span>
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-semibold">
              <PalIcon icon={speciesById.get(step.parentA.species)?.icon} size={20} />
              {speciesName(speciesById, step.parentA.species)} <GenderGlyph gender={step.parentA.gender} />
            </span>
            {parentIsCatch(step.parentA) && (
              <span className="rounded-[5px] border border-[#e0cf9a] bg-[#f6efe1] px-1.5 py-px font-mono text-[10px] font-semibold text-provisional-text">
                catch{speciesById.get(step.parentA.species)?.rank != null ? ` r${speciesById.get(step.parentA.species)?.rank}` : ''}
              </span>
            )}
            <span className="font-mono font-bold text-shared">×</span>
            <span className="flex items-center gap-1.5 font-mono text-[13px] font-semibold">
              <PalIcon icon={speciesById.get(step.parentB.species)?.icon} size={20} />
              {speciesName(speciesById, step.parentB.species)} <GenderGlyph gender={step.parentB.gender} />
            </span>
            {parentIsCatch(step.parentB) && (
              <span className="rounded-[5px] border border-[#e0cf9a] bg-[#f6efe1] px-1.5 py-px font-mono text-[10px] font-semibold text-provisional-text">
                catch{speciesById.get(step.parentB.species)?.rank != null ? ` r${speciesById.get(step.parentB.species)?.rank}` : ''}
              </span>
            )}
            <span className="mx-0.5 font-mono font-bold text-shared">→</span>
            <span className={`flex items-center gap-1.5 font-mono text-[13px] font-semibold ${isTarget ? '' : isHub ? 'text-primary-darker' : ''}`}>
              <PalIcon icon={speciesById.get(step.child)?.icon} size={20} />
              {speciesName(speciesById, step.child)}
              {isTarget && ' ✦'}
            </span>
            {isHub && (
              <span className="rounded-[5px] border border-primary-border2 bg-[#e2edfc] px-1.5 py-px font-mono text-[10px] font-semibold text-primary-dark">
                hub
              </span>
            )}
            {!isTarget && !isHub && wasSharedProducer && (
              <span className="rounded-[5px] border border-danger-border bg-[#fdf1ea] px-1.5 py-px font-mono text-[10px] font-semibold text-danger-text">
                shared
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-muted">
              {provenanceHint(provenance, `step:${i}:A`)}
              {provenanceHint(provenance, `step:${i}:B`)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function PlanRenderer({
  steps,
  catches,
  targets,
  speciesById,
  provenance,
  hubSpeciesId,
  desiredPassives,
  passivesById,
  title = 'Selected plan',
  note,
}: {
  steps: SpeciesPlanStep[];
  catches: PlanIndividual[];
  targets: SpeciesId[];
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  hubSpeciesId?: string | undefined;
  desiredPassives?: string[] | undefined;
  passivesById?: Map<string, Passive> | undefined;
  title?: string;
  note?: string;
}) {
  const [view, setView] = useState<'graph' | 'list'>('graph');
  return (
    <div className="mb-[22px] overflow-hidden rounded-card border border-border-card bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-border-divider bg-panel-inset px-5 py-[15px]">
        <div className="flex items-baseline gap-3">
          <span className="font-sans text-[15px] font-bold">{title}</span>
          {note && <span className="font-mono text-[12px] text-muted">{note}</span>}
        </div>
        <SegmentedControl
          value={view}
          onChange={setView}
          options={[
            { value: 'graph', label: '◈ Graph' },
            { value: 'list', label: '☰ Steps' },
          ]}
        />
      </div>
      {view === 'graph' ? (
        <PlanGraphPanel
          steps={steps}
          catches={catches}
          targets={targets}
          speciesById={speciesById}
          hubSpeciesId={hubSpeciesId}
          desiredPassives={desiredPassives}
          passivesById={passivesById}
        />
      ) : (
        <StepsList
          steps={steps}
          catches={catches}
          targets={targets}
          speciesById={speciesById}
          provenance={provenance}
          hubSpeciesId={hubSpeciesId}
        />
      )}
    </div>
  );
}
