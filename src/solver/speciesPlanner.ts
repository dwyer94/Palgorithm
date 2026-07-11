import type { BreedingRuleset } from '../ruleset/types';
import type {
  AnchorHint,
  ForcedCarrierResult,
  Gender,
  PassiveId,
  PassivePlanResult,
  PlanIndividual,
  RosterEntry,
  SpeciesId,
  SpeciesPlanResult,
  SpeciesPlannerOptions,
  SpeciesPlanStep,
} from './types';
import { MinHeap } from './minHeap';

/**
 * speciesPlanner (spec §7.1) — minimum-combination derivation over the species AND/OR
 * hypergraph, via Knuth's generalization of Dijkstra. Ruleset-agnostic: consumes only
 * `reverse()`, `rankTable`, `genderRatio()`, and `reachability` from `BreedingRuleset`
 * (CLAUDE.md invariant #1) — no CombiRank-specific math lives here.
 *
 * Nodes are (species, gender) pairs, not bare species, because a combination needs a
 * fielded male AND female (spec §7.1's gender-feasibility requirement): a species that's
 * only obtainable in one gender is a real dead end for combos needing the other, not a
 * cosmetic detail. Producing a species is gender-agnostic (hatch gender is random per
 * `genderRatio`), so both gender-nodes of a bred species share the same produce-cost —
 * only their *feasibility* (whether that gender's ratio is > 0) differs.
 *
 * Edges are the AND-hyperedges of the hypergraph: a combination (A,B)->child requires
 * BOTH an A-individual and a B-individual, so a hyperedge only fires once both its input
 * nodes are finalized. This is exactly the "distinct combinations, shared intermediates
 * counted once" objective (CLAUDE.md invariant #4): a node is finalized once, and every
 * later user of it reuses that same finalized cost.
 */

/** Species-cost options only — `desiredPassives` is handled separately in `planSpecies`
 * since it has no meaningful "required" default and doesn't participate in the core
 * species-cost solve. */
type CoreOptions = Required<Pick<SpeciesPlannerOptions, 'catchCost' | 'allowCatching'>> & {
  excludeFromCatching: Set<SpeciesId>;
};

type Node = string; // `${species}|${gender}`
const node = (species: SpeciesId, gender: Gender): Node => `${species}|${gender}`;

interface Edge {
  inputs: [Node, Node];
  output: Node;
  via: SpeciesPlanStep;
}

interface Graph {
  edges: Edge[];
  edgesByInput: Map<Node, number[]>; // node -> indices into edges[] where it's an input
}

/** Build the full combination hypergraph once: every (parentA,parentB)->child combo the
 * ruleset can produce, expanded into gender-assignment hyperedges. Cheap at this graph
 * size (spec §7.1: "evaluating forward() on candidate pairs is cheap"). */
function buildGraph(ruleset: BreedingRuleset): Graph {
  const edges: Edge[] = [];
  const edgesByInput = new Map<Node, number[]>();

  const addEdge = (a: Node, b: Node, output: Node, via: SpeciesPlanStep) => {
    edges.push({ inputs: [a, b], output, via });
    const idx = edges.length - 1;
    for (const n of [a, b]) {
      const list = edgesByInput.get(n) ?? [];
      list.push(idx);
      edgesByInput.set(n, list);
    }
  };

  for (const child of Object.keys(ruleset.rankTable)) {
    if (!ruleset.reachability.standardBreedable.has(child)) continue;
    const childRatio = ruleset.genderRatio(child);
    const childGenders: Gender[] = (['male', 'female'] as Gender[]).filter(
      (g) => childRatio[g] > 0,
    );
    if (childGenders.length === 0) continue;

    for (const { parentA: a, parentB: b } of ruleset.reverse(child)) {
      for (const childGender of childGenders) {
        if (a === b) {
          addEdge(node(a, 'male'), node(a, 'female'), node(child, childGender), {
            parentA: { species: a, gender: 'male' },
            parentB: { species: a, gender: 'female' },
            child,
          });
        } else {
          addEdge(node(a, 'male'), node(b, 'female'), node(child, childGender), {
            parentA: { species: a, gender: 'male' },
            parentB: { species: b, gender: 'female' },
            child,
          });
          addEdge(node(a, 'female'), node(b, 'male'), node(child, childGender), {
            parentA: { species: a, gender: 'female' },
            parentB: { species: b, gender: 'male' },
            child,
          });
        }
      }
    }
  }

  return { edges, edgesByInput };
}

