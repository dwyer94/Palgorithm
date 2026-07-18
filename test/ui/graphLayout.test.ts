import { describe, it, expect } from 'vitest';
import { buildPlanGraph } from '../../src/ui/graphLayout';
import type { SpeciesPlanStep, PlanIndividual, PassivePlanResult } from '../../src/solver/types';

const label = (id: string) => ({
  remarkable: 'Remarkable Craftsmanship',
  artisan: 'Artisan',
  siren: 'Siren of the Void',
  stronghold: 'Stronghold Strategist',
})[id] ?? id;

describe('buildPlanGraph row heights', () => {
  it('reserves more room for a leaf carrying several long passive names than a bare leaf', () => {
    // Regression fixture for a real overlap bug: a fixed per-row slot let a leaf with wrapped
    // passive chips (e.g. 4 real perk names) bleed into the node below it in the same column.
    // The chip-height constants here are calibrated against the live-rendered chip row (measured
    // at ~115px wide; "Artisan" → 55.8px, "Siren of the Void" → 109.8px) — see graphLayout.ts.
    const passivePlan: PassivePlanResult = {
      desired: ['remarkable', 'artisan'],
      unassigned: [],
      finalParentA: { species: 'bare_pal', gender: 'male' },
      finalParentB: {
        species: 'loaded_pal',
        gender: 'female',
        passives: ['remarkable', 'artisan', 'siren', 'stronghold'],
      },
      landOdds: { exactSet: 0.16, supersetContaining: 0.4 },
      expectedEggs: { exactSet: 6, supersetContaining: 2.5 },
      pollution: { parentA: [], parentB: [] },
    } as unknown as PassivePlanResult;
    const catches: PlanIndividual[] = [
      { species: 'bare_pal', gender: 'male' },
      { species: 'loaded_pal', gender: 'female' },
    ];

    const layout = buildPlanGraph([], catches, [], passivePlan, [], label);
    const bare = layout.nodeById.get('leaf:bare_pal:male')!;
    const loaded = layout.nodeById.get('leaf:loaded_pal:female')!;
    expect(loaded.passives).toEqual(['remarkable', 'artisan', 'siren', 'stronghold']);

    const gapAfter = (node: typeof bare) => {
      const next = layout.nodes.find((n) => n.column === node.column && n.y > node.y);
      return next ? next.y - node.y : layout.height - node.y;
    };
    // A live measurement of this exact chip set rendered at 176.75px tall — the fix must
    // reserve at least that much room below the loaded node.
    expect(gapAfter(loaded)).toBeGreaterThanOrEqual(176.75);
    expect(gapAfter(loaded)).toBeGreaterThan(gapAfter(bare));
  });

  it('labels step columns with plain legible numbers instead of circled unicode glyphs', () => {
    const steps: SpeciesPlanStep[] = [
      { parentA: { species: 'a', gender: 'male' }, parentB: { species: 'b', gender: 'female' }, child: 'intermediate' },
      { parentA: { species: 'intermediate', gender: 'male' }, parentB: { species: 'c', gender: 'female' }, child: 'target' },
    ];
    const layout = buildPlanGraph(steps, [], ['target']);
    const stepLabels = layout.columns.filter((c) => c.label.startsWith('STEP')).map((c) => c.label);
    expect(stepLabels).toEqual(['STEP 1', 'STEP 2']);
    for (const c of layout.columns) expect(c.label).not.toMatch(/[①-⑨]/);
  });

  it('merges the target directly onto the step that produces it, instead of a lookalike TARGETS box', () => {
    // Regression fixture (2026-07-19 bug report): the target-producing step and the TARGETS
    // marker rendered as two visually-indistinguishable "Lullu" boxes joined by an edge that
    // added no information for the common single-step, single-target case. When the producing
    // step has no other consumer, the target styling now lands on that step's own node instead
    // of spawning a second one.
    const steps: SpeciesPlanStep[] = [
      { parentA: { species: 'a', gender: 'male' }, parentB: { species: 'b', gender: 'female' }, child: 'target' },
    ];
    const layout = buildPlanGraph(steps, [], ['target']);
    const labels = layout.columns.map((c) => c.label);
    expect(labels).toEqual(['OWN / CATCH', 'STEP 1']);

    const producedTarget = layout.nodes.find((n) => n.id === 'p0')!;
    expect(producedTarget.isTarget).toBe(true);
    expect(producedTarget.isTargetMarker).toBeFalsy();
    expect(producedTarget.column).toBe(1);

    expect(layout.nodeById.has('target:target')).toBe(false);
  });

  it('keeps a separate TARGETS marker when the producing step is shared with another consumer', () => {
    // A node that's also bred further can't wear both identities at once — the merge only
    // applies when the target is the node's sole purpose.
    const steps: SpeciesPlanStep[] = [
      { parentA: { species: 'a', gender: 'male' }, parentB: { species: 'b', gender: 'female' }, child: 'target' },
      { parentA: { species: 'target', gender: 'male' }, parentB: { species: 'c', gender: 'female' }, child: 'other' },
    ];
    const layout = buildPlanGraph(steps, [], ['target']);

    const producedTarget = layout.nodes.find((n) => n.id === 'p0')!;
    expect(producedTarget.isTarget).toBe(false);

    const marker = layout.nodeById.get('target:target')!;
    expect(marker.isTarget).toBe(true);
    expect(marker.isTargetMarker).toBe(true);
    expect(layout.columns.some((c) => c.label === 'TARGETS')).toBe(true);
    expect(layout.edges.some((e) => e.from === 'p0' && e.to === 'target:target')).toBe(true);
  });

  it('keeps a self-carrier leaf (owned individual of the target species used as a breeding parent) in OWN/CATCH, not TARGETS', () => {
    // Regression fixture: an owned Pal of the target's own species used as a carrier parent
    // used to get yanked into the rightmost TARGETS column purely by species match, producing
    // a backwards-pointing edge from TARGETS back into an earlier STEP column.
    const steps: SpeciesPlanStep[] = [
      { parentA: { species: 'target', gender: 'male' }, parentB: { species: 'other', gender: 'female' }, child: 'target' },
    ];
    const layout = buildPlanGraph(steps, [], ['target']);
    const carrierLeaf = layout.nodeById.get('leaf:target:male')!;
    expect(carrierLeaf.column).toBe(0);
    expect(carrierLeaf.isTarget).toBe(false);

    // The producing step (p0) has no other consumer, so the target merges onto it directly —
    // no separate marker, and every edge still points forward.
    expect(layout.nodeById.has('target:target')).toBe(false);
    const producedTarget = layout.nodes.find((n) => n.id === 'p0')!;
    expect(producedTarget.isTarget).toBe(true);
    expect(producedTarget.column).toBe(1);
    for (const e of layout.edges) {
      const from = layout.nodeById.get(e.from)!;
      const to = layout.nodeById.get(e.to)!;
      expect(to.column).toBeGreaterThanOrEqual(from.column);
    }
  });

  it('gives a target satisfied purely by catching its own TARGETS marker, separate from the OWN/CATCH leaf', () => {
    const catches: PlanIndividual[] = [{ species: 'target', gender: 'male' }];
    const layout = buildPlanGraph([], catches, ['target']);
    const leaf = layout.nodeById.get('leaf:target:male')!;
    expect(leaf.column).toBe(0);
    expect(leaf.isTarget).toBe(false);

    const marker = layout.nodeById.get('target:target')!;
    expect(marker.isTarget).toBe(true);
    expect(marker.isTargetMarker).toBe(true);
    expect(layout.edges.some((e) => e.from === 'leaf:target:male' && e.to === 'target:target')).toBe(true);
  });
});
