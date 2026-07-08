import type { Gender, SpeciesId } from '../data/schema';
import type { PlanIndividual, SpeciesPlanStep } from '../solver/types';

/**
 * Deterministic layered layout for the plan graph (design handoff README, "Plan graph" —
 * the one piece of genuinely new logic rather than a restyle). Column = longest-path depth
 * from leaves (own/catch individuals); a node produced by a step and consumed as a parent
 * by more than one later step is a "shared" node (CLAUDE.md invariant #4 made visible: bred
 * once, used twice). No force/physics layout — same steps in, same layout out.
 */

export type PlanGraphNodeKind = 'leaf' | 'produced';

export interface PlanGraphNode {
  id: string;
  species: SpeciesId;
  gender: Gender | null;
  kind: PlanGraphNodeKind;
  isCatch: boolean;
  isTarget: boolean;
  isShared: boolean;
  passives?: string[] | undefined;
  stepIndex?: number | undefined;
  column: number;
  row: number;
  x: number;
  y: number;
}

export interface PlanGraphEdge {
  from: string;
  to: string;
  fromShared: boolean;
}

export interface PlanGraphColumn {
  index: number;
  label: string;
}

export interface PlanGraphLayout {
  nodes: PlanGraphNode[];
  nodeById: Map<string, PlanGraphNode>;
  edges: PlanGraphEdge[];
  columns: PlanGraphColumn[];
  width: number;
  height: number;
}

const NODE_WIDTH = 150;
const COLUMN_WIDTH = 236;
const ROW_HEIGHT = 66;
const TOP_PAD = 26;
const LEFT_PAD = 8;

function leafKey(species: SpeciesId, gender: Gender | null): string {
  return `leaf:${species}:${gender ?? 'either'}`;
}

export function buildPlanGraph(
  steps: SpeciesPlanStep[],
  catches: PlanIndividual[],
  targets: SpeciesId[],
): PlanGraphLayout {
  const targetSet = new Set(targets);
  const catchKeys = new Set(catches.map((c) => leafKey(c.species, c.gender)));

  const nodes = new Map<string, PlanGraphNode>();
  const edges: PlanGraphEdge[] = [];
  const leafOrder: string[] = [];
  // Most recent producing step index for a given species, so a later step's parent
  // reference resolves to the nearest prior producer rather than an arbitrary one.
  const lastProducerByspecies = new Map<SpeciesId, string>();

  function resolveParent(individual: PlanIndividual): string {
    const producerId = lastProducerByspecies.get(individual.species);
    if (producerId) return producerId;
    const key = leafKey(individual.species, individual.gender);
    if (!nodes.has(key)) {
      leafOrder.push(key);
      nodes.set(key, {
        id: key,
        species: individual.species,
        gender: individual.gender,
        kind: 'leaf',
        isCatch: catchKeys.has(key),
        isTarget: targetSet.has(individual.species),
        isShared: false,
        passives: individual.passives && individual.passives.length > 0 ? individual.passives : undefined,
        column: 0,
        row: 0,
        x: 0,
        y: 0,
      });
    }
    return key;
  }

  steps.forEach((step, i) => {
    const producedId = `p${i}`;
    const fromA = resolveParent(step.parentA);
    const fromB = resolveParent(step.parentB);
    edges.push({ from: fromA, to: producedId, fromShared: false });
    edges.push({ from: fromB, to: producedId, fromShared: false });
    nodes.set(producedId, {
      id: producedId,
      species: step.child,
      gender: null,
      kind: 'produced',
      isCatch: false,
      isTarget: targetSet.has(step.child),
      isShared: false,
      stepIndex: i,
      column: 0,
      row: 0,
      x: 0,
      y: 0,
    });
    lastProducerByspecies.set(step.child, producedId);
  });

  // A target reached purely by catching (no breeding needed) never appears as a step
  // parent, so it wouldn't otherwise get a node — surface it as a leaf/target anyway.
  for (const c of catches) resolveParent(c);

  const outDegree = new Map<string, number>();
  for (const e of edges) outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);

  for (const node of nodes.values()) {
    if (node.kind === 'produced' && (outDegree.get(node.id) ?? 0) >= 2) node.isShared = true;
  }
  for (const e of edges) e.fromShared = nodes.get(e.from)?.isShared ?? false;

  // Column = longest-path depth from a leaf.
  function computeColumn(id: string, stack: Set<string> = new Set()): number {
    const node = nodes.get(id);
    if (!node) return 0;
    if (node.kind === 'leaf') return 0;
    if (stack.has(id)) return 0; // defensive: no cycles expected
    stack.add(id);
    const incoming = edges.filter((e) => e.to === id);
    const depth = incoming.length === 0 ? 0 : Math.max(...incoming.map((e) => computeColumn(e.from, stack)));
    stack.delete(id);
    return depth + 1;
  }

  let maxNonTargetColumn = 0;
  for (const node of nodes.values()) {
    node.column = computeColumn(node.id);
    if (!node.isTarget) maxNonTargetColumn = Math.max(maxNonTargetColumn, node.column);
  }
  const targetColumn = maxNonTargetColumn + 1;
  for (const node of nodes.values()) {
    if (node.isTarget) node.column = targetColumn;
  }

  const columnCount = targetColumn + 1;
  const rowsByColumn: string[][] = Array.from({ length: columnCount }, () => []);

  for (const key of leafOrder) rowsByColumn[0]!.push(key);

  const producedNonTarget = Array.from(nodes.values())
    .filter((n) => n.kind === 'produced' && !n.isTarget)
    .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
  for (const node of producedNonTarget) rowsByColumn[node.column]!.push(node.id);

  const targetOrder = new Map(targets.map((t, i) => [t, i]));
  const targetNodes = Array.from(nodes.values())
    .filter((n) => n.isTarget)
    .sort((a, b) => (targetOrder.get(a.species) ?? 0) - (targetOrder.get(b.species) ?? 0));
  for (const node of targetNodes) rowsByColumn[targetColumn]!.push(node.id);

  let maxRows = 0;
  rowsByColumn.forEach((col, columnIndex) => {
    maxRows = Math.max(maxRows, col.length);
    col.forEach((id, row) => {
      const node = nodes.get(id)!;
      node.row = row;
      node.x = LEFT_PAD + columnIndex * COLUMN_WIDTH;
      node.y = TOP_PAD + row * ROW_HEIGHT;
    });
  });

  const columns: PlanGraphColumn[] = rowsByColumn.map((col, index) => {
    if (index === 0) return { index, label: 'OWN / CATCH' };
    if (index === targetColumn) return { index, label: 'TARGETS' };
    const stepNumbers = col
      .map((id) => nodes.get(id)?.stepIndex)
      .filter((n): n is number => n !== undefined)
      .map((n) => n + 1);
    if (stepNumbers.length === 0) return { index, label: `STEP ${index}` };
    const min = Math.min(...stepNumbers);
    const max = Math.max(...stepNumbers);
    return { index, label: min === max ? `STEP ${romanish(min)}` : `STEP ${romanish(min)}–${romanish(max)}` };
  });

  return {
    nodes: Array.from(nodes.values()),
    nodeById: nodes,
    edges,
    columns,
    width: LEFT_PAD * 2 + columnCount * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH),
    height: TOP_PAD * 2 + Math.max(1, maxRows) * ROW_HEIGHT,
  };
}

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
function romanish(n: number): string {
  return CIRCLED[n - 1] ?? String(n);
}

export function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const d = Math.max(30, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + d},${y1} ${x2 - d},${y2} ${x2},${y2}`;
}

export const NODE_WIDTH_PX = NODE_WIDTH;
