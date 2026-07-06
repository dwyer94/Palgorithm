import { useState } from 'react';
import { useRulesetContext } from './RulesetContext';
import { SpeciesSelect } from './shared';

/** Reverse lookup (spec §8.5): pick a child → all raw parent pairs, unranked. The
 * building block behind the planners, exposed directly for manual inspection. */
export default function ReverseLookupView() {
  const { ruleset, species, speciesById } = useRulesetContext();
  const [child, setChild] = useState(species[0]?.id ?? '');
  const [pairs, setPairs] = useState<{ parentA: string; parentB: string }[] | null>(null);

  const lookup = () => {
    setPairs(ruleset.reverse(child));
  };

  return (
    <section>
      <h2>Reverse lookup</h2>
      <div>
        <SpeciesSelect species={species} value={child} onChange={setChild} />
        <button onClick={lookup}>Find parent pairs</button>
      </div>

      {pairs && (
        <div>
          <h3>Parent pairs for {speciesById.get(child)?.displayName ?? child}</h3>
          {pairs.length === 0 && <p>No known parent pairs.</p>}
          <ul>
            {pairs.map((p, i) => (
              <li key={i}>
                {speciesById.get(p.parentA)?.displayName ?? p.parentA} x {speciesById.get(p.parentB)?.displayName ?? p.parentB}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