/** `buildGraph` is a pure function of the ruleset alone (not the roster), and expensive at
 * real dataset scale (`reverse()` is an exhaustive O(n^2) scan per 0.2, called once per
 * species). `planSpecies` is called repeatedly against the same ruleset instance — most
 * heavily from `hubFinder`, which calls it once per candidate hub — so rebuilding the graph
 * every call turns a few-hundred-ms cost into minutes. Cache it per ruleset instance. */
const graphCache = new WeakMap<BreedingRuleset, Graph>();
function getGraph(ruleset: BreedingRuleset): Graph {
  let graph = graphCache.get(ruleset);
  if (!graph) {
    graph = buildGraph(ruleset);
    graphCache.set(ruleset, graph);
  }
  return graph;
}

/**
 * Forced-carrier search (spec §7.3's "guaranteed carrier" overlay, session 0.4c; generalized
 * to joint multi-passive routing in the two-mode §7.3 rewrite). Finds the cheapest derivation
 * of `target` that provably threads through the roster individuals carrying a set of desired
 * passives (1-4 of them), instead of `passivePlanner`'s original approach of throwing away the
 * rest of the roster and catching entirely to fake soundness — that over-restriction meant a
 * carrier could only ever reach species its own self-cross could produce, which for almost
 * every real species is nothing at all (`combirank-0.6`'s same-species shortcut always yields
 * the same species; the ~100 self-pair special combos in the shipped 1.0 dataset are all
 * fixed points too), making the old search return "not possible" essentially unconditionally.
 *
 * Every (species,gender) node is split into states keyed by a **bitmask** over the caller's
 * `requiredPassives` (one bit per passive, order = array order) instead of a single 0/1 taint
 * bit: a roster entry seeds the node for whichever mask its own passives happen to intersect
 * `requiredPassives` at (0 for ordinary fodder, a multi-bit mask for an individual that already
 * carries several of them), and a combo's output mask is the bitwise OR of its two inputs'
 * masks. This is what lets two *different* carriers, each holding a different desired passive,
 * combine into one lineage that carries both — the fix for the "AND not OR" bug: forcing two
 * desired passives used to mean running this search twice and getting two unrelated trees back;
 * now it's one search whose target mask is the union of both.
 *
 * A naive generalization of the old design — precompute every `(maskA, maskB) -> maskA|maskB`
 * doubled edge up front, the same shape as the old 4-combo `buildDoubledGraph` scaled from
 * `2x2` to `2^k x 2^k` combos per base edge — was measured against the real shipped dataset
 * during design and found to reach multi-second builds at k=3 and to OOM outright at k=4 (the
 * real passive-slot cap), before a single query even runs: not shippable. Instead, `solveMasked`
 * below runs the SAME finalized-input-count Dijkstra shape as the plain `solve()`, but lazily —
 * it reuses the already-cached plain `Graph` unmodified and only ever creates a `(node, mask)`
 * state when a relax genuinely reaches it, pairing a newly finalized state against whichever
 * masks the combo's other input has *already* finalized (tracked per plain node) rather than
 * against a precomputed combo table. Work scales with the masks actually reached, not the full
 * `4^k` cross product — empirically identical to the old single-bit search when only one
 * non-zero mask is ever reachable, which is the common case (one carrier, one or two passives).
 * Catch seeds are always mask 0 — catching can never manufacture a passive, the same soundness
 * property the old narrowing was (over-aggressively) protecting.
 */
type Taint = number; // bitmask over the caller's `requiredPassives`, one bit per entry
type TNode = string; // `${species}|${gender}|${mask}`
const tnode = (species: SpeciesId, gender: Gender, mask: Taint): TNode => `${species}|${gender}|${mask}`;
function parseTNode(n: TNode): { species: SpeciesId; gender: Gender; mask: number } {
  const [species, gender, mask] = n.split('|') as [SpeciesId, Gender, string];
  return { species, gender, mask: Number(mask) };
}

function popcount(mask: number): number {
  let c = 0;
  for (let m = mask; m !== 0; m >>= 1) c += m & 1;
  return c;
}

/** Bitmask of which `requiredPassives` this roster entry carries — 0 for ordinary fodder. */
function passiveMask(entry: RosterEntry, requiredPassives: PassiveId[]): number {
  let m = 0;
  for (let i = 0; i < requiredPassives.length; i++) {
    if (entry.passives?.includes(requiredPassives[i]!)) m |= 1 << i;
  }
  return m;
}

/** Inverse of `passiveMask`: which `requiredPassives` a mask represents, in array order. */
function decodeMask(mask: number, requiredPassives: PassiveId[]): PassiveId[] {
  const out: PassiveId[] = [];
  for (let i = 0; i < requiredPassives.length; i++) if (mask & (1 << i)) out.push(requiredPassives[i]!);
  return out;
}

type TNodeSource = { kind: 'owned' } | { kind: 'catch' } | { kind: 'combo'; edge: Edge; maskA: number; maskB: number };

