import { useMemo, useState } from 'react';
import { useRoster, useSettings } from '../store/hooks';
import { planUnion, findHubs } from '../solver/hubFinder';
import type { UnionPlanResult, HubFinderResult } from '../solver/types';
import { useLiveContext } from '../live/LiveContext';
import { buildRosterForSolver } from '../live/rosterMerge';
import { annotateUnionPlan } from '../live/provenance';
import { resolvePlayerDisplayName } from '../live/nameResolution';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect, UnionPlanView, HubList } from './shared';

/** Multi-target / hub planner (spec §8.3) — the primary view: several targets + a shared
 * perk set → union plan + ranked hub suggestions. */
export default function HubView() {
  const { ruleset, species, passives, speciesById } = useRulesetContext();
  const [roster] = useRoster();
  const [settings] = useSettings();
  const live = useLiveContext();
  const [targets, setTargets] = useState<string[]>([]);
  const [pendingTarget, setPendingTarget] = useState(species[0]?.id ?? '');
  const [desiredPassives, setDesiredPassives] = useState<string[]>([]);
  const [unionResult, setUnionResult] = useState<UnionPlanResult | null>(null);
  const [hubResult, setHubResult] = useState<HubFinderResult | null>(null);

  const rosterForSolver = useMemo(
    () => buildRosterForSolver(roster, live.selectedPlayerIds, live.palsByPlayer),
    [roster, live.selectedPlayerIds, live.palsByPlayer],
  );

  const displayNameByIdentifier = useMemo(
    () =>
      Object.fromEntries(live.players.map((p) => [p.identifier, resolvePlayerDisplayName(p, settings.live.nameOverrides)])),
    [live.players, settings.live.nameOverrides],
  );

  const provenance = useMemo(
    () =>
      unionResult ? annotateUnionPlan(unionResult, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier) : undefined,
    [unionResult, live.selectedPlayerIds, live.palsByPlayer, displayNameByIdentifier],
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

      {live.selectedPlayerIds.size > 0 && (
        <p>Including pals from {live.selectedPlayerIds.size} connected player(s) (see Server Pals).</p>
      )}
      <button onClick={runPlan}>Plan</button>

      {unionResult && (
        <div>
          <h3>Union plan</h3>
          <UnionPlanView plan={unionResult} speciesById={speciesById} provenance={provenance} />
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
