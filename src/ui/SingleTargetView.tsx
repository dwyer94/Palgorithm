import { useMemo, useState } from 'react';
import { useRoster } from '../store/hooks';
import { useSettings } from '../store/hooks';
import { planSpecies } from '../solver/speciesPlanner';
import type { SpeciesPlanResult } from '../solver/types';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect, SpeciesPlanView } from './shared';

/** Single-target planner (spec §8.2): pick a target + optional perks, get a ranked plan. */
export default function SingleTargetView() {
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const [target, setTarget] = useState(species[0]?.id ?? '');
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [result, setResult] = useState<SpeciesPlanResult | null>(null);

  const rosterForSolver = useMemo(
    () => roster.map((r) => ({ species: r.species, gender: r.gender, passives: r.passives })),
    [roster],
  );

  const runPlan = () => {
    if (!target) return;
    const plan = planSpecies(ruleset, rosterForSolver, target, {
      catchCost: settings.catchCost,
      allowCatching: settings.allowCatching,
      ...(desiredPassives.length > 0 && { desiredPassives }),
    });
    setResult(plan);
  };

  return (
    <section>
      <h2>Single-target planner</h2>
      <div>
        <label>Target: </label>
        <SpeciesSelect species={species} value={target} onChange={setTarget} />
      </div>
      <div>
        <p>Desired perks (optional):</p>
        <PassiveMultiSelect passives={passives} value={desiredPassives} onChange={setDesiredPassives} />
      </div>
      <button onClick={runPlan}>Plan</button>

      {result && (
        <div>
          <h3>Result for {speciesById.get(result.target)?.displayName ?? result.target}</h3>
          <SpeciesPlanView plan={result} speciesById={speciesById} />
        </div>
      )}
    </section>
  );
}