function solveMasked(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  requiredPassives: PassiveId[],
  opts: CoreOptions,
): { dist: Map<TNode, number>; from: Map<TNode, TNodeSource>; leafEntryByTNode: Map<TNode, RosterEntry> } {
  const graph = getGraph(ruleset); // the plain, unmodified base graph — no doubling
  const dist = new Map<TNode, number>();
  const from = new Map<TNode, TNodeSource>();
  const finalized = new Set<TNode>();
  // Which masks have been finalized so far at each PLAIN node — this replaces the old static
  // doubled-edge table: a combo fires by pairing a freshly finalized (node,mask) against every
  // mask the edge's OTHER input has already finalized, not against a precomputed combo list.
  const masksSoFar = new Map<Node, Set<number>>();
  const leafEntryByTNode = new Map<TNode, RosterEntry>();

  const heap = new MinHeap<{ n: TNode; cost: number }>((x) => x.cost);
  const relax = (n: TNode, cost: number, source: TNodeSource) => {
    if (cost >= (dist.get(n) ?? Infinity)) return;
    dist.set(n, cost);
    from.set(n, source);
    heap.push({ n, cost });
  };

  // Every roster entry seeds its own (species,gender,mask) at cost 0 — the mask itself is the
  // clean/tainted split, generalized; no separate carrier-vs-rest roster partition needed.
  for (const r of roster) {
    const mask = passiveMask(r, requiredPassives);
    const key = tnode(r.species, r.gender, mask);
    if (!leafEntryByTNode.has(key)) leafEntryByTNode.set(key, r);
    relax(key, 0, { kind: 'owned' });
  }

  if (opts.allowCatching) {
    for (const species of ruleset.reachability.wildCatchable) {
      if (opts.excludeFromCatching.has(species)) continue;
      const ratio = ruleset.genderRatio(species);
      for (const gender of ['male', 'female'] as Gender[]) {
        if (ratio[gender] > 0) relax(tnode(species, gender, 0), opts.catchCost, { kind: 'catch' });
      }
    }
  }

  while (!heap.isEmpty()) {
    const { n, cost } = heap.pop()!;
    if (finalized.has(n)) continue;
    if (cost > (dist.get(n) ?? Infinity)) continue;
    finalized.add(n);

    const { species, gender, mask } = parseTNode(n);
    const plainNode = node(species, gender);
    let seenMasks = masksSoFar.get(plainNode);
    if (!seenMasks) {
      seenMasks = new Set();
      masksSoFar.set(plainNode, seenMasks);
    }
    seenMasks.add(mask);

    for (const edgeIdx of graph.edgesByInput.get(plainNode) ?? []) {
      const edge = graph.edges[edgeIdx]!;
      const [inA, inB] = edge.inputs;
      const isA = inA === plainNode;
      const otherMasks = masksSoFar.get(isA ? inB : inA);
      if (!otherMasks) continue; // other side hasn't finalized any mask yet
      for (const otherMask of otherMasks) {
        const maskA = isA ? mask : otherMask;
        const maskB = isA ? otherMask : mask;
        const pA = parseNode(inA);
        const pB = parseNode(inB);
        const costA = dist.get(tnode(pA.species, pA.gender, maskA));
        const costB = dist.get(tnode(pB.species, pB.gender, maskB));
        if (costA === undefined || costB === undefined) continue;
        const po = parseNode(edge.output);
        relax(tnode(po.species, po.gender, maskA | maskB), costA + costB + 1, { kind: 'combo', edge, maskA, maskB });
      }
    }
  }

  return { dist, from, leafEntryByTNode };
}

/** Highest-popcount reachable mask at `target` (either gender), lowest-cost tiebreak — the
 * spec §7.3 "partial routing" behavior: if all `requiredPassives` can't be jointly routed,
 * report the largest subset that can. Deliberately excludes mask 0 (mirrors the old code only
 * ever checking the tainted node, never the clean one) so "feasible" keeps meaning "at least
 * one of the desired passives got routed," not "the plain baseline plan exists." */
function bestReachableMask(
  dist: Map<TNode, number>,
  target: SpeciesId,
  k: number,
): { mask: number; gender: Gender; cost: number } | null {
  const fullMask = (1 << k) - 1;
  let bestPopcount = 0;
  let bestCost = Infinity;
  let bestMask = -1;
  let bestGender: Gender = 'male';
  for (let mask = 1; mask <= fullMask; mask++) {
    const pc = popcount(mask);
    for (const gender of ['male', 'female'] as Gender[]) {
      const cost = dist.get(tnode(target, gender, mask)) ?? Infinity;
      if (!isFinite(cost)) continue;
      if (pc > bestPopcount || (pc === bestPopcount && cost < bestCost)) {
        bestPopcount = pc;
        bestCost = cost;
        bestMask = mask;
        bestGender = gender;
      }
    }
  }
  return bestMask === -1 ? null : { mask: bestMask, gender: bestGender, cost: bestCost };
}

