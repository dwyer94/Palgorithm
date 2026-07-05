import type { BreedingRuleset } from '../ruleset/types';
import type {
  AnchorHint,
  Gender,
  PlanIndividual,
  RosterEntry,
  SpeciesId,
  SpeciesPlanResult,
  SpeciesPlannerOptions,
  SpeciesPlanStep,
} from './types';

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

type NodeSource = { kind: 'owned' } | { kind: 'catch' } | { kind: 'combo'; edge: Edge };

interface SolveState {
  dist: Map<Node, number>;
  from: Map<Node, NodeSource>;
}

/** Knuth–Dijkstra fixpoint over the hypergraph, seeded from roster/catch base cases. */
function solve(graph: Graph, roster: RosterEntry[], ruleset: BreedingRuleset, opts: Required<SpeciesPlannerOptions>): SolveState {
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

/** Try seeding a single extra species (both genders, cost 0) and see whether the target
 * becomes reachable — the sound way to answer "what anchor would unlock this" without
 * relying on an unsound rank-based prune (spec §7.1). Exhaustive over rank-bearing
 * species is cheap at this graph size. */
function findAnchorHints(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  opts: Required<SpeciesPlannerOptions>,
  alreadyReachable: Set<SpeciesId>,
): AnchorHint[] {
  const targetRank = ruleset.rankTable[target] ?? null;
  // Owning the target directly isn't a derivation hint — exclude it so an unreachable
  // target doesn't trivially "unlock itself".
  const candidates = Object.keys(ruleset.rankTable).filter((s) => s !== target && !alreadyReachable.has(s));
  const hints: AnchorHint[] = [];
  const graph = buildGraph(ruleset);

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

export function planSpecies(
  ruleset: BreedingRuleset,
  roster: RosterEntry[],
  target: SpeciesId,
  options: SpeciesPlannerOptions = {},
): SpeciesPlanResult {
  const opts: Required<SpeciesPlannerOptions> = {
    catchCost: options.catchCost ?? 1,
    allowCatching: options.allowCatching ?? true,
  };

  const graph = buildGraph(ruleset);
  const state = solve(graph, roster, ruleset, opts);

  const maleCost = state.dist.get(node(target, 'male')) ?? Infinity;
  const femaleCost = state.dist.get(node(target, 'female')) ?? Infinity;
  const cost = Math.min(maleCost, femaleCost);

  if (!isFinite(cost)) {
    const alreadyReachable = new Set(
      Object.keys(ruleset.rankTable).filter((s) => {
        const c = Math.min(state.dist.get(node(s, 'male')) ?? Infinity, state.dist.get(node(s, 'female')) ?? Infinity);
        return isFinite(c);
      }),
    );
    for (const r of roster) alreadyReachable.add(r.species);
    return {
      target,
      feasible: false,
      combinationCount: Infinity,
      cost: Infinity,
      steps: [],
      catches: [],
      anchorHints: findAnchorHints(ruleset, roster, target, opts, alreadyReachable),
    };
  }

  const winningGender: Gender = maleCost <= femaleCost ? 'male' : 'female';
  const { steps, catches } = reconstruct(state, node(target, winningGender));

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
  };
}
