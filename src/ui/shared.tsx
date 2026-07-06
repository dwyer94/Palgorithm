import type { Species, Passive } from '../data/schema';
import type { PlanIndividual, SpeciesPlanResult, PassivePlanResult, UnionPlanResult, HubCandidate } from '../solver/types';
import type { ProvenanceMatch } from '../live/provenance';

/** Small shared pieces reused across the six unstyled views (spec §8). No styling beyond
 * functional layout — visual design is session 0.D (CLAUDE.md invariant #5). */

export function speciesLabel(species: Species | undefined, id: string): string {
  return species ? `${species.displayName} (${id})` : id;
}

export function SpeciesSelect({
  species,
  value,
  onChange,
  allowEmpty,
}: {
  species: Species[];
  value: string;
  onChange: (id: string) => void;
  allowEmpty?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {allowEmpty && <option value="">(none)</option>}
      {species
        .slice()
        .sort((a, b) => a.displayName.localeCompare(b.displayName))
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.displayName}
          </option>
        ))}
    </select>
  );
}

export function PassiveMultiSelect({
  passives,
  value,
  onChange,
}: {
  passives: Passive[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', maxHeight: '12em', overflowY: 'auto', border: '1px solid #ccc' }}>
      {passives.map((p) => (
        <label key={p.id}>
          <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
          {p.displayName}
          {p.tier !== undefined && ` (tier ${p.tier})`}
        </label>
      ))}
    </div>
  );
}

function individualLabel(ind: PlanIndividual, speciesById: Map<string, Species>): string {
  const name = speciesById.get(ind.species)?.displayName ?? ind.species;
  const passives = ind.passives && ind.passives.length > 0 ? ` [${ind.passives.join(', ')}]` : '';
  return `${name} (${ind.gender})${passives}`;
}

/** Best-effort "whose box has this pal" hint (docs/UI_REQUIREMENTS.md). Absent when no
 * connected players are selected, or when nothing matched — never a guaranteed claim. */
function provenanceHint(provenance: Map<string, ProvenanceMatch> | undefined, key: string): string {
  const match = provenance?.get(key);
  if (!match) return '';
  return match.confident ? ` (owned by ${match.ownerDisplayName})` : ` (possibly ${match.ownerDisplayName}'s)`;
}

export function PassivePlanView({
  plan,
  speciesById,
  provenance,
}: {
  plan: PassivePlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
}) {
  return (
    <div>
      <h4>Perk overlay: {plan.desired.join(', ')}</h4>
      <p>
        Final cross: {individualLabel(plan.finalParentA, speciesById)}
        {provenanceHint(provenance, 'passivePlan:A')} x {individualLabel(plan.finalParentB, speciesById)}
        {provenanceHint(provenance, 'passivePlan:B')}
      </p>
      <ul>
        <li>Exact set odds: {(plan.landOdds.exactSet * 100).toFixed(2)}% (expected eggs: {formatEggs(plan.expectedEggs.exactSet)})</li>
        <li>
          Superset (at least desired) odds: {(plan.landOdds.supersetContaining * 100).toFixed(2)}% (expected eggs:{' '}
          {formatEggs(plan.expectedEggs.supersetContaining)})
        </li>
      </ul>
      {(plan.pollution.parentA.length > 0 || plan.pollution.parentB.length > 0) && (
        <p>
          Pollution — extra passives outside desired set: A: {plan.pollution.parentA.join(', ') || 'none'}, B:{' '}
          {plan.pollution.parentB.join(', ') || 'none'}
        </p>
      )}
    </div>
  );
}

function formatEggs(n: number): string {
  return isFinite(n) ? n.toFixed(1) : '∞';
}

export function SpeciesPlanView({
  plan,
  speciesById,
  provenance,
}: {
  plan: SpeciesPlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
}) {
  if (!plan.feasible) {
    return (
      <div>
        <p>
          <strong>Infeasible</strong> — {speciesById.get(plan.target)?.displayName ?? plan.target} is not reachable from the
          current roster.
        </p>
        {plan.anchorHints && plan.anchorHints.length > 0 && (
          <>
            <p>Candidate anchors that would unlock this target:</p>
            <ul>
              {plan.anchorHints.map((h, i) => (
                <li key={i}>
                  {speciesById.get(h.species)?.displayName ?? h.species} ({h.gender}, rank {h.rank ?? '?'}) → resulting cost{' '}
                  {h.resultingCost}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <p>
        <strong>{plan.combinationCount}</strong> distinct combination{plan.combinationCount === 1 ? '' : 's'} (total cost{' '}
        {plan.cost})
      </p>
      <ol>
        {plan.steps.map((step, i) => (
          <li key={i}>
            {individualLabel(step.parentA, speciesById)}
            {provenanceHint(provenance, `step:${i}:A`)} x {individualLabel(step.parentB, speciesById)}
            {provenanceHint(provenance, `step:${i}:B`)} → {speciesById.get(step.child)?.displayName ?? step.child}
          </li>
        ))}
      </ol>
      {plan.catches.length > 0 && (
        <p>
          Requires catching:{' '}
          {plan.catches.map((c, i) => `${individualLabel(c, speciesById)}${provenanceHint(provenance, `catch:${i}`)}`).join(', ')}
        </p>
      )}
      {plan.passivePlan && <PassivePlanView plan={plan.passivePlan} speciesById={speciesById} provenance={provenance} />}
    </div>
  );
}

export function UnionPlanView({
  plan,
  speciesById,
  provenance,
}: {
  plan: UnionPlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
}) {
  return (
    <div>
      <p>
        Targets: {plan.targets.map((t) => speciesById.get(t)?.displayName ?? t).join(', ')} —{' '}
        {plan.feasible ? 'all feasible' : 'one or more targets infeasible'}
      </p>
      <p>
        <strong>{plan.combinationCount}</strong> distinct combination{plan.combinationCount === 1 ? '' : 's'} across all
        targets (total cost {plan.cost})
      </p>
      <ol>
        {plan.steps.map((step, i) => (
          <li key={i}>
            {individualLabel(step.parentA, speciesById)}
            {provenanceHint(provenance, `step:${i}:A`)} x {individualLabel(step.parentB, speciesById)}
            {provenanceHint(provenance, `step:${i}:B`)} → {speciesById.get(step.child)?.displayName ?? step.child}
          </li>
        ))}
      </ol>
      {plan.catches.length > 0 && (
        <p>
          Requires catching:{' '}
          {plan.catches.map((c, i) => `${individualLabel(c, speciesById)}${provenanceHint(provenance, `catch:${i}`)}`).join(', ')}
        </p>
      )}
      <h4>Per-target detail</h4>
      {plan.perTarget.map((p) => (
        <details key={p.target}>
          <summary>
            {speciesById.get(p.target)?.displayName ?? p.target} — {p.feasible ? `${p.combinationCount} combos` : 'infeasible'}
          </summary>
          <SpeciesPlanView plan={p} speciesById={speciesById} />
        </details>
      ))}
    </div>
  );
}

export function HubList({ hubs, speciesById }: { hubs: HubCandidate[]; speciesById: Map<string, Species> }) {
  if (hubs.length === 0) return <p>No hub candidates found.</p>;
  return (
    <ol>
      {hubs.map((h) => (
        <li key={h.species}>
          {speciesById.get(h.species)?.displayName ?? h.species} — obtain cost {h.obtainCost}
          {h.score !== undefined && <> — score {h.score}</>}
          {h.breadth !== undefined && <> — breadth {h.breadth}</>}
          {h.injectCost && h.injectCost.length > 0 && (
            <ul>
              {h.injectCost.map((ic) => (
                <li key={ic.target}>
                  → {speciesById.get(ic.target)?.displayName ?? ic.target}: {ic.combos} combo(s){ic.direct ? ' (direct parent)' : ''}
                </li>
              ))}
            </ul>
          )}
          {h.obtainPassivePlan && <PassivePlanView plan={h.obtainPassivePlan} speciesById={speciesById} />}
        </li>
      ))}
    </ol>
  );
}