/** Walks the masked derivation back from `target`, deduping combos the same way `reconstruct`
 * does, and stamps `.passives` onto exactly the `PlanIndividual`s that sit on the routed
 * lineage: a carrier's own leaf gets its real roster passives (so pollution is visible), every
 * produced node downstream gets the decoded subset of `requiredPassives` its mask represents
 * (clean-carrier-forward, same assumption `passivePlanner`'s odds math already made). This both
 * lets the existing graph-attribution rendering (`graphLayout.ts` reads `.passives` off leaf
 * `PlanIndividual`s already) show the carriers wherever they actually sit, and lets odds be
 * computed directly from `steps` by node identity instead of matching on species name. Also
 * returns `carrierLeaves` — the real owned individuals found on the lineage — since the caller
 * no longer pre-selects a fixed `carrierEntries` list to report back. */
function reconstructMasked(
  from: Map<TNode, TNodeSource>,
  leafEntryByTNode: Map<TNode, RosterEntry>,
  target: TNode,
  requiredPassives: PassiveId[],
): { steps: SpeciesPlanStep[]; catches: PlanIndividual[]; carrierLeaves: RosterEntry[] } {
  const steps: SpeciesPlanStep[] = [];
  const catches: PlanIndividual[] = [];
  const carrierLeaves = new Set<RosterEntry>();
  const visited = new Set<TNode>();
  const stepSeen = new Set<string>();

  const individualFor = (n: TNode, base: PlanIndividual): PlanIndividual => {
    const { mask } = parseTNode(n);
    if (mask === 0) return base;
    const source = from.get(n);
    const isLeaf = !source || source.kind === 'owned';
    if (isLeaf) {
      const entry = leafEntryByTNode.get(n);
      if (entry) carrierLeaves.add(entry);
      const passives = entry?.passives && entry.passives.length > 0 ? entry.passives : decodeMask(mask, requiredPassives);
      return { species: base.species, gender: base.gender, passives };
    }
    return { species: base.species, gender: base.gender, passives: decodeMask(mask, requiredPassives) };
  };

  function visit(n: TNode) {
    if (visited.has(n)) return;
    visited.add(n);
    const source = from.get(n);
    if (!source || source.kind === 'owned') return;
    if (source.kind === 'catch') {
      const { species, gender } = parseTNode(n);
      catches.push({ species, gender });
      return;
    }
    const { edge, maskA, maskB } = source;
    const [inA, inB] = edge.inputs;
    const pA = parseNode(inA);
    const pB = parseNode(inB);
    const tA = tnode(pA.species, pA.gender, maskA);
    const tB = tnode(pB.species, pB.gender, maskB);
    visit(tA);
    visit(tB);
    const key = comboKey(edge.via);
    if (!stepSeen.has(key)) {
      stepSeen.add(key);
      steps.push({
        parentA: individualFor(tA, edge.via.parentA),
        parentB: individualFor(tB, edge.via.parentB),
        child: edge.via.child,
      });
    }
  }

  visit(target);
  return { steps, catches, carrierLeaves: [...carrierLeaves] };
}

/** Cheapest derivation of `target` that provably threads through the roster individuals
 * carrying `requiredPassives` (1-4 of them; spec §7.3's "guaranteed carrier" overlay — see the
 * block comment above `solveMasked`). All k passives are routed jointly into ONE lineage when
 * a route exists; when the full set can't be jointly reached, the result carries whichever
 * largest subset can be (`routedPassives`/`fullyRouted`, spec's "partial routing"). `fullRoster`
 * supplies every seed — carriers and ordinary fodder alike, distinguished only by their
 * `passives` mask, not by a caller-supplied carrier list. */
