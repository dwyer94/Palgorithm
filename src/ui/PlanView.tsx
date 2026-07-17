import { useMemo, useState, type ReactNode } from 'react';
import type { Species, SpeciesId, Passive } from '../data/schema';
import type { PassivePlanResult, PlanIndividual, SpeciesPlanStep } from '../solver/types';
import type { ProvenanceMatch } from '../live/provenance';
import { matchProvenance } from '../live/provenance';
import type { LivePlayerPals, PlayerIdentifier } from '../live/types';
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
  leafProvenance?: Map<string, ProvenanceMatch> | undefined;
}

/** Base camp owner names bake in a live level ("Base Camp F017474B (Lv 24)") that's useful in
 * a roster list but is just wrapping-clutter in a leaf node's compact "owned by" tag, which
 * already shares its line with 4+ passive chips — drop it here (full name still lands in the
 * `title` tooltip via `leafSourceLabel`'s caller). */
function compactOwnerLabel(name: string): string {
  return name.replace(/\s+\(Lv\s*\d+\)$/i, '');
}

/** Small inline "whose box is this from" tag for an owned leaf node — `Roster` when no
 * live pal of that species+gender matched (which, since candidates are only drawn from
 * connected live players, unambiguously means it came from the local roster instead). */
function leafSourceLabel(node: PlanGraphNode, ctx: PlanGraphContext): string {
  const match = ctx.leafProvenance?.get(node.id);
  if (!match) return ' · Roster';
  const name = compactOwnerLabel(match.ownerDisplayName);
  return match.confident ? ` · ${name}` : ` · ${name}?`;
}

/** The untruncated owner name, for a `title` tooltip — `undefined` when `leafSourceLabel`
 * didn't shorten anything, so the browser tooltip only appears where it adds information. */
