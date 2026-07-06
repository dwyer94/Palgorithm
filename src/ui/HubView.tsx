import { useMemo, useState } from 'react';
import { useRoster, useSettings } from '../store/hooks';
import { planUnion, findHubs } from '../solver/hubFinder';
import type { UnionPlanResult, HubFinderResult } from '../solver/types';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect, UnionPlanView, HubList } from './shared';

/** Multi-target / hub planner (spec §8.3) — the primary view: several targets + a shared
 * perk set → union plan + ranked hub suggestions. */
export default function HubView() {
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const [targets, setTargets] = useState<string[]>([]);
  const [pendingTarget, setPendingTarget] = useState(species[0]?.id ?? '');
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [unionResult, setUnionResult] = useState<UnionPlanResult | null>(null);
  const [hubResult, setHubResult] = useState<HubFinderResult | null>(null);

  const rosterForSolver = useMemo(
    () => roster.map((r) => ({ species: r.species, gender: r.gender, passives: r.passives })),
    [roster],
  );

  const addTarget = () => {
    if (pendingTarget && !targets.includes(pendingTarget)) {
      setTargets([...targets, pendingTarget]);
    }
  };

  const removeTarget = (id: string) => setTargets(targets.filter((t) => t !== id));

  const runPlan = () => {
    if (targets.length === 0) return;
    const options = {
      catchCost: settings.catchCost,
      allowCatching: settings.allowCatching,
      ...(desiredPassives.length > 0 && { desiredPassives }),
    };
    setUnionResult(planUnion(ruleset, rosterForSolver, targets, options));
    setHubResult(findHubs(ruleset, rosterForSolver, { ...options, targets }));
  };

  return (
    <section>
      <h2>Multi-target / hub planner</h2>

      <div>
        <SpeciesSelect species={species} value={pendingTarget} onChange={setPendingTarget} />
        <button onClick={addTarget}>Add target</button>
        <ul>
          {targets.map((t) => (
            <li key={t}>
              {speciesById.get(t)?.displayName ?? t} <button onClick={() => removeTarget(t)}>Remove</button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p>Shared perk set (optional):</p>
        <PassiveMultiSelect passives={passives} value={desiredPassives} onChange={setDesiredPassives} />
      </div>

      <button onClick={runPlan}>Plan</button>

      {unionResult && (
        <div>
          <h3>Union plan</h3>
          <UnionPlanView plan={unionResult} speciesById={speciesById} />
        </div>
      )}

      {hubResult && (
        <div>
          <h3>Ranked hub candidates</h3>
          <HubList hubs={hubResult.hubs} speciesById={speciesById} />
        </div>
      )}
    </section>
  );
}