export function findForcedCarrierRoute(
  ruleset: BreedingRuleset,
  fullRoster: RosterEntry[],
  requiredPassives: PassiveId[],
  target: SpeciesId,
  options: SpeciesPlannerOptions = {},
): ForcedCarrierResult {
  const opts = normalizeCoreOptions(options);
  const desired = [...new Set(requiredPassives)];
  const k = desired.length;
  if (k < 1 || k > 4) {
    throw new Error(`findForcedCarrierRoute: requiredPassives must have 1-4 entries, got ${k}`);
  }

  const { dist, from, leafEntryByTNode } = solveMasked(ruleset, fullRoster, desired, opts);
  const best = bestReachableMask(dist, target, k);
  if (!best) {
    return {
      target,
      feasible: false,
      combinationCount: Infinity,
      cost: Infinity,
      steps: [],
      catches: [],
      routedPassives: [],
      fullyRouted: false,
      carrierLeaves: [],
    };
  }

  const { steps, catches, carrierLeaves } = reconstructMasked(from, leafEntryByTNode, tnode(target, best.gender, best.mask), desired);
  return {
    target,
    feasible: true,
    combinationCount: steps.length,
    cost: steps.length + catches.length * opts.catchCost,
    steps,
    catches,
    routedPassives: decodeMask(best.mask, desired),
    fullyRouted: best.mask === (1 << k) - 1,
    carrierLeaves,
  };
}

type NodeSource = { kind: 'owned' } | { kind: 'catch' } | { kind: 'combo'; edge: Edge };

interface SolveState {
  dist: Map<Node, number>;
  from: Map<Node, NodeSource>;
}

/** Knuth–Dijkstra fixpoint over the hypergraph, seeded from roster/catch base cases. */
function solve(graph: Graph, roster: RosterEntry[], ruleset: BreedingRuleset, opts: CoreOptions): SolveState {
  const dist = new Map<Node, number>();
  const from: SolveState['from'] = new Map();
  const finalized = new Set<Node>();
  const finalizedInputCount = new Map<number, number>(); // edge index -> # finalized inputs

  // Simple array-backed priority queue; graph is small (spec: ~138 species) so linear
  // extract-min is plenty fast and keeps this readable.
  const queue: { n: Node; cost: number }[] = [];
  const relax = (n: Node, cost: number, source: NodeSource) => {
    if (cost >= (dist.get(n) ?? Infinity)) return;
    dist.set(n, cost);
    from.set(n, source);
    queue.push({ n, cost });
  };

  for (const r of roster) relax(node(r.species, r.gender), 0, { kind: 'owned' });

  if (opts.allowCatching) {
    for (const species of ruleset.reachability.wildCatchable) {
      if (opts.excludeFromCatching.has(species)) continue;
      const ratio = ruleset.genderRatio(species);
      for (const gender of ['male', 'female'] as Gender[]) {
        if (ratio[gender] > 0) relax(node(species, gender), opts.catchCost, { kind: 'catch' });
      }
    }
  }

  while (queue.length > 0) {
    // Extract min.
    let bestIdx = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.cost < queue[bestIdx]!.cost) bestIdx = i;
    const { n, cost } = queue.splice(bestIdx, 1)[0]!;
    if (finalized.has(n)) continue;
    if (cost > (dist.get(n) ?? Infinity)) continue; // stale entry
    finalized.add(n);

    for (const edgeIdx of graph.edgesByInput.get(n) ?? []) {
      const edge = graph.edges[edgeIdx]!;
      const count = (finalizedInputCount.get(edgeIdx) ?? 0) + 1;
      finalizedInputCount.set(edgeIdx, count);
      if (count < edge.inputs.length) continue; // still waiting on the other parent
      const total = edge.inputs.reduce((s, inp) => s + (dist.get(inp) ?? Infinity), 0) + 1;
      relax(edge.output, total, { kind: 'combo', edge });
    }
  }

  return { dist, from };
}

/** A "combination" is breeding species A with species B to get a child species — it does
 * NOT matter which one of the pair happened to supply which gender, or which gender the
 * child hatched as (CLAUDE.md invariant #4: re-rolling the same pair isn't a new combo).
 * Key on the unordered species pair + child so those cases collapse to one step. */
function comboKey(via: SpeciesPlanStep): string {
  const [a, b] = [via.parentA.species, via.parentB.species].sort();
  return `${a}|${b}->${via.child}`;
}

/** Walk the finalized derivation back from `n`, collecting distinct combos (deduped by
 * species-pair+child, so a shared intermediate reused by multiple downstream branches, or
 * needed in both genders for a self-species cross, is still one step) and catches, in
 * dependency order (parents before children). */
function reconstruct(state: SolveState, target: Node): { steps: SpeciesPlanStep[]; catches: PlanIndividual[] } {
  const steps: SpeciesPlanStep[] = [];
  const catches: PlanIndividual[] = [];
  const visited = new Set<Node>();
  const stepSeen = new Set<string>();

  function visit(n: Node) {
    if (visited.has(n)) return;
    visited.add(n);
    const source = state.from.get(n);
    if (!source || source.kind === 'owned') return;
    if (source.kind === 'catch') {
      const [species, gender] = n.split('|') as [SpeciesId, Gender];
      catches.push({ species, gender });
      return;
    }
    const { edge } = source;
    for (const input of edge.inputs) visit(input);
    const key = comboKey(edge.via);
    if (!stepSeen.has(key)) {
      stepSeen.add(key);
      steps.push(edge.via);
    }
  }

  visit(target);
  return { steps, catches };
}

