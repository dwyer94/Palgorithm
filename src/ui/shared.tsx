import type { Species, Passive } from '../data/schema';
import type { SpeciesPlanResult, PassivePlanResult, UnionPlanResult, HubCandidate } from '../solver/types';
import type { GuaranteedCarrierAlternative } from '../solver/passivePlanner';
import type { PassiveId } from '../ruleset/types';
import type { ProvenanceMatch } from '../live/provenance';
import type { LivePlayerPals, PlayerIdentifier } from '../live/types';
import { useSettings } from '../store/hooks';
import { ComboCount, ProvisionalTag, ElementDot, HoverTooltip, PalCard, PalIcon, PassiveChip, RankPill } from './components';
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
  speciesById,
}: {
  plan: PassivePlanResult;
  title?: string;
  passivesById?: Map<string, Passive> | undefined;
  speciesById?: Map<string, Species> | undefined;
}) {
  const pollutionA = plan.pollution.parentA;
  const pollutionB = plan.pollution.parentB;
  const hasPollution = pollutionA.length > 0 || pollutionB.length > 0;
  const unassigned = plan.unassigned;
  const hasUnassigned = unassigned.length > 0;
  const passiveName = (id: string) => passivesById?.get(id)?.displayName ?? id;
  const passiveTier = (id: string) => passivesById?.get(id)?.tier;
  const passiveDescription = (id: string) => passivesById?.get(id)?.description;
  const parentLabel = (individual: PassivePlanResult['finalParentA']) =>
    speciesById?.get(individual.species)?.displayName ?? individual.species;

  return (
    <div className="mb-[22px] overflow-hidden rounded-card border border-border-card bg-white shadow-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border-divider bg-panel-inset px-5 py-[13px]">
        <span className="font-sans text-[14px] font-bold">{title}</span>
        <ProvisionalTag />
        <span className="font-sans text-[12px] text-muted-light">odds are unverified — treat as guidance</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2">
        <div className="border-b border-border-divider p-5 sm:border-b-0 sm:border-r">
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
      {hasUnassigned && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border-inner bg-unresolved-bg2 px-5 py-[11px]">
          <span className="font-sans text-[11px] font-semibold text-provisional-text">⚠ Not sourced in this plan</span>
          <span className="flex flex-wrap items-center gap-1">
            {unassigned.map((id) => (
              <PassiveChip key={`u-${id}`} label={passiveName(id)} tier={passiveTier(id)} description={passiveDescription(id)} variant="warn" />
            ))}
          </span>
          <span className="font-sans text-[11px] text-muted-light">
            No ancestor in this tree carries {unassigned.length === 1 ? 'this perk' : 'these perks'} — the odds above can't include{' '}
            {unassigned.length === 1 ? 'it' : 'them'}.
          </span>
        </div>
      )}
      {hasPollution && (
        <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-border-inner bg-[#fdfaf4] px-5 py-[11px]">
          <span className="font-sans text-[11px] font-semibold text-brand-hover">⚑ Pollution</span>
          {pollutionA.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
              <PalIcon icon={speciesById?.get(plan.finalParentA.species)?.icon} size={14} />
              {parentLabel(plan.finalParentA)}:
              {pollutionA.map((id) => (
                <PassiveChip key={`a-${id}`} label={passiveName(id)} tier={passiveTier(id)} description={passiveDescription(id)} variant="warn" />
              ))}
            </span>
          )}
          {pollutionB.length > 0 && (
            <span className="flex flex-wrap items-center gap-1 font-mono text-[11px] text-muted">
              <PalIcon icon={speciesById?.get(plan.finalParentB.species)?.icon} size={14} />
              {parentLabel(plan.finalParentB)}:
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
  title,
  note,
}: {
  plan: SpeciesPlanResult;
  speciesById: Map<string, Species>;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  passivesById?: Map<string, Passive> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
  /** Overrides the plan panel's "Selected plan" header — used when two plan panels render
   * side by side (single-target's guaranteed-carrier vs opportunistic) so scrolling past the
   * section header doesn't leave two identically-titled cards indistinguishable. */
  title?: string | undefined;
  note?: string | undefined;
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
        passivePlan={plan.passivePlan}
        passivesById={passivesById}
        selectedPlayerIds={selectedPlayerIds}
        palsByPlayer={palsByPlayer}
        displayNameByIdentifier={displayNameByIdentifier}
        {...(title !== undefined && { title })}
        {...(note !== undefined && { note })}
      />
      {plan.passivePlan && <PassivePlanView plan={plan.passivePlan} passivesById={passivesById} speciesById={speciesById} />}
    </div>
  );
}

/** Single-target planner's full two-mode result display (guaranteed-carrier alternative, if
 * any, above the opportunistic/default baseline). Shared between `SingleTargetView` (live) and
 * `SavedPlansView` (snapshot) so a saved plan renders identically to what was on screen when it
 * was saved — see `SavedPlan.guaranteedCarrierAlt`. */
export function SingleTargetResultView({
  result,
  guaranteedCarrierAlt,
  desiredPassives,
  ownedUnassignedPassives,
  speciesById,
  passivesById,
  provenance,
  selectedPlayerIds,
  palsByPlayer,
  displayNameByIdentifier,
}: {
  result: SpeciesPlanResult;
  guaranteedCarrierAlt: GuaranteedCarrierAlternative | null;
  desiredPassives: PassiveId[];
  /** Subset of `result.passivePlan.unassigned` the roster owned when this was rendered. */
  ownedUnassignedPassives: PassiveId[];
  speciesById: Map<string, Species>;
  passivesById?: Map<string, Passive> | undefined;
  provenance?: Map<string, ProvenanceMatch> | undefined;
  selectedPlayerIds?: Set<PlayerIdentifier> | undefined;
  palsByPlayer?: Record<PlayerIdentifier, LivePlayerPals | undefined> | undefined;
  displayNameByIdentifier?: Record<PlayerIdentifier, string> | undefined;
}) {
  return (
    <>
      {result.passivePlan && result.passivePlan.unassigned.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2.5 rounded-t-card border border-b-0 border-l-[4px] border-l-brand border-border-card bg-[#fdfaf4] px-4 py-3">
            <span className="flex-none rounded-[5px] bg-brand px-[7px] py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[.5px] text-white">
              Alternative
            </span>
            <HoverTooltip description="Deliberately breeds in the Pal(s) that already carry your desired perks, so they're structurally part of the lineage instead of showing up by chance. This usually costs more breeding combinations than the cheapest path below, and the perks still aren't 100% guaranteed to land on any single egg — just far more likely.">
              <span className="font-sans text-[13.5px] font-bold text-ink-strong">Guaranteed-carrier</span>
            </HoverTooltip>
            <span className="font-sans text-[11.5px] text-muted">forces the perk(s) into one lineage</span>
          </div>
          <div className="flex flex-col gap-2.5 rounded-b-card border border-t-0 border-l-[4px] border-l-brand border-border-card bg-panel-subtle p-3.5">
            {guaranteedCarrierAlt && (
              <details open className="overflow-hidden rounded-card border border-border-card bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-[18px] py-3.5">
                  <span className="flex flex-none items-center -space-x-1.5">
                    {guaranteedCarrierAlt.sourceIndividuals.map((s, i) => (
                      <PalIcon key={i} icon={speciesById.get(s.species)?.icon} size={22} />
                    ))}
                  </span>
                  <span className="font-mono text-[13px] font-semibold">
                    Routes{' '}
                    {guaranteedCarrierAlt.sourceIndividuals
                      .map((s) => speciesById.get(s.species)?.displayName ?? s.species)
                      .join(', ')}{' '}
                    in for{' '}
                    {guaranteedCarrierAlt.routedPassives
                      .map((id) => passivesById?.get(id)?.displayName ?? id)
                      .join(' + ')}
                  </span>
                  <span className="ml-auto flex items-center gap-2 font-mono text-[11.5px] font-semibold">
                    <span className="text-brand-hover">
                      +{guaranteedCarrierAlt.combinationDelta} combo{guaranteedCarrierAlt.combinationDelta === 1 ? '' : 's'}
                    </span>
                    <span className="text-muted">
                      {(guaranteedCarrierAlt.compoundedOdds * 100).toFixed(1)}% compounded odds/egg
                    </span>
                  </span>
                  <span className="font-sans text-[12px] text-muted-lighter">▾</span>
                </summary>
                <div className="border-t border-[#f2ecdf] p-[18px]">
                  <SpeciesPlanView
                    plan={guaranteedCarrierAlt.plan}
                    speciesById={speciesById}
                    passivesById={passivesById}
                    selectedPlayerIds={selectedPlayerIds}
                    palsByPlayer={palsByPlayer}
                    displayNameByIdentifier={displayNameByIdentifier}
                    note="guaranteed-carrier route"
                  />
                </div>
              </details>
            )}

            {(guaranteedCarrierAlt
              ? guaranteedCarrierAlt.requiredPassives.filter((p) => !guaranteedCarrierAlt.routedPassives.includes(p))
              : result.passivePlan.unassigned
            ).map((passiveId) => {
              const label = passivesById?.get(passiveId)?.displayName ?? passiveId;
              const owned = ownedUnassignedPassives.includes(passiveId);
              return (
                <div
                  key={passiveId}
                  className="rounded-card border border-dashed border-border-input bg-white px-[18px] py-3 font-sans text-[12.5px] text-muted"
                >
                  {owned
                    ? `Even prioritizing the Pal that carries ${label}, no breeding route that jointly carries it alongside the rest of your desired perks was found under your current catch/roster settings.`
                    : `No Pal in your roster or connected servers carries ${label} — nothing to route in.`}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {desiredPassives.length > 0 ? (
        <div className="mb-5">
          <div className="flex items-center gap-2.5 rounded-t-card border border-b-0 border-l-[4px] border-l-primary border-border-card bg-primary-tint px-4 py-3">
            <span className="flex-none rounded-[5px] bg-primary px-[7px] py-[3px] font-mono text-[9.5px] font-bold uppercase tracking-[.5px] text-white">
              Default
            </span>
            <HoverTooltip description="The cheapest breeding path to this Pal, full stop — no extra steps are spent trying to guarantee any perk. If a desired perk happens to sit on the final parents for free, you'll get a real shot at landing it; otherwise it only comes down to luck later on.">
              <span className="font-sans text-[13.5px] font-bold text-ink-strong">Opportunistic</span>
            </HoverTooltip>
            <span className="font-sans text-[11.5px] text-muted">cheapest path, perks land only if free</span>
          </div>
          <div className="rounded-b-card border border-t-0 border-l-[4px] border-l-primary border-border-card bg-panel-subtle p-3.5">
            <SpeciesPlanView
              plan={result}
              speciesById={speciesById}
              provenance={provenance}
              passivesById={passivesById}
              selectedPlayerIds={selectedPlayerIds}
              palsByPlayer={palsByPlayer}
              displayNameByIdentifier={displayNameByIdentifier}
              note="opportunistic route"
            />
          </div>
        </div>
      ) : (
        <SpeciesPlanView
          plan={result}
          speciesById={speciesById}
          provenance={provenance}
          passivesById={passivesById}
          selectedPlayerIds={selectedPlayerIds}
          palsByPlayer={palsByPlayer}
          displayNameByIdentifier={displayNameByIdentifier}
        />
      )}
    </>
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
          speciesById={speciesById}
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
