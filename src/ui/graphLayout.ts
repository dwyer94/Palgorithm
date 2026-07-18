import type { Gender, SpeciesId } from '../data/schema';
import type { PassivePlanResult, PlanIndividual, SpeciesPlanStep } from '../solver/types';

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
  /** True only for a standalone terminal marker in the TARGETS column (a target satisfied by
   * an owned/caught leaf, or one whose producing step is shared with another consumer). A
   * target whose producing step has no other consumer skips the marker entirely — see the
   * merge logic in the target loop below — so most single-step plans never populate this. */
  isTargetMarker?: boolean;
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
const TOP_PAD = 26;
const LEFT_PAD = 8;

// A node with no wrapped passive chips renders at this height (icon+name row + one
// sub-label row) — matches the old fixed ROW_HEIGHT minus the gap between rows.
const NODE_BASE_HEIGHT = 48;
const ROW_GAP = 18;
// Passive chips are real gameplay data (player-chosen loadouts, live-server display names),
// so their label text length is unbounded — a fixed row height silently lets a wrapped chip
// bleed into the node below it in the same column. The constants below are calibrated against
// the chips' actual rendered pixel widths (measured live: "Artisan" → 55.8px, "Siren of the
// Void" → 109.8px), then padded up, since a long label doesn't just wrap onto a new line —
// once it's wider than the row itself it wraps *its own text*, eating two-plus lines by
// itself, and under-reserving for that is exactly what let a chip bleed into the node below.
const CHIP_INNER_WIDTH = 110; // the chip row's real available width, measured live at 115px
const CHIP_CHAR_WIDTH = 5.5; // px/char, calibrated from real chip widths (~4.9) plus margin
const CHIP_PADDING = 24; // chip padding/border, calibrated from real chip widths plus margin
const CHIP_LINE_HEIGHT = 22; // measured gap between stacked single-line chips is ~24px
// Owned-leaf chips share their row with "owned · <player name> ·" text whose length isn't
// known at layout time (provenance is resolved later, from live data). Measured live, even a
// short name already leaves no room for a chip beside it — so leaf chips are modeled as always
// starting on their own fresh line rather than trying to predict where the prefix text ends.

function leafKey(species: SpeciesId, gender: Gender | null): string {
  return `leaf:${species}:${gender ?? 'either'}`;
}

function chipPixelWidth(label: string): number {
  return Math.ceil(label.length * CHIP_CHAR_WIDTH) + CHIP_PADDING;
}

/** Estimates how many lines a chip row takes: each chip starts its own line (flex-wrap has no
 * room to pack two of these short-container, often-long labels side by side in practice — see
 * the calibration note above), and a chip wider than the row wraps its own text across
 * `ceil(width / CHIP_INNER_WIDTH)` lines instead of just one. */
function estimateChipLines(labels: string[], reservePrefixLine: boolean): number {
  if (labels.length === 0) return 0;
  let lines = reservePrefixLine ? 1 : 0;
  for (const label of labels) {
    lines += Math.max(1, Math.ceil(chipPixelWidth(label) / CHIP_INNER_WIDTH));
  }
  return lines;
}

function estimateNodeHeight(node: PlanGraphNode, desiredPassives: string[] | undefined, passiveLabel: (id: string) => string): number {
  // Mirrors the two chip-rendering branches in PlanView's nodeSubLabel/PalNode: a target
  // with desired perks gets a dedicated chip-only row (nodeVariant "target" in PlanView.tsx),
  // while an owned leaf's own passives share their row with "owned · name ·" text.
  if (node.isTarget && desiredPassives && desiredPassives.length > 0) {
    const lines = estimateChipLines(desiredPassives.map(passiveLabel), false);
    return NODE_BASE_HEIGHT + Math.max(0, lines - 1) * CHIP_LINE_HEIGHT;
  }
  if (node.kind === 'leaf' && node.passives && node.passives.length > 0) {
    const lines = estimateChipLines(node.passives.map(passiveLabel), true);
    return NODE_BASE_HEIGHT + Math.max(0, lines - 1) * CHIP_LINE_HEIGHT;
  }
  return NODE_BASE_HEIGHT;
}

