import type { Species, Passive } from '../data/schema';
import type { SpeciesPlanResult, PassivePlanResult, UnionPlanResult, HubCandidate } from '../solver/types';
import type { ProvenanceMatch } from '../live/provenance';
import type { LivePlayerPals, PlayerIdentifier } from '../live/types';
import { useSettings } from '../store/hooks';
import { ComboCount, ProvisionalTag, ElementDot, PalCard, PalIcon, PassiveChip, RankPill } from './components';
import { PlanRenderer } from './PlanView';

/** Shared, data-bound view composites reused across the planner screens (design handoff
 * README's "Reuse map"). Visual atoms live in `./components`; the layered graph rendering
 * lives in `./PlanView`. This file wires plan data to both. */

export { SpeciesSelect, PassiveMultiSelect } from './components';

export function speciesLabel(species: Species | undefined, id: string): string {
  return species ? `${species.displayName} (${id})` : id;
}

function formatEggs(n: number): string {
  return isFinite(n) ? `≈ ${n.toFixed(1)} eggs` : '∞ eggs';
}

export function PassivePlanView({
  plan,
  title = 'Perk landing · final cross',
  passivesById,
}: {
  plan: PassivePlanResult;
  title?: string;
  passivesById?: Map<string, Passive> | undefined;
}) {
  const pollutionA = plan.pollution.parentA;
  const pollutionB = plan.pollution.parentB;
  const hasPollution = pollutionA.length > 0 || pollutionB.length > 0;
  const passiveName = (id: string) => passivesById?.get(id)?.displayName ?? id;
  const passiveTier = (id: string) => passivesById?.get(id)?.tier;
  const passiveDescription = (id: string) => passivesById?.get(id)?.description;

  return (
    <div className="mb-[22px] overflow-hidden rounded-card border border-border-card bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border-divider bg-panel-inset px-5 py-[13px]">
        <span className="font-sans text-[14px] font-bold">{title}</span>
        <ProvisionalTag />
        <span className="font-sans text-[12px] text-muted-light">odds are unverified — treat as guidance</span>
      </div>
      <div className="grid grid-cols-2">
        <div className="border-r border-border-divider p-5">
          <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">Exact set</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[34px] font-bold tracking-[-1px]">{(plan.landOdds.exactSet * 100).toFixed(1)}%</span>
            <ProvisionalTag variant="inline" />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 font-mono text-[12.5px] font-medium text-muted">
            <span>{formatEggs(plan.expectedEggs.exactSet)} to hit exactly</span>
            {plan.desired.map((id) => (
              <PassiveChip
                key={id}
                label={passiveName(id)}
                tier={passiveTier(id)}
                description={passiveDescription(id)}
                className="px-1.5 py-0 text-[10.5px]"
              />
            ))}
          </div>
        </div>
        <div className="p-5">
          <div className="mb-2 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">Superset (at least)</div>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[34px] font-bold tracking-[-1px]">
              {(plan.landOdds.supersetContaining * 100).toFixed(1)}%
            </span>
            <ProvisionalTag variant="inline" />
          </div>
          <div className="mt-1 font-mono text-[12.5px] font-medium text-muted">
            {formatEggs(plan.expectedEggs.supersetContaining)} · may carry extras
          </div>
        </div>
      </div>
      {hasPollution && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border-inner bg-[#fdfaf4] px-5 py-[11px]">
          <span className="font-sans text-[11px] font-semibold text-brand-hover">⚑ Pollution</span>
          {pollutionA.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
              A:
              {pollutionA.map((id) => (
                <PassiveChip key={`a-${id}`} label={passiveName(id)} tier={passiveTier(id)} description={passiveDescription(id)} variant="warn" />
              ))}
            </span>
          )}
          {pollutionB.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
              B:
              {pollutionB.map((id) => (
                <PassiveChip key={`b-${id}`} label={passiveName(id)} tier={passiveTier(id)} description={passiveDescription(id)} variant="warn" />
              ))}
            </span>
          )}
          <span className="font-sans text-[11px] text-muted-light">Lowers exact-set odds. Not auto-resolved.</span>
        </div>
      )}
    </div>
  );
}

