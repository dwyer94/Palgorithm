import { useMemo, useState } from 'react';
import type { Passive } from '../../data/schema';
import { useRulesetContext } from '../RulesetContext';
import { useSettings } from '../../store/hooks';
import { useReferenceContext } from '../ReferenceContext';
import { PassiveChip } from '../components';

const searchInputClass =
  'w-full rounded-panel border-[1.5px] border-border-input px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-primary';

function matchesSearch(passive: Passive, query: string): boolean {
  if (!query) return true;
  return passive.displayName.toLowerCase().includes(query.toLowerCase());
}

/** Selected categories show as removable pills; the ~50-strong full category list lives
 * behind a "+ category" dropdown instead of being dumped on screen at once (same shape as
 * `WorkSuitabilityFilterEditor`'s "+ work type" picker) — keeps the panel from being swamped
 * by chips when nothing is filtered yet. */
function CategoryFilterEditor({
  all,
  selected,
  onChange,
}: {
  all: string[];
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const available = all.filter((c) => !selected.includes(c));

  const add = (cat: string) => {
    onChange([...selected, cat]);
    setOpen(false);
  };
  const remove = (cat: string) => onChange(selected.filter((c) => c !== cat));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((cat) => (
        <span
          key={cat}
          className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-primary-border3 bg-primary-tint px-2.5 py-1 font-mono text-[12px] font-semibold text-primary-dark"
        >
          {cat}
          <span
            onClick={() => remove(cat)}
            className="cursor-pointer text-muted-lighter hover:text-brand-hover"
            role="button"
            aria-label={`Remove ${cat}`}
          >
            ×
          </span>
        </span>
      ))}
      {available.length > 0 && (
        <div className="relative">
          <span
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            className="cursor-pointer rounded-pill border-[1.5px] border-dashed border-border-input px-2.5 py-1 font-mono text-[12px] font-semibold text-muted outline-none hover:border-primary hover:text-primary"
          >
            + category
          </span>
          {open && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-10 max-h-64 w-[210px] overflow-y-auto rounded-panel border border-border-card bg-white shadow-dropdown">
              {available.map((cat) => (
                <div
                  key={cat}
                  onMouseDown={() => add(cat)}
                  className="cursor-pointer px-3 py-2 font-mono text-[12.5px] font-semibold hover:bg-primary-tint2"
                >
                  {cat}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Search/filter/sort over every Perk/passive in the dataset (not tied to any owned Pal).
 * Shared verbatim by the floating bubble panel and the full-screen Reference view. */
export default function PerkReferenceList({ dense = false }: { dense?: boolean }) {
  const { passives } = useRulesetContext();
  const [settings] = useSettings();
  const { perksQuery, setPerksQuery } = useReferenceContext();
  const { search, categories, sortBy } = perksQuery;

  const allCategories = useMemo(() => {
    const set = new Set<string>();
    for (const p of passives) for (const c of p.categories) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [passives]);

  const results = useMemo(() => {
    let list = passives.filter((p) => {
      if (!matchesSearch(p, search)) return false;
      if (categories.length > 0 && !p.categories.some((c) => categories.includes(c))) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      if (sortBy === 'tier') return (b.tier ?? -Infinity) - (a.tier ?? -Infinity);
      return a.displayName.localeCompare(b.displayName);
    });
    return list;
  }, [passives, search, categories, sortBy]);

  const isFull = !dense && settings.iconDisplayMode === 'full';

  return (
    <div>
      <input
        value={search}
        onChange={(e) => setPerksQuery({ ...perksQuery, search: e.target.value })}
        placeholder="Search perks…"
        className={`${searchInputClass} mb-2`}
      />

      <div className="mb-2">
        <CategoryFilterEditor
          all={allCategories}
          selected={categories}
          onChange={(next) => setPerksQuery({ ...perksQuery, categories: next })}
        />
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-sans text-[11.5px] font-semibold text-muted">{results.length} perks</span>
        <select
          value={sortBy}
          onChange={(e) => setPerksQuery({ ...perksQuery, sortBy: e.target.value as 'name' | 'tier' })}
          className="rounded-panel border-[1.5px] border-border-input bg-white px-2.5 py-[7px] font-mono text-[12px] font-semibold text-ink outline-none focus:border-primary"
        >
          <option value="name">Sort: Name (A→Z)</option>
          <option value="tier">Sort: Tier (high → low)</option>
        </select>
      </div>

      {results.length === 0 ? (
        <div className="rounded-card border-[1.5px] border-dashed border-[#d8cfbf] bg-panel-subtle p-6 text-center font-sans text-[12.5px] text-muted-light">
          No perks match these filters.
        </div>
      ) : dense ? (
        <div className="flex max-h-[420px] flex-col gap-1.5 overflow-y-auto pr-1">
          {results.map((p) => (
            <div key={p.id} className="rounded-panel border border-border-card bg-white p-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <PassiveChip label={p.displayName} tier={p.tier} description={p.description} />
                {p.categories.map((c) => (
                  <span key={c} className="rounded-chip bg-panel-header px-1.5 py-0.5 font-mono text-[9.5px] text-muted-light">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : isFull ? (
        <div className="flex flex-wrap gap-2.5">
          {results.map((p) => (
            <div key={p.id} className="flex w-[170px] flex-none flex-col items-center gap-1.5 rounded-card border border-border-card bg-white p-3 text-center shadow-card">
              <PassiveChip label={p.displayName} tier={p.tier} description={p.description} />
              <div className="flex flex-wrap justify-center gap-1">
                {p.categories.map((c) => (
                  <span key={c} className="rounded-chip bg-panel-header px-1.5 py-0.5 font-mono text-[9.5px] text-muted-light">
                    {c}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-[13px] border border-border-card bg-white">
          <table className="w-full border-collapse font-mono">
            <thead>
              <tr className="text-left">
                {['Perk', 'Tier', 'Categories', 'Description'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((p) => (
                <tr key={p.id} className="border-t border-panel-header">
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <PassiveChip label={p.displayName} tier={p.tier} description={p.description} />
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{p.tier ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {p.categories.map((c) => (
                        <span key={c} className="rounded-chip bg-panel-header px-1.5 py-0.5 font-mono text-[10px] text-muted-light">
                          {c}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="max-w-[320px] px-3 py-2.5 text-[11.5px] text-ink-muted">{p.description ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
