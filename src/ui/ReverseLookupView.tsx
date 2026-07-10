import { useState } from 'react';
import { useRulesetContext } from './RulesetContext';
import { SpeciesSelect } from './shared';
import { ElementDot, PalIcon } from './components';

/** Reverse lookup: pick a child → all raw parent pairs, unranked. The building block
 * behind the planners, exposed directly for manual inspection. Styled to match the app
 * shell; not part of the design handoff bundle. */
export default function ReverseLookupView() {
  const { ruleset, species, speciesById } = useRulesetContext();
  const [child, setChild] = useState(species[0]?.id ?? '');
  const [pairs, setPairs] = useState<{ parentA: string; parentB: string }[] | null>(null);

  const lookup = () => setPairs(ruleset.reverse(child));

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[720px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Reverse lookup</div>
        <div className="mb-6 font-sans text-[13px] text-muted">Pick a child species, see every raw parent pair that can produce it.</div>

        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-card border border-border-card bg-white p-5 shadow-card">
          <div className="w-full sm:w-[240px]">
            <SpeciesSelect species={species} value={child} onChange={setChild} />
          </div>
          <span
            onClick={lookup}
            className="cursor-pointer rounded-panel bg-sidebar-bg px-4 py-2 font-sans text-[13px] font-semibold text-white hover:bg-sidebar-hover"
          >
            Find parent pairs
          </span>
        </div>

        {pairs && (
          <div className="rounded-card border border-border-card bg-white p-5 shadow-card">
            <div className="mb-3 flex items-center gap-2 font-sans text-[15px] font-bold">
              <PalIcon icon={speciesById.get(child)?.icon} size={24} />
              Parent pairs for {speciesById.get(child)?.displayName ?? child}
            </div>
            {pairs.length === 0 ? (
              <p className="font-sans text-[13px] text-muted">No known parent pairs.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {pairs.map((p, i) => {
                  const a = speciesById.get(p.parentA);
                  const b = speciesById.get(p.parentB);
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-panel border border-border-inner px-3 py-2 font-mono text-[13px] font-semibold">
                      <PalIcon icon={a?.icon} size={20} />
                      <ElementDot elements={a?.elements} />
                      {a?.displayName ?? p.parentA}
                      <span className="text-shared">×</span>
                      <PalIcon icon={b?.icon} size={20} />
                      <ElementDot elements={b?.elements} />
                      {b?.displayName ?? p.parentB}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