function AnchorHintsBlock({ plan, speciesById }: { plan: SpeciesPlanResult; speciesById: Map<string, Species> }) {
  return (
    <div className="p-4 pl-[38px] pt-3">
      <div className="mb-2.5 font-sans text-[12.5px] font-medium text-ink-muted">
        Not reachable from your pools. Catch one of these anchors to unlock it (nearest rank first):
      </div>
      <div className="flex flex-col gap-1.5">
        {(plan.anchorHints ?? []).map((h, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-lg border border-[#e6d9bd] bg-[#f6efe1] px-3 py-2">
            <PalIcon icon={speciesById.get(h.species)?.icon} size={20} />
            <span className="font-mono text-[12.5px] font-semibold">{speciesById.get(h.species)?.displayName ?? h.species}</span>
            <span className="font-mono text-[11px] font-medium text-provisional-text">
              rank {h.rank ?? '?'} · wild-catchable
            </span>
            <span className="ml-auto font-mono text-[11px] font-semibold text-ink-muted">→ cost {h.resultingCost}</span>
          </div>
        ))}
        {(plan.anchorHints ?? []).length === 0 && (
          <div className="font-mono text-[12px] text-muted">No candidate anchors found — this target may be entirely unreachable.</div>
        )}
      </div>
    </div>
  );
}

export function SpeciesPlanView({
  plan,
  speciesById,
  provenance,
  passivesById,
  selectedPlayerIds,
  palsByPlayer,
  displayNameByIdentifier,
}: {
  plan: SpeciesPlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  passivesById?: Map<string, Passive> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
}) {
  if (!plan.feasible) {
    return (
      <div className="overflow-hidden rounded-card border border-border-card bg-white shadow-card">
        <div className="flex items-center gap-2.5 px-[18px] py-3.5">
          <PalIcon icon={speciesById.get(plan.target)?.icon} size={22} />
          <span className="font-mono text-[14px] font-semibold">
            {speciesById.get(plan.target)?.displayName ?? plan.target}
          </span>
          <span className="font-mono text-[12px] font-semibold text-brand-hover">⚠ not reachable</span>
        </div>
        <div className="border-t border-[#f2ecdf]">
          <AnchorHintsBlock plan={plan} speciesById={speciesById} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 rounded-card border border-border-card bg-white p-5 shadow-card">
        <ComboCount
          value={plan.combinationCount}
          caption={`distinct combination${plan.combinationCount === 1 ? '' : 's'}`}
          meta={`cost ${plan.cost}${plan.catches.length > 0 ? ` · ${plan.catches.length} catch${plan.catches.length === 1 ? '' : 'es'}` : ''}`}
        />
      </div>
      <PlanRenderer
        steps={plan.steps}
        catches={plan.catches}
        targets={[plan.target]}
        speciesById={speciesById}
        provenance={provenance}
        desiredPassives={plan.passivePlan?.desired}
        passivesById={passivesById}
        selectedPlayerIds={selectedPlayerIds}
        palsByPlayer={palsByPlayer}
        displayNameByIdentifier={displayNameByIdentifier}
      />
      {plan.passivePlan && <PassivePlanView plan={plan.passivePlan} passivesById={passivesById} />}
    </div>
  );
}

export function UnionPlanView({
  plan,
  speciesById,
  provenance,
  hubSpeciesId,
  passivesById,
  selectedPlayerIds,
  palsByPlayer,
  displayNameByIdentifier,
}: {
  plan: UnionPlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  hubSpeciesId?: string | undefined;
  passivesById?: Map<string, Passive> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
}) {
  const targetsWithPassivePlan = plan.perTarget.filter((p) => p.passivePlan);

  return (
    <div>
      <PlanRenderer
        steps={plan.steps}
        catches={plan.catches}
        targets={plan.targets}
        speciesById={speciesById}
        provenance={provenance}
        hubSpeciesId={hubSpeciesId}
        passivesById={passivesById}
        selectedPlayerIds={selectedPlayerIds}
        palsByPlayer={palsByPlayer}
        displayNameByIdentifier={displayNameByIdentifier}
      />
      {targetsWithPassivePlan.map((t) => (
        <PassivePlanView
          key={t.target}
          plan={t.passivePlan!}
          title={`Perk landing · ${speciesById.get(t.target)?.displayName ?? t.target} final cross`}
          passivesById={passivesById}
        />
      ))}

      <div className="mb-2.5 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">Per-target breakdown</div>
      <div className="flex flex-col gap-2.5">
        {plan.perTarget.map((p) => {
          const species = speciesById.get(p.target);
          return (
            <details key={p.target} className="overflow-hidden rounded-xl border border-border-card bg-white">
              <summary className="flex cursor-pointer list-none items-center gap-2.5 px-[18px] py-3.5">
                <PalIcon icon={species?.icon} size={22} />
                <ElementDot elements={species?.elements} />
                <span className="font-mono text-[14px] font-semibold">{species?.displayName ?? p.target}</span>
                <span className="font-mono text-[11px] text-muted">
                  {species?.rank != null ? `r${species.rank}` : ''} {species?.elements[0] ?? ''}
                </span>
                <span className={`ml-auto font-mono text-[12px] font-semibold ${p.feasible ? 'text-success-text' : 'text-brand-hover'}`}>
                  {p.feasible ? `feasible · ${p.combinationCount} combos` : '⚠ not reachable'}
                </span>
                <span className="font-sans text-[12px] text-muted-lighter">▾</span>
              </summary>
              {p.feasible ? (
                <div className="border-t border-[#f2ecdf] px-[18px] py-3 pl-[38px] font-mono text-[12.5px] text-ink-muted">
                  {p.steps.map((s, i) => (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {speciesById.get(s.parentA.species)?.displayName ?? s.parentA.species}×
                      {speciesById.get(s.parentB.species)?.displayName ?? s.parentB.species}→
                      {speciesById.get(s.child)?.displayName ?? s.child}
                    </span>
                  ))}
                  {p.steps.length === 0 && 'Already in your pools — no breeding required.'}
                </div>
              ) : (
                <div className="border-t border-[#f2ecdf]">
                  <AnchorHintsBlock plan={p} speciesById={speciesById} />
                </div>
              )}
            </details>
          );
        })}
      </div>
    </div>
  );
}

function hubMeta(h: HubCandidate): string {
  const direct = h.injectCost?.filter((ic) => ic.direct).length ?? 0;
  const via = (h.injectCost?.length ?? 0) - direct;
  let meta = `obtain ${h.obtainCost}`;
  if (h.injectCost && h.injectCost.length > 0) {
    meta += ' · ';
    if (direct > 0) meta += `${direct} direct`;
    if (direct > 0 && via > 0) meta += ', ';
    if (via > 0) meta += `${via} via`;
  }
  if (h.breadth !== undefined) meta += ` · reaches ${h.breadth}`;
  return meta;
}

export function HubList({
  hubs,
  speciesById,
  selected,
  onSelect,
  scopeLabel,
}: {
  hubs: HubCandidate[];
  speciesById: Map<string, Species>;
  selected?: string | undefined;
  onSelect?: ((species: string) => void) | undefined;
  /** Overrides the "Ranked hubs" header — used to disclose how many candidates were
   * actually checked (e.g. "Quick pick · 3 checked" vs "Ranked hubs · 211 checked"),
   * since a quick-pick re-score and a full sweep answer different questions. */
  scopeLabel?: string | undefined;
}) {
  const [settings] = useSettings();
  const isFull = settings.iconDisplayMode === 'full';

  if (hubs.length === 0) {
    return (
      <div className="rounded-card border border-border-card bg-white p-5 font-sans text-[13px] text-muted shadow-card">
        No hub candidates found.
      </div>
    );
  }

  if (isFull) {
    return (
      <div className="overflow-hidden rounded-card border border-border-card bg-white shadow-card">
        <div className="px-[15px] pb-2 pt-3 font-sans text-[10.5px] font-semibold uppercase tracking-wide text-muted">
          {scopeLabel ?? 'Ranked hubs'}
        </div>
        <div className="flex flex-wrap gap-2.5 border-t border-border-divider p-[15px]">
          {hubs.map((h) => {
            const isSelected = selected === h.species;
            const species = speciesById.get(h.species);
            return (
              <PalCard
                key={h.species}
                icon={species?.icon}
                elements={species?.elements}
                title={species?.displayName ?? h.species}
                meta={hubMeta(h)}
                selected={isSelected}
                onClick={() => onSelect?.(h.species)}
              >
                <span className={`font-mono text-[11px] font-semibold ${isSelected ? 'text-primary-dark' : 'text-muted'}`}>
                  {isSelected && '★ '}
                  {h.score ?? h.breadth ?? h.obtainCost}
                </span>
              </PalCard>
            );
          })}
        </div>
        <div className="border-t border-border-divider px-[15px] py-2.5 font-sans text-[11px] text-muted-light">
          Hubs are optional — compare, never forced.
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border-card bg-white shadow-card">
      <div className="px-[15px] pb-2 pt-3 font-sans text-[10.5px] font-semibold uppercase tracking-wide text-muted">
        {scopeLabel ?? 'Ranked hubs'}
      </div>
      {hubs.map((h) => {
        const isSelected = selected === h.species;
        return (
          <div
            key={h.species}
            onClick={() => onSelect?.(h.species)}
            className={`cursor-pointer border-t border-border-divider px-[15px] py-2.5 first:border-t-0 ${
              isSelected ? 'border-l-[3px] border-l-primary bg-primary-tint2' : 'hover:bg-panel-inset'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`flex min-w-0 items-center gap-1.5 font-mono text-[12.5px] font-semibold ${isSelected ? 'text-primary-darker' : 'text-ink-strong'}`}>
                <PalIcon icon={speciesById.get(h.species)?.icon} size={20} />
                {isSelected && '★ '}
                {speciesById.get(h.species)?.displayName ?? h.species}
              </span>
              <span className={`font-mono text-[12px] font-semibold ${isSelected ? 'text-primary-dark' : 'text-muted'}`}>
                {h.score ?? h.breadth ?? h.obtainCost}
              </span>
            </div>
            <div className={`font-sans text-[11px] ${isSelected ? 'text-[#5a7fb8]' : 'text-muted-light'}`}>{hubMeta(h)}</div>
          </div>
        );
      })}
      <div className="border-t border-border-divider px-[15px] py-2.5 font-sans text-[11px] text-muted-light">
        Hubs are optional — compare, never forced.
      </div>
    </div>
  );
}

export { RankPill };
