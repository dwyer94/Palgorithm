import type { BreedingRuleset } from '../ruleset/types';
import type {
  AnchorHint,
  BaselinePassiveNote,
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
 *
 * `ignoreGender` (a per-call option, see `buildGraph`'s doc comment) widens which gender
 * pairings a CROSS-species combo accepts, modeling Palworld's gender-changing item without
 * touching node cost/reachability at all — see `buildGraph` for why self-cross combos are
 * deliberately excluded from the widening.
 */

/** Species-cost options only — `desiredPassives` is handled separately in `planSpecies`
 * since it has no meaningful "required" default and doesn't participate in the core
 * species-cost solve. */
type CoreOptions = Required<Pick<SpeciesPlannerOptions, 'catchCost' | 'allowCatching' | 'ignoreGender'>> & {
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

/** The cost of finalizing a combo's output node once both its inputs are finalized: the sum
 * of however each input was itself reached, plus one for the combo itself. Graph bookkeeping,
 * not breeding math (CLAUDE.md invariant #1 governs `BreedingRuleset`-owned rules, not this),
 * but still centralized per the post-Phase-5 code review — this exact formula was
 * independently duplicated across `solveMasked`, `solve`, `tiedFinalEdges`, `anchorProbeCost`,
 * and `injectProbe`; a future ruleset making combo cost non-constant would otherwise have to
 * find and update all five consistently. */
function combinationCost(costA: number, costB: number): number {
  return costA + costB + 1;
}

/** Build the full combination hypergraph once: every (parentA,parentB)->child combo the
 * ruleset can produce, expanded into gender-assignment hyperedges. Cheap at this graph
 * size (spec §7.1: "evaluating forward() on candidate pairs is cheap").
 *
 * `ignoreGender` (Palworld's gender-changing item lets you flip any individual's gender
 * before breeding it) widens every CROSS-species combo (parentA's species !== parentB's) to
 * also fire on the two SAME-gender pairings, alongside the two opposite-gender pairings that
 * already covered every "you happen to have opposite genders" case. This is what actually
 * unblocks: "I own two different species and both happen to be male" — genuinely
 * unbreedable without a flip today, trivially fixed by flipping either one. Deliberately
 * does NOT touch same-species (self-cross) combos: those still require an actual male AND
 * an actual female of that one species, same as always. A self-cross's two parent slots are
 * the SAME node type, so "widening" it the same way would let a single owned/caught
 * individual satisfy both slots by flipping itself into two — i.e. breeding a Pal with
 * itself, which no gender-changing item makes possible; you still need two distinct Pals.
 * Cross-species combos have no such risk (the two slots are always two different species,
 * hence provably two different individuals), so widening only cross-species keeps every
 * dist value gender-accurate and multiplicity-safe with zero extra bookkeeping. */
function buildGraph(ruleset: BreedingRuleset, ignoreGender: boolean): Graph {
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

  // Special-combo children (e.g. Frostallion Noct from Frostallion x Helzephyr) are
  // deliberately `standardBreedable: false` in the dataset — the formula can't produce them,
  // only their exact override pair can (combirank.ts's `specialChildIds`). Gating this loop on
  // `standardBreedable` alone would silently drop every special-combo-only species from the
  // graph, regardless of what `reverse()` says, making them unreachable no matter the roster.
  const specialChildIds = new Set<string>();
  for (const c of ruleset.specialCombos) {
    specialChildIds.add(c.child);
    if (c.genderRule) specialChildIds.add(c.genderRule.child);
  }

  for (const child of Object.keys(ruleset.rankTable)) {
    if (!ruleset.reachability.standardBreedable.has(child) && !specialChildIds.has(child)) continue;
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
          if (ignoreGender) {
            addEdge(node(a, 'male'), node(b, 'male'), node(child, childGender), {
              parentA: { species: a, gender: 'male' },
              parentB: { species: b, gender: 'male' },
              child,
            });
            addEdge(node(a, 'female'), node(b, 'female'), node(child, childGender), {
              parentA: { species: a, gender: 'female' },
              parentB: { species: b, gender: 'female' },
              child,
            });
          }
        }
      }
    }
  }

  return { edges, edgesByInput };
}

