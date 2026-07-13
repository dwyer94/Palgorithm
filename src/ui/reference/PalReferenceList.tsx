import { useMemo } from 'react';
import { ELEMENTS, SIZES } from '../../data/schema';
import type { Element, PartnerSkill, Species } from '../../data/schema';
import { useRulesetContext } from '../RulesetContext';
import { useSettings } from '../../store/hooks';
import { useReferenceContext, type PalsSortBy, type ReachFilter } from '../ReferenceContext';
import {
  PalCard,
  PalIcon,
  ElementDot,
  RankPill,
  Pill,
  SegmentedControl,
  WorkSuitabilityRow,
  WorkSuitabilityFilterEditor,
  WORK_SUITABILITY_TYPES,
  HoverTooltip,
  elementColor,
} from '../components';

const searchInputClass =
  'w-full rounded-panel border-[1.5px] border-border-input px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-primary';
const numberInputClass =
  'w-[56px] rounded-panel border-[1.5px] border-border-input px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-primary';

const FIXED_SORT_OPTIONS: { value: PalsSortBy; label: string }[] = [
  { value: 'name', label: 'Sort: Name (A→Z)' },
  { value: 'rank', label: 'Sort: Breeding rank (rarest first)' },
  { value: 'rarity', label: 'Sort: Rarity (high → low)' },
  { value: 'walk', label: 'Sort: Walk speed (high → low)' },
  { value: 'run', label: 'Sort: Run speed (high → low)' },
  { value: 'swim', label: 'Sort: Swim speed (high → low)' },
];

const REACH_OPTIONS: { value: ReachFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'breedable', label: 'Breedable' },
  { value: 'catchable', label: 'Catchable' },
  { value: 'special', label: 'Special' },
];

function speciesReachability(s: Species): Exclude<ReachFilter, 'all'> {
  if (s.standardBreedable) return 'breedable';
  if (s.wildCatchable) return 'catchable';
  return 'special';
}

function workLevels(species: Species): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of species.workSuitabilities ?? []) out[w.type] = w.level;
  return out;
}

function matchesSearch(species: Species, query: string, partnerSkill: PartnerSkill | undefined): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (species.displayName.toLowerCase().includes(q)) return true;
  if (partnerSkill?.displayName.toLowerCase().includes(q)) return true;
  return (species.aliases ?? []).some((a) => a.toLowerCase().includes(q));
}

function partnerSkillTooltip(ps: PartnerSkill): string {
  const lines = [ps.description].filter((l): l is string => !!l);
  const meta: string[] = [];
  if (ps.unlockItemName) meta.push(`Unlock: ${ps.unlockItemName}`);
  if (ps.cooldownSeconds !== undefined) meta.push(`Cooldown: ${ps.cooldownSeconds}s`);
  if (meta.length > 0) lines.push(meta.join(' · '));
  return lines.join('\n\n');
}

/** Compact "🤝 <skill name>" badge, hover for the full effect text/unlock item/cooldown.
 * Renders nothing for the handful of Pals with no partner skill on record. */
function PartnerSkillBadge({ skill, className = '' }: { skill: PartnerSkill | undefined; className?: string }) {
  if (!skill) return null;
  return (
    <HoverTooltip description={partnerSkillTooltip(skill)}>
      <span
        className={`inline-flex items-center gap-1 rounded-chip border border-border-inner bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted ${className}`}
      >
        🤝 {skill.displayName}
      </span>
    </HoverTooltip>
  );
}

/** Search/filter/sort over the full Pal roster (all 291 species, not the user's owned roster).
 * Shared verbatim by the floating bubble panel and the full-screen Reference view — `dense`
 * switches between the bubble's narrow single-column list and the roomier grid/table used
 * everywhere else, matching `settings.iconDisplayMode` like every other view. */