function leafSourceTitle(node: PlanGraphNode, ctx: PlanGraphContext): string | undefined {
  const match = ctx.leafProvenance?.get(node.id);
  if (!match) return undefined;
  const full = match.ownerDisplayName;
  return compactOwnerLabel(full) === full ? undefined : full;
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
      return {
        label: <span title={leafSourceTitle(node, ctx)}>owned{leafSourceLabel(node, ctx)}</span>,
        className: 'text-success-text',
      };
    }
    return {
      label: (
        <span className="inline-flex flex-wrap items-center gap-1">
          <span title={leafSourceTitle(node, ctx)}>
            owned{leafSourceLabel(node, ctx)}
          </span>{' '}
          ·
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
  passivePlan,
  passivesById,
  selectedPlayerIds,
  palsByPlayer,
  displayNameByIdentifier,
}: {
  steps: SpeciesPlanStep[];
  catches: PlanIndividual[];
  targets: SpeciesId[];
  speciesById: Map<string, Species>;
  hubSpeciesId?: string | undefined;
  desiredPassives?: string[] | undefined;
  passivePlan?: PassivePlanResult | undefined;
  passivesById?: Map<string, Passive> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
}) {
  const passiveLabel = useMemo(() => (id: string) => passivesById?.get(id)?.displayName ?? id, [passivesById]);
  const layout = useMemo(
    () => buildPlanGraph(steps, catches, targets, passivePlan, desiredPassives, passiveLabel),
    [steps, catches, targets, passivePlan, desiredPassives, passiveLabel],
  );
  // Match each leaf/owned node (not the raw plan steps) against the live pools, so the
  // dedup already done by `buildPlanGraph` (one node per species+gender) is respected
  // rather than re-derived — a produced intermediate that happens to share a species+gender
  // with a live pal never gets a spurious "owned by" tag, since it's never a leaf node here.
  const leafProvenance = useMemo(() => {
    if (!selectedPlayerIds || !palsByPlayer || !displayNameByIdentifier) return undefined;
    const claimed = new Set<string>();
    const map = new Map<string, ProvenanceMatch>();
    for (const node of layout.nodes) {
      if (node.kind !== 'leaf' || node.isCatch || node.gender === null) continue;
      const match = matchProvenance(
        { species: node.species, gender: node.gender, ...(node.passives && { passives: node.passives }) },
        selectedPlayerIds,
        palsByPlayer,
        displayNameByIdentifier,
        claimed,
      );
      if (match) map.set(node.id, match);
    }
    return map;
  }, [layout.nodes, selectedPlayerIds, palsByPlayer, displayNameByIdentifier]);
  const ctx: PlanGraphContext = { speciesById, hubSpeciesId, desiredPassives, passivesById, leafProvenance };

  // Which leaf node (if any) actually supplies each desired passive — `buildPlanGraph`
  // overlays real passives only onto the final-cross parent leaves, so this is at most a
  // 2-entry scan, not a general search.
  const passiveSourceNodeId = useMemo(() => {
    const map = new Map<string, string>();
    for (const node of layout.nodes) {
      if (node.kind !== 'leaf' || !node.passives) continue;
      for (const id of node.passives) if (!map.has(id)) map.set(id, node.id);
    }
    return map;
  }, [layout.nodes]);
  const unassignedSet = new Set(passivePlan?.unassigned ?? []);
  const targetPassiveChips = desiredPassives?.map((id) => {
    const p = passivesById?.get(id);
    const sourceNodeId = passiveSourceNodeId.get(id);
    return {
      id,
      label: p?.displayName ?? id,
      tier: p?.tier,
      description: p?.description,
      ...(sourceNodeId ? { chipVariant: 'matched' as const, sourceNodeId } : unassignedSet.has(id) ? { chipVariant: 'warn' as const } : {}),
    };
  });

  // Hovering a node isolates its own lineage — direct parent edge(s) in and the one child
  // edge out light up while every unrelated line/box fades, which is the only reliable way
  // to follow one Pal's line once several curves start crossing in a busy graph. A desired
  // perk chip on the target wires into the same mechanism (`onChipHover` below): hovering
  // "Artisan" on the target highlights the exact ancestor leaf that supplies it.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const { litEdges, litNodes } = useMemo(() => {
    if (!hoverId) return { litEdges: null as Set<number> | null, litNodes: null as Set<string> | null };
    const edges = new Set<number>();
    const nodes = new Set<string>([hoverId]);
    layout.edges.forEach((e, i) => {
      if (e.from === hoverId || e.to === hoverId) {
        edges.add(i);
        nodes.add(e.from);
        nodes.add(e.to);
      }
    });
    return { litEdges: edges, litNodes: nodes };
  }, [hoverId, layout.edges]);

  // Two edges with identical endpoints (a species bred with itself, so parentA and parentB
  // both resolve to the same leaf node) would otherwise draw as one indistinguishable line —
  // bow each occurrence past the first a bit further so they fan apart.
  const dupSeen = new Map<string, number>();

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
            <marker id="pg-arrow-lit" markerWidth="8" markerHeight="8" refX="6.5" refY="3.5" orient="auto">
              <path d="M0,0 L7,3.5 L0,7 z" fill="#3b6fd6" />
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
            const dupKey = `${e.from}->${e.to}`;
            const dupIndex = dupSeen.get(dupKey) ?? 0;
            dupSeen.set(dupKey, dupIndex + 1);
            const bow = dupIndex === 0 ? 0 : (dupIndex % 2 === 1 ? 1 : -1) * Math.ceil(dupIndex / 2) * 16;
            const isLit = litEdges?.has(i) ?? false;
            const isDimmed = litEdges !== null && !isLit;
            return (
              <path
                key={i}
                d={edgePath(x1, y1, x2, y2, bow)}
                fill="none"
                stroke={isLit ? '#3b6fd6' : e.fromShared ? '#d2691e' : '#c4bbaa'}
                strokeWidth={isLit ? 2.6 : e.fromShared ? 2.1 : 1.6}
                opacity={isDimmed ? 0.18 : 1}
                markerEnd={isLit ? 'url(#pg-arrow-lit)' : e.fromShared ? 'url(#pg-arrow-shared)' : 'url(#pg-arrow)'}
                className="transition-[opacity,stroke,stroke-width] duration-150"
              />
            );
          })}
        </svg>
        {layout.columns.map((col) => (
          <div
            key={col.index}
            className="absolute font-mono text-[10.5px] font-bold tracking-[0.5px] text-muted"
            style={{ left: col.index === 0 ? 8 : col.index * 236 + 8, top: 2 }}
          >
            {col.label}
          </div>
        ))}
        {layout.nodes.map((node) => {
          const variant = nodeVariant(node, ctx);
          const { label, className } = nodeSubLabel(node, ctx);
          const isTarget = variant === 'target';
          const isDimmed = litNodes !== null && !litNodes.has(node.id);
          return (
            <PalNode
              key={node.id}
              onMouseEnter={() => setHoverId(node.id)}
              onMouseLeave={() => setHoverId((cur) => (cur === node.id ? null : cur))}
              species={speciesName(speciesById, node.species)}
              icon={speciesById.get(node.species)?.icon}
              elements={speciesById.get(node.species)?.elements}
              gender={node.gender}
              variant={variant}
              subLabel={label}
              subLabelClassName={className}
              passiveChips={isTarget ? targetPassiveChips : undefined}
              onChipHover={isTarget ? setHoverId : undefined}
              style={{ position: 'absolute', left: node.x, top: node.y + 22, opacity: isDimmed ? 0.35 : 1 }}
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
  passivePlan,
  passivesById,
  selectedPlayerIds,
  palsByPlayer,
  displayNameByIdentifier,
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
  passivePlan?: PassivePlanResult | undefined;
  passivesById?: Map<string, Passive> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
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
          passivePlan={passivePlan}
          passivesById={passivesById}
          selectedPlayerIds={selectedPlayerIds}
          palsByPlayer={palsByPlayer}
          displayNameByIdentifier={displayNameByIdentifier}
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