/** `buildGraph` is a pure function of the ruleset and the `ignoreGender` toggle, and
 * expensive at real dataset scale (`reverse()` is an exhaustive O(n^2) scan per 0.2, called
 * once per species). `planSpecies` is called repeatedly against the same ruleset instance —
 * most heavily from `hubFinder`, which calls it once per candidate hub — so rebuilding the
 * graph every call turns a few-hundred-ms cost into minutes. Cache it per (ruleset,
 * ignoreGender) pair — the two toggle states are genuinely different graphs (widened vs not),
 * not just different solves over the same one. */
const graphCache = new WeakMap<BreedingRuleset, Map<boolean, Graph>>();
function getGraph(ruleset: BreedingRuleset, ignoreGender: boolean): Graph {
  let byToggle = graphCache.get(ruleset);
  if (!byToggle) {
    byToggle = new Map();
    graphCache.set(ruleset, byToggle);
  }
  let graph = byToggle.get(ignoreGender);
  if (!graph) {
    graph = buildGraph(ruleset, ignoreGender);
    byToggle.set(ignoreGender, graph);
  }
  return graph;
}

/** Eagerly build (and cache) the combination hypergraph for `ruleset` so the first plan doesn't
 * pay the O(n² per species) `reverse()` build synchronously on a user click — at real dataset
 * scale that build is a multi-hundred-ms main-thread freeze. Safe to call repeatedly (it's just a
 * cache warm). Call from app init off the critical path (e.g. `requestIdleCallback`). */
export function warmGraphCache(ruleset: BreedingRuleset, ignoreGender = false): void {
  getGraph(ruleset, ignoreGender);
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
  const graph = getGraph(ruleset, opts.ignoreGender); // ignoreGender widens cross-species edges; see buildGraph
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
        relax(tnode(po.species, po.gender, maskA | maskB), combinationCost(costA, costB), { kind: 'combo', edge, maskA, maskB });
      }
    }
  }

  return { dist, from, leafEntryByTNode };
}

/** Highest-popcount reachable mask at `target` (either gender), lowest-cost tiebreak — the
 * spec §7.3 "partial routing" behavior: if all `requiredPassives` can't be jointly routed,
 * report the largest subset that can. Deliberately excludes mask 0 (mirrors the old code only
 * ever checking the tainted node, never the clean one) so "feasible" keeps meaning "at least
 * one of the desired passives got routed," not "the plain baseline plan exists."
 *
 * `excludeDirectOwnership` (the "next-best-when-owned" mode, see `planSpeciesForAnotherCopy`'s
 * doc comment for the full rationale) skips any `(mask, gender)` candidate whose `from` source
 * is a bare roster individual (`kind: 'owned'`) — i.e. some single owned Pal already carries
 * exactly that mask's passives on the target species itself, which "already own it" isn't a
 * real *new* route. This can only ever exclude a genuine single-individual exact match (a combo
 * output is never cost-tagged `'owned'`, and a mask can only be seeded `'owned'` by one specific
 * roster entry's own passives — see `passiveMask`), so it never discards a real bred/caught
 * route, only a trivial "you're already holding one" shortcut. */