function parseNode(n: Node): { species: SpeciesId; gender: Gender } {
  const [species, gender] = n.split('|') as [SpeciesId, Gender];
  return { species, gender };
}

function rosterByNode(roster: RosterEntry[]): Map<Node, RosterEntry[]> {
  const m = new Map<Node, RosterEntry[]>();
  for (const r of roster) {
    const n = node(r.species, r.gender);
    const list = m.get(n) ?? [];
    list.push(r);
    m.set(n, list);
  }
  return m;
}

/** Every edge that could serve as the FINAL combo producing `targetNode` at the minimum
 * cost — i.e. cost-tied final-parent candidates. A node's dist can be reached by more than
 * one equally-cheap combo, but Dijkstra's `from` pointer only remembers the first one
 * found; passive-aware selection needs to compare all of them. */
function tiedFinalEdges(graph: Graph, state: SolveState, targetNode: Node, minCost: number): Edge[] {
  return graph.edges.filter((edge) => {
    if (edge.output !== targetNode) return false;
    const total = edge.inputs.reduce((s, inp) => s + (state.dist.get(inp) ?? Infinity), 0) + 1;
    return total === minCost;
  });
}

/** A node's dist is 0 only when it's roster-owned (catches and combos always cost > 0), so
 * its passives are knowable; anything else (produced or caught) is a fresh individual with
 * no tracked passives — the clean-carrier assumption (spec §7.3, passives not tracked
 * through intermediates in this planner). Returns one candidate per distinct roster
 * individual at that node, or a single "clean" candidate if none. */
function passiveCandidates(n: Node, state: SolveState, byNode: Map<Node, RosterEntry[]>): PassiveId[][] {
  if ((state.dist.get(n) ?? Infinity) !== 0) return [[]];
  const entries = byNode.get(n) ?? [];
  return entries.length > 0 ? entries.map((e) => e.passives ?? []) : [[]];
}

/** Among cost-tied final-parent candidates, pick the pair (and specific roster
 * individuals, where a slot is roster-supplied) that maximizes passive-landing odds
 * (spec §7.3's final-cross-injection overlay). */
function pickBestFinalSelection(
  edges: Edge[],
  state: SolveState,
  byNode: Map<Node, RosterEntry[]>,
  ruleset: BreedingRuleset,
  desired: PassiveId[],
): { edge: Edge; parentA: PlanIndividual; parentB: PlanIndividual; odds: { exactSet: number; supersetContaining: number } } | null {
  let best: { edge: Edge; parentA: PlanIndividual; parentB: PlanIndividual; odds: { exactSet: number; supersetContaining: number } } | null = null;

  for (const edge of edges) {
    const [inA, inB] = edge.inputs;
    const candsA = passiveCandidates(inA, state, byNode);
    const candsB = passiveCandidates(inB, state, byNode);
    const { species: speciesA, gender: genderA } = parseNode(inA);
    const { species: speciesB, gender: genderB } = parseNode(inB);

    for (const passivesA of candsA) {
      for (const passivesB of candsB) {
        const odds = ruleset.passiveModel.landOdds(passivesA, passivesB, desired);
        if (
          !best ||
          odds.exactSet > best.odds.exactSet ||
          (odds.exactSet === best.odds.exactSet && odds.supersetContaining > best.odds.supersetContaining)
        ) {
          best = {
            edge,
            parentA: { species: speciesA, gender: genderA, passives: passivesA },
            parentB: { species: speciesB, gender: genderB, passives: passivesB },
            odds,
          };
        }
      }
    }
  }

  return best;
}

/** Try seeding a single extra species (both genders, cost 0) and see whether the target
 * becomes reachable — the sound way to answer "what anchor would unlock this" without
 * relying on an unsound rank-based prune (spec §7.1). Exhaustive over rank-bearing
 * species is cheap at this graph size. */
