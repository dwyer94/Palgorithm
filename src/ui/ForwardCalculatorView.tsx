import { useState } from 'react';
import type { Gender, BreedingEdge } from '../ruleset/types';
import { useRulesetContext } from './RulesetContext';
import { SpeciesSelect } from './shared';

/** Forward calculator (spec §8.4): pick two parents → predicted child, a sanity tool that
 * visually validates the ruleset. Genders are optional — omitting one surfaces the
 * gender-dependent special-combo split as a real distribution (CLAUDE.md invariant #2). */
export default function ForwardCalculatorView() {
  const { ruleset, species, speciesById } = useRulesetContext();
  const [parentA, setParentA] = useState(species[0]?.id ?? '');
  const [parentB, setParentB] = useState(species[0]?.id ?? '');
  const [genderA, setGenderA] = useState<Gender | ''>('');
  const [genderB, setGenderB] = useState<Gender | ''>('');
  const [edge, setEdge] = useState<BreedingEdge | null>(null);

  const compute = () => {
    const result = ruleset.forward(parentA, parentB, {
      ...(genderA !== '' && { genderA }),
      ...(genderB !== '' && { genderB }),
    });
    setEdge(result);
  };

  return (
    <section>
      <h2>Forward calculator</h2>
      <div>
        <SpeciesSelect species={species} value={parentA} onChange={setParentA} />
        <select value={genderA} onChange={(e) => setGenderA(e.target.value as Gender | '')}>
          <option value="">(either)</option>
          <option value="male">male</option>
          <option value="female">female</option>
        </select>
      </div>
      <div>
        <SpeciesSelect species={species} value={parentB} onChange={setParentB} />
        <select value={genderB} onChange={(e) => setGenderB(e.target.value as Gender | '')}>
          <option value="">(either)</option>
          <option value="male">male</option>
          <option value="female">female</option>
        </select>
      </div>
      <button onClick={compute}>Predict</button>

      {edge && (
        <div>
          <h3>Outcomes</h3>
          {edge.outcomes.length === 0 && <p>No valid outcome for this pair.</p>}
          <ul>
            {edge.outcomes.map((o, i) => (
              <li key={i}>
                {speciesById.get(o.child)?.displayName ?? o.child} — {(o.p * 100).toFixed(1)}%
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
