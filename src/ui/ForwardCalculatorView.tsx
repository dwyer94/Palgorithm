import { useState } from 'react';
import type { Gender, BreedingEdge } from '../ruleset/types';
import { useRulesetContext } from './RulesetContext';
import { SpeciesSelect } from './shared';
import { ElementDot, PalIcon } from './components';

/** Forward calculator: pick two parents → predicted child, a sanity tool that visually
 * validates the ruleset. Genders are optional — omitting one surfaces the gender-dependent
 * special-combo split as a real distribution (CLAUDE.md invariant #2). Styled to match the
 * app shell; not part of the design handoff bundle. */
export default function ForwardCalculatorView() {
  const { ruleset, species, speciesById } = useRulesetContext();
  const [parentA, setParentA] = useState(species[0]?.id ?? '');
  const [parentB, setParentB] = useState(species[0]?.id ?? '');
  const [genderA, setGenderA] = useState<Gender | ''>('');
  const [genderB, setGenderB] = useState<Gender | ''>('');
  const [edge, setEdge] = useState<BreedingEdge | null>(null);

  const compute = () => {
    setEdge(
      ruleset.forward(parentA, parentB, {
        ...(genderA !== '' && { genderA }),
        ...(genderB !== '' && { genderB }),
      }),
    );
  };

  const selectClass = 'rounded-panel border-[1.5px] border-border-input px-3 py-2 font-mono text-[13px] outline-none focus:border-primary';

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[720px] px-[34px] pb-[60px] pt-[26px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Forward calculator</div>
        <div className="mb-6 font-sans text-[13px] text-muted">Pick two parents, see every possible child outcome.</div>

        <div className="mb-4 rounded-card border border-border-card bg-white p-5 shadow-card">
          <div className="mb-3 flex items-center gap-2.5">
            <div className="w-[240px]">
              <SpeciesSelect species={species} value={parentA} onChange={setParentA} />
            </div>
            <select value={genderA} onChange={(e) => setGenderA(e.target.value as Gender | '')} className={selectClass}>
              <option value="">(either)</option>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
          </div>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="w-[240px]">
              <SpeciesSelect species={species} value={parentB} onChange={setParentB} />
            </div>
            <select value={genderB} onChange={(e) => setGenderB(e.target.value as Gender | '')} className={selectClass}>
              <option value="">(either)</option>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
          </div>
          <span
            onClick={compute}
            className="inline-block cursor-pointer rounded-panel bg-sidebar-bg px-4 py-2 font-sans text-[13px] font-semibold text-white hover:bg-sidebar-hover"
          >
            Predict
          </span>
        </div>

        {edge && (
          <div className="rounded-card border border-border-card bg-white p-5 shadow-card">
            <div className="mb-3 font-sans text-[15px] font-bold">Outcomes</div>
            {edge.outcomes.length === 0 ? (
              <p className="font-sans text-[13px] text-muted">No valid outcome for this pair.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {edge.outcomes.map((o, i) => {
                  const s = speciesById.get(o.child);
                  return (
                    <div key={i} className="flex items-center gap-2.5 rounded-panel border border-border-inner px-3 py-2">
                      <PalIcon icon={s?.icon} size={22} />
                      <ElementDot elements={s?.elements} />
                      <span className="font-mono text-[13px] font-semibold">{s?.displayName ?? o.child}</span>
                      <span className="ml-auto font-mono text-[12.5px] font-semibold text-muted">{(o.p * 100).toFixed(1)}%</span>
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