function findAnchorHints(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  opts: CoreOptions,
  alreadyReachable: Set<SpeciesId>,
): AnchorHint[] {
  const targetRank = ruleset.rankTable[target] ?? null;
  // Owning the target directly isn't a derivation hint — exclude it so an unreachable
  // target doesn't trivially "unlock itself".
  const candidates = Object.keys(ruleset.rankTable).filter((s) => s !== target && !alreadyReachable.has(s));
  const hints: AnchorHint[] = [];
  const graph = getGraph(ruleset);

  for (const species of candidates) {
    const hypotheticalRoster: RosterEntry[] = [
      ...roster,
      { species, gender: 'male' },
      { species, gender: 'female' },
    ];
    const state = solve(graph, hypotheticalRoster, ruleset, opts);
    const male = state.dist.get(node(target, 'male')) ?? Infinity;
    const female = state.dist.get(node(target, 'female')) ?? Infinity;
    const resultingCost = Math.min(male, female);
    if (isFinite(resultingCost)) {
      const ratio = ruleset.genderRatio(species);
      const gender: Gender = ratio.male >= ratio.female ? 'male' : 'female';
      hints.push({ species, rank: ruleset.rankTable[species] ?? null, gender, resultingCost });
    }
  }

  hints.sort((a, b) => {
    if (targetRank !== null && a.rank !== null && b.rank !== null) {
      const da = Math.abs(a.rank - targetRank);
      const db = Math.abs(b.rank - targetRank);
      if (da !== db) return da - db;
    }
    return a.resultingCost - b.resultingCost;
  });

  return hints.slice(0, 5);
}

/** Normalize the public option bag into the core cost knobs `solve` consumes. Split out so
 * batch callers (`hubFinder`) can build a `SolveContext` once and reuse it across many
 * candidates/targets that share the same roster+opts. */
export function normalizeCoreOptions(options: SpeciesPlannerOptions = {}): CoreOptions {
  return {
    catchCost: options.catchCost ?? 1,
    allowCatching: options.allowCatching ?? false,
    excludeFromCatching: new Set(options.excludeFromCatching ?? []),
  };
}

/** A solved roster: the shared graph, the Dijkstra fixpoint over it, and the core opts it
 * was solved with. `hubFinder` solves one of these per distinct (roster, coreOpts) pair and
 * reads off many targets/candidates from it, instead of re-running `solve` — which dominates
 * cost at real dataset scale — once per candidate. */
export interface SolveContext {
  graph: Graph;
  state: SolveState;
  opts: CoreOptions;
}

/** Solve a roster once, ready to answer any number of target queries via `resultFromContext`. */
export function solveContext(ruleset: BreedingRuleset, roster: RosterEntry[], options: SpeciesPlannerOptions = {}): SolveContext {
  const opts = normalizeCoreOptions(options);
  const graph = getGraph(ruleset);
  return { graph, state: solve(graph, roster, ruleset, opts), opts };
}

/**
 * Turn a solved context into a full plan for one `target`. This is everything `planSpecies`
 * does after the solve. `withAnchorHints` gates the one genuinely expensive extra step —
 * the anchor-hint search (itself a full solve per rank-bearing species, spec §7.1). Direct
 * `planSpecies` callers want hints on an unreachable target; the `hubFinder` sweep only
 * checks feasibility and combination-count over thousands of (candidate, target) probes and
 * throws any hints away, so it passes `withAnchorHints: false` — skipping what used to be
 * the sweep's dominant cost.
 */