export function buildPlanGraph(
  steps: SpeciesPlanStep[],
  catches: PlanIndividual[],
  targets: SpeciesId[],
  passivePlan?: PassivePlanResult,
  desiredPassives?: string[],
  passiveLabel: (id: string) => string = (id) => id,
): PlanGraphLayout {
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
        isTarget: false,
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
      isTarget: false,
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

  // `SpeciesPlanStep.parentA/B` never carry `.passives` (buildGraph's edge templates don't
  // track them — see speciesPlanner.ts's clean-carrier assumption), so every leaf node above
  // was created with `passives: undefined` regardless of what the roster individual actually
  // holds. The one place real final-cross passives exist is `passivePlan.finalParentA/B` —
  // overlay them onto the matching leaf node so the graph can render/attribute them. Skips
  // silently if the final parent resolved to a produced node instead of a leaf (only possible
  // when that species was also produced earlier in the chain — rare, and there's no
  // meaningful "source" node to attribute onto in that case).
  if (passivePlan) {
    for (const parent of [passivePlan.finalParentA, passivePlan.finalParentB]) {
      if (!parent.passives || parent.passives.length === 0) continue;
      const node = nodes.get(leafKey(parent.species, parent.gender));
      if (node && node.kind === 'leaf') node.passives = parent.passives;
    }
  }

  const outDegree = new Map<string, number>();
  for (const e of edges) outDegree.set(e.from, (outDegree.get(e.from) ?? 0) + 1);

  for (const node of nodes.values()) {
    if (node.kind === 'produced' && (outDegree.get(node.id) ?? 0) >= 2) node.isShared = true;
  }
  for (const e of edges) e.fromShared = nodes.get(e.from)?.isShared ?? false;

  // Column = longest-path depth from a leaf. Every structural node — leaf or bred
  // intermediate — gets its column purely from dependency depth; target-ness never pulls a
  // node out of its breeding position. It used to: a node that was simultaneously a target
  // species AND still consumed as a parent elsewhere (a "self-carrier" cross — e.g. breeding
  // an owned Pal of the target's own species into a better copy of itself) got forced into
  // the rightmost column, which produced backwards-pointing edges. It also swallowed
  // whichever step actually bred the result into a column unconditionally labeled "TARGETS",
  // with no "STEP N" of its own ever appearing (2026-07-18 bug report).
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

  let maxStructuralColumn = 0;
  for (const node of nodes.values()) {
    node.column = computeColumn(node.id);
    maxStructuralColumn = Math.max(maxStructuralColumn, node.column);
  }

  // A target whose content is a bred result consumed nowhere else (the common single-step,
  // single-target case) gets its `isTarget`/desired-passive-chip styling applied directly to
  // the step that produced it, instead of a second lookalike box wired in by an edge — the
  // two used to be visually indistinguishable (2026-07-19 bug report: "no difference between
  // step 1 and final"). A standalone TARGETS marker is still needed when the source is a leaf
  // (owned/caught outright — OWN/CATCH and TARGETS genuinely differ there) or when the
  // producing step is shared with another consumer (that node can't wear two identities: its
  // own breeding-material role and the goal itself).
  const targetColumn = maxStructuralColumn + 1;
  let usedTargetColumn = false;
  for (const t of targets) {
    const sourceId = lastProducerByspecies.get(t) ?? Array.from(nodes.values()).find((n) => n.kind === 'leaf' && n.species === t)?.id;
    const source = sourceId ? nodes.get(sourceId) : undefined;
    const canMerge = source?.kind === 'produced' && (outDegree.get(sourceId!) ?? 0) === 0;
    if (canMerge && source) {
      source.isTarget = true;
      continue;
    }
    usedTargetColumn = true;
    nodes.set(`target:${t}`, {
      id: `target:${t}`,
      species: t,
      gender: null,
      kind: source ? 'produced' : 'leaf',
      isCatch: false,
      isTarget: true,
      isShared: false,
      isTargetMarker: true,
      stepIndex: source?.kind === 'produced' ? source.stepIndex : undefined,
      column: targetColumn,
      row: 0,
      x: 0,
      y: 0,
    });
    if (sourceId) edges.push({ from: sourceId, to: `target:${t}`, fromShared: source?.isShared ?? false });
  }

  const columnCount = (usedTargetColumn ? targetColumn : maxStructuralColumn) + 1;
  const rowsByColumn: string[][] = Array.from({ length: columnCount }, () => []);

  for (const key of leafOrder) rowsByColumn[0]!.push(key);

  // A merged target (isTarget but not isTargetMarker) is still a real breeding step, so it
  // takes its place among the other produced nodes in its own natural column rather than the
  // TARGETS column — only a standalone marker belongs there.
  const producedNonMarker = Array.from(nodes.values())
    .filter((n) => n.kind === 'produced' && !n.isTargetMarker)
    .sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
  for (const node of producedNonMarker) rowsByColumn[node.column]!.push(node.id);

  const targetOrder = new Map(targets.map((t, i) => [t, i]));
  const targetMarkerNodes = Array.from(nodes.values())
    .filter((n) => n.isTargetMarker)
    .sort((a, b) => (targetOrder.get(a.species) ?? 0) - (targetOrder.get(b.species) ?? 0));
  for (const node of targetMarkerNodes) rowsByColumn[targetColumn]!.push(node.id);

  // Rows within a column stack by their *actual* estimated height rather than a uniform
  // slot, so a node with wrapped passive chips pushes the next node down instead of
  // overlapping it.
  let maxColumnBottom = 0;
  rowsByColumn.forEach((col, columnIndex) => {
    let y = TOP_PAD;
    col.forEach((id, row) => {
      const node = nodes.get(id)!;
      node.row = row;
      node.x = LEFT_PAD + columnIndex * COLUMN_WIDTH;
      node.y = y;
      y += estimateNodeHeight(node, desiredPassives, passiveLabel) + ROW_GAP;
    });
    maxColumnBottom = Math.max(maxColumnBottom, y);
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
    return { index, label: min === max ? `STEP ${min}` : `STEP ${min}–${max}` };
  });

  return {
    nodes: Array.from(nodes.values()),
    nodeById: nodes,
    edges,
    columns,
    width: LEFT_PAD * 2 + columnCount * COLUMN_WIDTH - (COLUMN_WIDTH - NODE_WIDTH),
    height: TOP_PAD + Math.max(NODE_BASE_HEIGHT + ROW_GAP, maxColumnBottom),
  };
}

/** `bow` bends both control points by the same vertical amount — used to fan apart two
 * edges that would otherwise sit exactly on top of each other (e.g. a same-species pair
 * bred with itself has parentA and parentB resolve to the identical leaf node, so both
 * edges into the child share the same endpoints). */
export function edgePath(x1: number, y1: number, x2: number, y2: number, bow = 0): string {
  const d = Math.max(30, (x2 - x1) / 2);
  return `M${x1},${y1} C${x1 + d},${y1 + bow} ${x2 - d},${y2 + bow} ${x2},${y2}`;
}

export const NODE_WIDTH_PX = NODE_WIDTH;
