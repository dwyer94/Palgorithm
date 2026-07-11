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
    // A single step whose child *is* the target collapses into the TARGETS column, so an
    // intermediate (non-target) step is needed to get a dedicated STEP column.
    const steps: SpeciesPlanStep[] = [
      { parentA: { species: 'a', gender: 'male' }, parentB: { species: 'b', gender: 'female' }, child: 'intermediate' },
      { parentA: { species: 'intermediate', gender: 'male' }, parentB: { species: 'c', gender: 'female' }, child: 'target' },
    ];
    const layout = buildPlanGraph(steps, [], ['target']);
    const stepColumn = layout.columns.find((c) => c.label.startsWith('STEP'));
    expect(stepColumn?.label).toBe('STEP 1');
    for (const c of layout.columns) expect(c.label).not.toMatch(/[①-⑨]/);
  });
});