export function resultFromContext(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  ctx: SolveContext,
  options: SpeciesPlannerOptions,
  withAnchorHints: boolean,
): SpeciesPlanResult {
  const { graph, state, opts } = ctx;

  const maleCost = state.dist.get(node(target, 'male')) ?? Infinity;
  const femaleCost = state.dist.get(node(target, 'female')) ?? Infinity;
  const cost = Math.min(maleCost, femaleCost);

  if (!isFinite(cost)) {
    let anchorHints: AnchorHint[] = [];
    if (withAnchorHints) {
      const alreadyReachable = new Set(
        Object.keys(ruleset.rankTable).filter((s) => {
          const c = Math.min(state.dist.get(node(s, 'male')) ?? Infinity, state.dist.get(node(s, 'female')) ?? Infinity);
          return isFinite(c);
        }),
      );
      for (const r of roster) alreadyReachable.add(r.species);
      anchorHints = findAnchorHints(ruleset, roster, target, opts, alreadyReachable);
    }
    return {
      target,
      feasible: false,
      combinationCount: Infinity,
      cost: Infinity,
      steps: [],
      catches: [],
      anchorHints,
    };
  }

  let winningGender: Gender = maleCost <= femaleCost ? 'male' : 'female';
  let targetNode = node(target, winningGender);
  let effectiveCost = cost;

  // Owning the species at cost 0 only satisfies `desiredPassives` if some owned individual
  // actually carries them — otherwise "already in your pools" is a false negative: the user
  // owns e.g. a clean catch and wants a bred one with specific perks. Fall through to the
  // cheapest real combo producing this species (often a same-species self-cross, spec §3.2's
  // shortcut, itself a valid graph edge) instead of the free owned node, so the final-cross
  // selection below has an actual combination to inject perks into.
  const desired = options.desiredPassives ?? [];
  const ownedSatisfiesDesired =
    desired.length > 0 && roster.some((r) => r.species === target && desired.every((p) => (r.passives ?? []).includes(p)));
  if (desired.length > 0 && cost === 0 && !ownedSatisfiesDesired) {
    const comboCostFor = (gender: Gender): number => {
      let best = Infinity;
      const n = node(target, gender);
      for (const e of graph.edges) {
        if (e.output !== n) continue;
        const total = e.inputs.reduce((s, inp) => s + (state.dist.get(inp) ?? Infinity), 0) + 1;
        if (total < best) best = total;
      }
      return best;
    };
    const maleCombo = comboCostFor('male');
    const femaleCombo = comboCostFor('female');
    const comboCost = Math.min(maleCombo, femaleCombo);
    // If no combo can produce this species at all (e.g. capture-only, no rank), there's
    // nothing to fall through to — keep reporting the owned-at-cost-0 result.
    if (isFinite(comboCost)) {
      effectiveCost = comboCost;
      winningGender = maleCombo <= femaleCombo ? 'male' : 'female';
      targetNode = node(target, winningGender);
    }
  }

  // Passive-aware final-cross selection (spec §7.3): among cost-tied final-parent
  // candidates, prefer whichever pair maximizes passive-landing odds for `desiredPassives`,
  // using actual roster passives where a slot is roster-supplied. This only re-picks WHICH
  // tied edge produces the target — it never changes `cost`/`combinationCount`, since every
  // candidate here already achieves the minimum species cost (or, in the owned-but-mismatched
  // case above, the minimum genuine combo cost).
  let finalSelection: ReturnType<typeof pickBestFinalSelection> = null;
  // The context's `state.from` is shared across every query answered from this context, so
  // the final-cross re-pick below (the only mutation) is saved and restored — otherwise
  // re-pointing a shared intermediate's finalized edge would corrupt a later target's
  // reconstruction. Standalone `planSpecies` discards its context, so the restore is a no-op
  // there.
  let restoreFrom: (() => void) | null = null;
  if (desired.length > 0 && effectiveCost > 0) {
    const candidates = tiedFinalEdges(graph, state, targetNode, effectiveCost);
    finalSelection = pickBestFinalSelection(candidates, state, rosterByNode(roster), ruleset, desired);
    if (finalSelection) {
      const prev = state.from.get(targetNode);
      state.from.set(targetNode, { kind: 'combo', edge: finalSelection.edge });
      restoreFrom = () => (prev ? state.from.set(targetNode, prev) : state.from.delete(targetNode));
    }
  }

  const { steps, catches } = reconstruct(state, targetNode);
  restoreFrom?.();

  let passivePlan: PassivePlanResult | undefined;
  if (finalSelection && steps.length > 0) {
    const desiredSet = new Set(desired);
    const { odds, parentA, parentB } = finalSelection;
    const suppliedByFinalCross = new Set([...(parentA.passives ?? []), ...(parentB.passives ?? [])]);
    passivePlan = {
      desired,
      landOdds: odds,
      expectedEggs: {
        exactSet: odds.exactSet > 0 ? 1 / odds.exactSet : Infinity,
        supersetContaining: odds.supersetContaining > 0 ? 1 / odds.supersetContaining : Infinity,
      },
      finalParentA: parentA,
      finalParentB: parentB,
      pollution: {
        parentA: (parentA.passives ?? []).filter((p) => !desiredSet.has(p)),
        parentB: (parentB.passives ?? []).filter((p) => !desiredSet.has(p)),
      },
      unassigned: desired.filter((p) => !suppliedByFinalCross.has(p)),
    };
  }

  // Report cost from the deduped plan, not the raw Dijkstra distance: `dist` sums the
  // additive derivation and double-counts a shared intermediate reused by two branches
  // (the exactness caveat, spec §7.1) — `steps`/`catches` are already deduped, so their
  // count is the true distinct-combination cost (CLAUDE.md invariant #4).
  return {
    target,
    feasible: true,
    combinationCount: steps.length,
    cost: steps.length + catches.length * opts.catchCost,
    steps,
    catches,
    ...(passivePlan ? { passivePlan } : {}),
  };
}

/** Minimum-combination plan to reach `target` from `roster` (spec §7.1). Solves the roster
 * once and builds the result, including anchor-hint guidance when the target is unreachable.
 * Batch callers that probe many targets against the same roster should instead build a
 * `SolveContext` with `solveContext` and call `resultFromContext` per target. */
export function planSpecies(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  options: SpeciesPlannerOptions = {},
): SpeciesPlanResult {
  const ctx = solveContext(ruleset, roster, options);
  return resultFromContext(ruleset, roster, target, ctx, options, true);
}