export default function PalReferenceList({ dense = false }: { dense?: boolean }) {
  const { species, partnerSkillBySpecies } = useRulesetContext();
  const [settings] = useSettings();
  const { palsQuery, setPalsQuery } = useReferenceContext();
  const {
    search,
    elements,
    reach,
    sizes,
    nocturnalOnly,
    mountableOnly,
    rankMin,
    rankMax,
    minRunSpeed,
    workFilters,
    sortBy,
  } = palsQuery;

  const toggleElement = (el: Element) =>
    setPalsQuery({
      ...palsQuery,
      elements: elements.includes(el) ? elements.filter((e) => e !== el) : [...elements, el],
    });
  const toggleSize = (size: string) =>
    setPalsQuery({ ...palsQuery, sizes: sizes.includes(size) ? sizes.filter((s) => s !== size) : [...sizes, size] });

  const results = useMemo(() => {
    let list = species.filter((s) => {
      if (!matchesSearch(s, search, partnerSkillBySpecies.get(s.id))) return false;
      if (elements.length > 0 && !s.elements.some((e) => elements.includes(e))) return false;
      if (reach !== 'all' && speciesReachability(s) !== reach) return false;
      if (sizes.length > 0 && (!s.size || !sizes.includes(s.size))) return false;
      if (nocturnalOnly && !s.nocturnal) return false;
      if (mountableOnly && !s.mountable) return false;
      if (rankMin !== null && (s.rank ?? Infinity) < rankMin) return false;
      if (rankMax !== null && (s.rank ?? -Infinity) > rankMax) return false;
      if (minRunSpeed !== null && (s.movement?.run ?? -Infinity) < minRunSpeed) return false;
      const levels = workLevels(s);
      if (!workFilters.every((f) => (levels[f.type] ?? 0) >= f.minLevel)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.displayName.localeCompare(b.displayName);
        case 'rank':
          return (a.rank ?? Infinity) - (b.rank ?? Infinity);
        case 'rarity':
          return (b.rarity ?? -Infinity) - (a.rarity ?? -Infinity);
        case 'walk':
          return (b.movement?.walk ?? -Infinity) - (a.movement?.walk ?? -Infinity);
        case 'run':
          return (b.movement?.run ?? -Infinity) - (a.movement?.run ?? -Infinity);
        case 'swim':
          return (b.movement?.swim ?? -Infinity) - (a.movement?.swim ?? -Infinity);
        default:
          // A work-suitability type id — sort by that work level, high to low.
          return (workLevels(b)[sortBy] ?? 0) - (workLevels(a)[sortBy] ?? 0);
      }
    });
    return list;
  }, [
    species,
    partnerSkillBySpecies,
    search,
    elements,
    reach,
    sizes,
    nocturnalOnly,
    mountableOnly,
    rankMin,
    rankMax,
    minRunSpeed,
    workFilters,
    sortBy,
  ]);

  const isFull = !dense && settings.iconDisplayMode === 'full';

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setPalsQuery({ ...palsQuery, search: e.target.value })}
        placeholder="Search pals…"
        className={`${searchInputClass} mb-2`}
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {ELEMENTS.map((el) => (
            <span
              key={el}
              onClick={() => toggleElement(el)}
              title={el}
              className="cursor-pointer rounded-full p-[3px]"
              style={{ boxShadow: elements.includes(el) ? `0 0 0 1.5px ${elementColor(el)}` : 'none' }}
            >
              <ElementDot element={el} size={dense ? 9 : 11} />
            </span>
          ))}
        </div>
        <SegmentedControl<ReachFilter>
          options={REACH_OPTIONS}
          value={reach}
          onChange={(v) => setPalsQuery({ ...palsQuery, reach: v })}
        />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {SIZES.map((size) => (
            <span
              key={size}
              onClick={() => toggleSize(size)}
              className={`cursor-pointer rounded-pill border-[1.5px] px-2 py-0.5 font-mono text-[10.5px] font-semibold ${
                sizes.includes(size)
                  ? 'border-primary bg-primary-tint text-primary-dark'
                  : 'border-border-card bg-white text-muted-light hover:border-muted-lighter'
              }`}
            >
              {size}
            </span>
          ))}
        </div>
        <span
          onClick={() => setPalsQuery({ ...palsQuery, nocturnalOnly: !nocturnalOnly })}
          className={`cursor-pointer rounded-pill border-[1.5px] px-2 py-0.5 font-sans text-[10.5px] font-semibold ${
            nocturnalOnly
              ? 'border-primary bg-primary-tint text-primary-dark'
              : 'border-border-card bg-white text-muted-light hover:border-muted-lighter'
          }`}
        >
          🌙 Nocturnal
        </span>
        <span
          onClick={() => setPalsQuery({ ...palsQuery, mountableOnly: !mountableOnly })}
          className={`cursor-pointer rounded-pill border-[1.5px] px-2 py-0.5 font-sans text-[10.5px] font-semibold ${
            mountableOnly
              ? 'border-primary bg-primary-tint text-primary-dark'
              : 'border-border-card bg-white text-muted-light hover:border-muted-lighter'
          }`}
        >
          🐴 Mountable
        </span>
        <span className="flex items-center gap-1 font-sans text-[11px] font-semibold text-muted-light">
          Rank
          <input
            type="number"
            value={rankMin ?? ''}
            onChange={(e) => setPalsQuery({ ...palsQuery, rankMin: e.target.value ? Number(e.target.value) : null })}
            placeholder="min"
            className={numberInputClass}
          />
          –
          <input
            type="number"
            value={rankMax ?? ''}
            onChange={(e) => setPalsQuery({ ...palsQuery, rankMax: e.target.value ? Number(e.target.value) : null })}
            placeholder="max"
            className={numberInputClass}
          />
        </span>
        <span className="flex items-center gap-1 font-sans text-[11px] font-semibold text-muted-light">
          🏃 Run ≥
          <input
            type="number"
            value={minRunSpeed ?? ''}
            onChange={(e) => setPalsQuery({ ...palsQuery, minRunSpeed: e.target.value ? Number(e.target.value) : null })}
            placeholder="any"
            className={numberInputClass}
          />
        </span>
      </div>

      <div className={`mb-2 flex flex-wrap items-center gap-2 ${dense ? '' : 'justify-between'}`}>
        <WorkSuitabilityFilterEditor
          filters={workFilters}
          onChange={(next) => setPalsQuery({ ...palsQuery, workFilters: next })}
        />
        <select
          value={sortBy}
          onChange={(e) => setPalsQuery({ ...palsQuery, sortBy: e.target.value })}
          className="rounded-panel border-[1.5px] border-border-input bg-white px-2.5 py-[7px] font-mono text-[12px] font-semibold text-ink outline-none focus:border-primary"
        >
          {FIXED_SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {WORK_SUITABILITY_TYPES.map((w) => (
            <option key={w.id} value={w.id}>
              Sort: {w.icon} {w.label} (high → low)
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 font-sans text-[11.5px] font-semibold text-muted">{results.length} pals</div>

      {results.length === 0 ? (
        <div className="rounded-card border-[1.5px] border-dashed border-[#d8cfbf] bg-panel-subtle p-6 text-center font-sans text-[12.5px] text-muted-light">
          No pals match these filters.
        </div>
      ) : dense ? (
        <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
          {results.map((s) => (
            <div key={s.id} className="rounded-panel border border-border-card bg-white p-2">
              <div className="flex items-center gap-2">
                <PalIcon icon={s.icon} size={26} variant="card" />
                <span className="truncate font-mono text-[12.5px] font-semibold">{s.displayName}</span>
                <ElementDot elements={s.elements} size={8} />
                <span className="ml-auto flex items-center gap-1">
                  <RankPill rank={s.rank} />
                  {s.size && <Pill className="bg-panel-header text-muted-light">{s.size}</Pill>}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-light">
                {s.movement?.run !== undefined && <span>🏃 {s.movement.run}</span>}
                {s.stamina !== undefined && <span>⚡ {s.stamina}</span>}
                {s.captureRateCorrect !== undefined && <span>🎯 ×{s.captureRateCorrect}</span>}
                {s.nocturnal && <span title="Nocturnal">🌙</span>}
                {s.mountable && <span title="Mountable">🐴</span>}
              </div>
              <div className="mt-1">
                <WorkSuitabilityRow levels={workLevels(s)} max={2} />
              </div>
              {partnerSkillBySpecies.get(s.id) && (
                <div className="mt-1">
                  <PartnerSkillBadge skill={partnerSkillBySpecies.get(s.id)} />
                </div>
              )}
            </div>
          ))}
        </div>
      ) : isFull ? (
        <div className="flex flex-wrap gap-2.5">
          {results.map((s) => (
            <PalCard
              key={s.id}
              icon={s.icon}
              elements={s.elements}
              title={s.displayName}
              meta={
                <span className="inline-flex items-center gap-1.5">
                  <RankPill rank={s.rank} /> {s.size ?? ''}
                </span>
              }
            >
              <WorkSuitabilityRow levels={workLevels(s)} />
              <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-muted-light">
                {s.movement?.run !== undefined && <span>🏃 {s.movement.run}</span>}
                {s.stamina !== undefined && <span>⚡ {s.stamina}</span>}
                {s.captureRateCorrect !== undefined && <span>🎯 ×{s.captureRateCorrect}</span>}
                {s.nocturnal && <span title="Nocturnal">🌙</span>}
                {s.mountable && <span title="Mountable">🐴</span>}
              </div>
              <PartnerSkillBadge skill={partnerSkillBySpecies.get(s.id)} />
            </PalCard>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[13px] border border-border-card bg-white">
          <table className="w-full border-collapse font-mono">
            <thead>
              <tr className="text-left">
                {['Species', 'Rank', 'Rarity', 'Size', 'Work', 'Run', 'Stamina', 'Capture', 'Noct', 'Mount', 'Partner Skill'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((s) => (
                <tr key={s.id} className="border-t border-panel-header">
                  <td className="px-3 py-2.5">
                    <span className="inline-flex items-center gap-1.5">
                      <PalIcon icon={s.icon} size={20} />
                      <ElementDot elements={s.elements} />
                      <b className="whitespace-nowrap text-[12.5px]">{s.displayName}</b>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <RankPill rank={s.rank} />
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{s.rarity ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{s.size ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <WorkSuitabilityRow levels={workLevels(s)} />
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{s.movement?.run ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{s.stamina ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{s.captureRateCorrect ?? '—'}</td>
                  <td className="px-3 py-2.5 text-center text-ink-muted">{s.nocturnal ? '🌙' : ''}</td>
                  <td className="px-3 py-2.5 text-center text-ink-muted">{s.mountable ? '🐴' : ''}</td>
                  <td className="px-3 py-2.5">
                    <PartnerSkillBadge skill={partnerSkillBySpecies.get(s.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