function bestReachableMask(
  dist: Map<TNode, number>,
  from: Map<TNode, TNodeSource>,
  target: SpeciesId,
  k: number,
  excludeDirectOwnership: boolean,
): { mask: number; gender: Gender; cost: number } | null {
  const fullMask = (1 << k) - 1;
  let bestPopcount = 0;
  let bestCost = Infinity;
  let bestMask = -1;
  let bestGender: Gender = 'male';
  for (let mask = 1; mask <= fullMask; mask++) {
    const pc = popcount(mask);
    for (const gender of ['male', 'female'] as Gender[]) {
      const tn = tnode(target, gender, mask);
      if (excludeDirectOwnership && from.get(tn)?.kind === 'owned') continue;
      const cost = dist.get(tn) ?? Infinity;
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
 * `passives` mask, not by a caller-supplied carrier list.
 *
 * `excludeDirectOwnership` (default false) is the "next-best-when-owned" mode: skip any
 * candidate mask that's satisfied by a single already-owned target-species individual (see
 * `bestReachableMask`'s doc comment). It never removes anything from `fullRoster` — an owned
 * target-species individual is still fully eligible as a bred PARENT (e.g. a self-cross), just
 * not as a free "you already hold the finished answer" shortcut. */
export function findForcedCarrierRoute(
  ruleset: BreedingRuleset,
  fullRoster: RosterEntry[],
  requiredPassives: PassiveId[],
  target: SpeciesId,
  options: SpeciesPlannerOptions = {},
  excludeDirectOwnership = false,
): ForcedCarrierResult {
  const opts = normalizeCoreOptions(options);
  const desired = [...new Set(requiredPassives)];
  const k = desired.length;
  if (k < 1 || k > 4) {
    throw new Error(`findForcedCarrierRoute: requiredPassives must have 1-4 entries, got ${k}`);
  }

  const { dist, from, leafEntryByTNode } = solveMasked(ruleset, fullRoster, desired, opts);
  const best = bestReachableMask(dist, from, target, k, excludeDirectOwnership);
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
      const [inA, inB] = edge.inputs;
      const total = combinationCost(dist.get(inA) ?? Infinity, dist.get(inB) ?? Infinity);
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
    const [inA, inB] = edge.inputs;
    const total = combinationCost(state.dist.get(inA) ?? Infinity, state.dist.get(inB) ?? Infinity);
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

/** Shortest number of breeding generations from a leaf species to `target` along `steps`
 * (each step is one generation: parent species -> child species). BFS over the species-level
 * production graph the plan's steps induce; returns `Infinity` if no path (shouldn't happen for
 * a species that's genuinely a parent in the tree, but guarded so a malformed tree can't hang). */
function generationsToTarget(steps: SpeciesPlanStep[], from: SpeciesId, target: SpeciesId): number {
  if (from === target) return 0;
  const adj = new Map<SpeciesId, SpeciesId[]>();
  for (const s of steps) {
    for (const parent of [s.parentA.species, s.parentB.species]) {
      const list = adj.get(parent) ?? [];
      list.push(s.child);
      adj.set(parent, list);
    }
  }
  const queue: { species: SpeciesId; depth: number }[] = [{ species: from, depth: 0 }];
  const seen = new Set<SpeciesId>([from]);
  while (queue.length > 0) {
    const { species, depth } = queue.shift()!;
    for (const child of adj.get(species) ?? []) {
      if (child === target) return depth + 1;
      if (!seen.has(child)) {
        seen.add(child);
        queue.push({ species: child, depth: depth + 1 });
      }
    }
  }
  return Infinity;
}

/** Desired perks that aren't on the final cross but ARE carried by an owned roster individual
 * whose species already appears as a produced-from leaf in `steps` — they can ride down the
 * existing cheapest tree opportunistically (no added combinations), just with compounding odds.
 * One entry per such perk, shortest leaf->target generation count, compounded superset-landing
 * odds over that many generations (spec §7.3's "perks compound per step"). This is what turns a
 * flat "not sourced in this plan" into an honest "present deeper, rides down with these odds"
 * (user requirement: detect opportunistic sourcing beyond just the final cross). */
function findDeeperOpportunisticCarriers(
  steps: SpeciesPlanStep[],
  target: SpeciesId,
  roster: RosterEntry[],
  remainingDesired: PassiveId[],
  ruleset: BreedingRuleset,
): { passive: PassiveId; viaSpecies: SpeciesId; generations: number; compoundedOdds: number }[] {
  if (steps.length === 0 || remainingDesired.length === 0) return [];
  const producedSpecies = new Set(steps.map((s) => s.child));
  // Leaves = species used as a parent but produced by no step (owned/caught bases).
  const leafSpecies = new Set<SpeciesId>();
  for (const s of steps) {
    for (const parent of [s.parentA.species, s.parentB.species]) {
      if (!producedSpecies.has(parent)) leafSpecies.add(parent);
    }
  }

  const out: { passive: PassiveId; viaSpecies: SpeciesId; generations: number; compoundedOdds: number }[] = [];
  for (const passive of remainingDesired) {
    // Best (fewest-generation) owned leaf carrying this perk — fewer generations = higher odds.
    let best: { viaSpecies: SpeciesId; generations: number } | null = null;
    for (const leaf of leafSpecies) {
      if (!roster.some((r) => r.species === leaf && r.passives?.includes(passive))) continue;
      const generations = generationsToTarget(steps, leaf, target);
      if (!isFinite(generations)) continue;
      if (!best || generations < best.generations) best = { viaSpecies: leaf, generations };
    }
    if (!best) continue;
    // Uniform per-generation superset-landing odds for one carried perk against clean fodder —
    // combining only the ruleset's own loaded dists (CLAUDE.md invariant #3), compounded over the
    // generations the perk must survive.
    const perGen = ruleset.passiveModel.landOdds([passive], [], [passive]).supersetContaining;
    out.push({ passive, viaSpecies: best.viaSpecies, generations: best.generations, compoundedOdds: perGen ** best.generations });
  }
  return out;
}

/** Incremental Dijkstra warm-started from an already-solved `baseState.dist`, used by
 * `findAnchorHints` to test one candidate anchor at a time and read off just the target's
 * resulting cost. The naive approach re-solves the whole graph from `roster` alone for
 * every candidate — since Dijkstra with non-negative weights never needs to "un-finalize"
 * a node once it's optimal, adding one more zero-cost seed (the candidate) can only ever
 * improve downstream dists, so relaxation can resume from the base fixpoint instead of
 * re-deriving the roster's entire base-reachable region from scratch ~289 times over.
 *
 * Mutates `baseState.dist` directly rather than copying it (copying + restoring ~580
 * entries per candidate turned out to cost about as much as the redundant work it was
 * meant to save) — every touched entry's prior value is recorded and restored before
 * returning, so the shared base state is pristine again for the next candidate and for
 * whatever query created it. Work — both the relax loop and the undo — is bounded by the
 * subgraph this specific candidate's addition actually affects, never more than copying or
 * re-solving the whole graph would cost. Uses a real binary heap (`MinHeap`, otherwise
 * reserved for `solveMasked`'s larger state space) since this runs once per candidate and
 * a linear extract-min would add back exactly the per-call overhead this is meant to
 * remove. `from`/step reconstruction isn't needed here — only the resulting cost number is
 * — so unlike `solve()` this never builds it. */
function anchorProbeCost(graph: Graph, baseState: SolveState, extraSeeds: RosterEntry[], targetNodes: [Node, Node]): number {
  const dist = baseState.dist;
  const prior = new Map<Node, number | undefined>();
  const finalized = new Set<Node>();
  const heap = new MinHeap<{ n: Node; cost: number }>((x) => x.cost);

  const relax = (n: Node, cost: number) => {
    if (cost >= (dist.get(n) ?? Infinity)) return;
    if (!prior.has(n)) prior.set(n, dist.get(n));
    dist.set(n, cost);
    heap.push({ n, cost });
  };

  for (const r of extraSeeds) relax(node(r.species, r.gender), 0);

  // Unlike `solve()`, this only ever needs one target-side answer per call, so it can stop
  // the instant either target-gender node is finalized — by then its cost is already final
  // (Dijkstra finalizes in non-decreasing cost order, so the first target node reached is
  // the cheaper/equal one, i.e. exactly `min(male, female)`), instead of always draining the
  // whole reachable closure like a full solve does even after the answer is already known.
  let result = Infinity;
  try {
    while (!heap.isEmpty()) {
      const { n, cost } = heap.pop()!;
      if (finalized.has(n)) continue;
      if (cost > (dist.get(n) ?? Infinity)) continue; // stale entry
      finalized.add(n);
      if (n === targetNodes[0] || n === targetNodes[1]) {
        result = cost;
        break;
      }

      for (const edgeIdx of graph.edgesByInput.get(n) ?? []) {
        const edge = graph.edges[edgeIdx]!;
        const [inA, inB] = edge.inputs;
        const costA = dist.get(inA) ?? Infinity;
        const costB = dist.get(inB) ?? Infinity;
        // Unlike a from-scratch solve, an edge's OTHER input may already be finalized from
        // the base state without ever being touched in this run — checked directly via
        // `dist` rather than an incremental "both inputs seen this run" counter, which
        // would wrongly wait forever for an input that has no reason to be re-relaxed.
        if (!isFinite(costA) || !isFinite(costB)) continue;
        relax(edge.output, combinationCost(costA, costB));
      }
    }
  } finally {
    // Runs even if the loop above throws (a malformed edge, a broken graph invariant), so a
    // mid-probe exception can never leave the shared `baseState` corrupted for whichever
    // candidate probes it next (post-Phase-5 code review finding #2).
    for (const [n, prevCost] of prior) {
      if (prevCost === undefined) dist.delete(n);
      else dist.set(n, prevCost);
    }
  }

  return result;
}

/** Like `anchorProbeCost`, but for `hubFinder`'s inject-cost sweep: seeds a candidate hub
 * species (both genders, cost 0) into a warm-started `baseState` and reads off the DEDUPED
 * combination count — not the raw additive `dist` — for one or more `targetSpecies` from the
 * same probe, since a shared intermediate reused by two branches is still one combination
 * (CLAUDE.md invariant #4; see `reconstruct`'s doc comment on why raw `dist` overcounts).
 * `anchorProbeCost` only ever needed a bare cost number (feasibility), so it never bothered
 * tracking `from`; this one does, so `reconstruct()` can walk the mutated state before it's
 * undone. Keeps relaxing until every wanted target's both gender-nodes are finalized (not
 * just the first, since a hub candidate is scored against several targets at once) — a target
 * that `baseState` already reaches optimally and that the new seeds don't improve is never
 * pushed onto the heap, so it's never explicitly "found" mid-loop; it's still read correctly
 * because every wanted target's cost is read straight off `dist` unconditionally after the
 * loop, not gated on having triggered the early exit. Mutates `baseState.dist`/`.from` directly
 * and restores every touched entry before
 * returning, same undo discipline as `anchorProbeCost`. */
export function injectProbe(
  graph: SolveContext['graph'],
  baseState: SolveContext['state'],
  extraSeeds: RosterEntry[],
  targetSpecies: SpeciesId[],
): Map<SpeciesId, number> {
  const dist = baseState.dist;
  const from = baseState.from;
  const priorDist = new Map<Node, number | undefined>();
  const priorFrom = new Map<Node, NodeSource | undefined>();
  const finalized = new Set<Node>();
  const heap = new MinHeap<{ n: Node; cost: number }>((x) => x.cost);

  const relax = (n: Node, cost: number, source: NodeSource) => {
    if (cost >= (dist.get(n) ?? Infinity)) return;
    if (!priorDist.has(n)) {
      priorDist.set(n, dist.get(n));
      priorFrom.set(n, from.get(n));
    }
    dist.set(n, cost);
    from.set(n, source);
    heap.push({ n, cost });
  };

  for (const r of extraSeeds) relax(node(r.species, r.gender), 0, { kind: 'owned' });

  const wantedNodes = new Set<Node>();
  for (const s of targetSpecies) {
    wantedNodes.add(node(s, 'male'));
    wantedNodes.add(node(s, 'female'));
  }

  const combos = new Map<SpeciesId, number>();
  try {
    while (!heap.isEmpty() && wantedNodes.size > 0) {
      const { n, cost } = heap.pop()!;
      if (finalized.has(n)) continue;
      if (cost > (dist.get(n) ?? Infinity)) continue; // stale entry
      finalized.add(n);
      wantedNodes.delete(n);

      for (const edgeIdx of graph.edgesByInput.get(n) ?? []) {
        const edge = graph.edges[edgeIdx]!;
        const [inA, inB] = edge.inputs;
        const costA = dist.get(inA) ?? Infinity;
        const costB = dist.get(inB) ?? Infinity;
        if (!isFinite(costA) || !isFinite(costB)) continue;
        relax(edge.output, combinationCost(costA, costB), { kind: 'combo', edge });
      }
    }

    for (const s of targetSpecies) {
      const maleCost = dist.get(node(s, 'male')) ?? Infinity;
      const femaleCost = dist.get(node(s, 'female')) ?? Infinity;
      const cost = Math.min(maleCost, femaleCost);
      if (isFinite(cost)) {
        const winningNode = maleCost <= femaleCost ? node(s, 'male') : node(s, 'female');
        combos.set(s, reconstruct(baseState, winningNode).steps.length);
      } else {
        combos.set(s, Infinity);
      }
    }
  } finally {
    // Runs even if the loop/reconstruct above throws, so a mid-probe exception can never leave
    // the shared `baseState` corrupted for whichever candidate probes it next (post-Phase-5
    // code review finding #2) — up to ~260 hub candidates share one `baseState` per sweep.
    for (const [n, prevCost] of priorDist) {
      if (prevCost === undefined) dist.delete(n);
      else dist.set(n, prevCost);
    }
    for (const [n, prevSrc] of priorFrom) {
      if (prevSrc === undefined) from.delete(n);
      else from.set(n, prevSrc);
    }
  }

  return combos;
}

/** Try seeding a single extra species (both genders, cost 0) and see whether the target
 * becomes reachable — the sound way to answer "what anchor would unlock this" without
 * relying on an unsound rank-based prune (spec §7.1). Exhaustive over rank-bearing
 * species is cheap at this graph size, especially warm-started per `anchorProbeCost` above. */
function findAnchorHints(
  ruleset: BreedingRuleset,
  target: SpeciesId,
  opts: CoreOptions,
  alreadyReachable: Set<SpeciesId>,
  baseState: SolveState,
): AnchorHint[] {
  const targetRank = ruleset.rankTable[target] ?? null;
  // Owning the target directly isn't a derivation hint — exclude it so an unreachable
  // target doesn't trivially "unlock itself".
  const candidates = Object.keys(ruleset.rankTable).filter((s) => s !== target && !alreadyReachable.has(s));
  const hints: AnchorHint[] = [];
  const graph = getGraph(ruleset, opts.ignoreGender);
  const targetNodes: [Node, Node] = [node(target, 'male'), node(target, 'female')];

  for (const species of candidates) {
    const extraSeeds: RosterEntry[] = [
      { species, gender: 'male' },
      { species, gender: 'female' },
    ];
    const resultingCost = anchorProbeCost(graph, baseState, extraSeeds, targetNodes);
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
    ignoreGender: options.ignoreGender ?? false,
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
  const graph = getGraph(ruleset, opts.ignoreGender);
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
      anchorHints = findAnchorHints(ruleset, target, opts, alreadyReachable, state);
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

  const winningGender: Gender = maleCost <= femaleCost ? 'male' : 'female';
  const targetNode = node(target, winningGender);
  const effectiveCost = cost;
  const desired = options.desiredPassives ?? [];
  // "Owning it" only satisfies `desiredPassives` if some owned individual actually carries
  // them — otherwise "already in your pools" would be a false negative. This planner no longer
  // tries to paper over a mismatch by silently substituting a real combo here (that used to
  // both violate the baseline's own "cheapest path, full stop" contract when it succeeded, and
  // silently fall back to the misleading owned-at-cost-0 result when it didn't) — the real
  // "what's the best route to breed one with these perks" answer now always comes from
  // `computeGuaranteedCarrierOutcome` (passivePlanner.ts), which every caller runs unconditionally.
  // `passiveNote` below records which of these cases applies so nothing is silently dropped.
  const ownedSatisfiesDesired =
    desired.length > 0 && roster.some((r) => r.species === target && desired.every((p) => (r.passives ?? []).includes(p)));
  // Captured now — before the final-cross re-pick below may temporarily overwrite
  // `state.from.get(targetNode)` — so `passiveNote` can tell whether the cheapest route was
  // reached by owning it, catching it, or actually breeding it.
  const reachedVia = state.from.get(targetNode)?.kind;

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
    // Perks not on the final cross split two ways: those an owned Pal carries deeper in this same
    // tree (ride down opportunistically — `opportunisticDeeper`) vs. those carried nowhere in the
    // tree at all (truly `unassigned`, only chance/re-roll). Splitting them keeps "not sourced"
    // honest instead of lumping a free-but-deeper perk in with a genuinely absent one.
    const notFinalCross = desired.filter((p) => !suppliedByFinalCross.has(p));
    const opportunisticDeeper = findDeeperOpportunisticCarriers(steps, target, roster, notFinalCross, ruleset);
    const deeperPassives = new Set(opportunisticDeeper.map((d) => d.passive));
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
      unassigned: notFinalCross.filter((p) => !deeperPassives.has(p)),
      opportunisticDeeper,
    };
  }

  // Explains the baseline's relationship to `desired` whenever `passivePlan` didn't get built
  // (BaselinePassiveNote's doc comment, types.ts) — never leave that silently unexplained.
  let passiveNote: BaselinePassiveNote | undefined;
  if (desired.length > 0) {
    if (passivePlan) {
      passiveNote = { status: 'planned' };
    } else if (reachedVia === 'owned') {
      passiveNote = ownedSatisfiesDesired
        ? { status: 'owned-exact-match' }
        : {
            status: 'owned-partial-match',
            ownedPassives: [...new Set(roster.filter((r) => r.species === target).flatMap((r) => r.passives ?? []))],
          };
    } else if (reachedVia === 'catch') {
      passiveNote = { status: 'cheapest-route-is-catch' };
    }
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
    ...(passiveNote ? { passiveNote } : {}),
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

/** The cheapest real bred-or-caught route to `target`'s own `(species, gender)` node, ignoring
 * whatever `dist` already has recorded there — used only to answer "if owning one didn't count,
 * what's the next cheapest way?" `dist`/`graph` are otherwise a normal, fully-solved fixpoint
 * over the UNMODIFIED roster, so every input this scans (including other owned individuals of
 * `target`'s own species feeding a self-cross, e.g. a second individual of a different gender)
 * is still fully available — only the direct "this exact node was free" answer is set aside. */
function cheapestNonOwnedNodeCost(
  graph: Graph,
  dist: Map<Node, number>,
  targetNode: Node,
  ruleset: BreedingRuleset,
  opts: CoreOptions,
): { cost: number; source: NodeSource } | null {
  let best: { cost: number; source: NodeSource } | null = null;
  for (const edge of graph.edges) {
    if (edge.output !== targetNode) continue;
    const [inA, inB] = edge.inputs;
    const costA = dist.get(inA) ?? Infinity;
    const costB = dist.get(inB) ?? Infinity;
    if (!isFinite(costA) || !isFinite(costB)) continue;
    const cost = combinationCost(costA, costB);
    if (!best || cost < best.cost) best = { cost, source: { kind: 'combo', edge } };
  }
  const { species, gender } = parseNode(targetNode);
  if (opts.allowCatching && !opts.excludeFromCatching.has(species) && ruleset.reachability.wildCatchable.has(species)) {
    const ratio = ruleset.genderRatio(species);
    if (ratio[gender] > 0 && (!best || opts.catchCost < best.cost)) best = { cost: opts.catchCost, source: { kind: 'catch' } };
  }
  return best;
}

/** Like `planSpecies`, but "you already own one" is never treated as the answer — the "next
 * best" half of `runSingleTargetPlan`'s owned-outright handling (spec §7.1/§7.3). Session
 * 2026-07-16 replaced the previous approach (re-solving against `roster` with every owned
 * `target`-species individual filtered out entirely) after a live report: filtering the roster
 * doesn't just block the trivial "you own it" shortcut, it also throws away those individuals
 * as legitimate breeding PARENTS — which silently broke the common case of two owned
 * individuals of the target species (each carrying a different desired passive, or just two
 * plain ones of opposite gender) that should simply be crossed with each other. That forced the
 * solver into needlessly convoluted routes through unrelated species whenever the target
 * species can (as most species can) produce itself.
 *
 * This solves the FULL, unmodified roster exactly like `planSpecies`, then — only if `target`'s
 * own node(s) were reached "for free" by direct ownership — overrides just those node(s) with
 * the cheapest route that comes from an actual combo or catch (`cheapestNonOwnedNodeCost`),
 * computed from the very same solved `dist` map (so an owned `target`-species individual of the
 * other gender is still right there as a valid self-cross input, at its real cost of 0). Both
 * overrides are computed from the pre-override snapshot before either is applied, so resolving
 * one gender's replacement can't be corrupted by the other's already having been overwritten.
 * The context is discarded after this call, so the restore-before-returning below is pure
 * hygiene, not required for correctness here — kept anyway to match the codebase's existing
 * shared-context-safe pattern (`anchorProbeCost`, `injectProbe`, the final-cross re-pick above). */
export function planSpeciesForAnotherCopy(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  options: SpeciesPlannerOptions = {},
): SpeciesPlanResult {
  const ctx = solveContext(ruleset, roster, options);
  const { graph, state, opts } = ctx;

  const targetNodes = (['male', 'female'] as Gender[]).map((g) => node(target, g));
  const ownedNodes = targetNodes.filter((tn) => state.from.get(tn)?.kind === 'owned');
  const replacements = new Map(ownedNodes.map((tn) => [tn, cheapestNonOwnedNodeCost(graph, state.dist, tn, ruleset, opts)]));

  const prior = new Map<Node, { dist: number | undefined; from: NodeSource | undefined }>();
  for (const [tn, repl] of replacements) {
    prior.set(tn, { dist: state.dist.get(tn), from: state.from.get(tn) });
    if (repl) {
      state.dist.set(tn, repl.cost);
      state.from.set(tn, repl.source);
    } else {
      state.dist.delete(tn);
      state.from.delete(tn);
    }
  }

  try {
    return resultFromContext(ruleset, roster, target, ctx, options, true);
  } finally {
    for (const [tn, p] of prior) {
      if (p.dist === undefined) state.dist.delete(tn);
      else state.dist.set(tn, p.dist);
      if (p.from === undefined) state.from.delete(tn);
      else state.from.set(tn, p.from);
    }
  }
}
