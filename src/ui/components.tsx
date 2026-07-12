import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ELEMENTS } from '../data/schema';
import type { Element, Gender, Species, Passive } from '../data/schema';

/**
 * Shared visual primitives (spec session 0.D handoff, docs in
 * docs/design_handoff_palgorithm_ui/README.md). These are the atoms every
 * restyled view is built from — keep visual values in sync with the design tokens in
 * tailwind.config.js rather than re-deriving them per component.
 */

const ELEMENT_COLOR: Record<Element, string> = {
  Neutral: '#9a938a',
  Fire: '#e0592a',
  Water: '#2b7fd4',
  Electric: '#e0a72a',
  Grass: '#4a9d3f',
  Dark: '#7b5ea8',
  Dragon: '#a34bd6',
  Ground: '#b07a3c',
  Ice: '#3fb0c9',
};

export function elementColor(element: Element | undefined): string {
  return element ? ELEMENT_COLOR[element] : ELEMENT_COLOR.Neutral;
}

/** A single dot for one element, or — when a species carries two — a small overlapping
 * cluster of both (design README: "two overlapping dots or a small dot cluster is
 * acceptable" for multi-element species). Pass `elements` when the full array is on hand;
 * `element` remains for single-element call sites. */
export function ElementDot({
  element,
  elements,
  size = 9,
}: {
  element?: Element | undefined;
  elements?: Element[] | undefined;
  size?: number;
}) {
  const list = elements && elements.length > 0 ? elements : element ? [element] : [];
  if (list.length <= 1) {
    return (
      <span
        className="inline-block flex-none rounded-full"
        style={{ width: size, height: size, background: elementColor(list[0]) }}
      />
    );
  }
  const overlap = Math.round(size * 0.55);
  return (
    <span className="relative inline-block flex-none" style={{ width: size + overlap, height: size }}>
      <span
        className="absolute rounded-full ring-1 ring-white"
        style={{ left: 0, top: 0, width: size, height: size, background: elementColor(list[0]) }}
      />
      <span
        className="absolute rounded-full ring-1 ring-white"
        style={{ left: overlap, top: 0, width: size, height: size, background: elementColor(list[1]) }}
      />
    </span>
  );
}

export function GenderGlyph({ gender, className }: { gender: Gender | null | undefined; className?: string }) {
  const glyph = gender === 'male' ? '♂' : gender === 'female' ? '♀' : '?';
  return <span className={className ?? 'font-mono text-[11px] text-muted-lighter'}>{glyph}</span>;
}

/**
 * Palworld's 12 work-suitability types, in the game's own UI order. Not schema-validated
 * (species.workSuitabilities.type is a free string, so unfamiliar dataset rows still fall
 * back gracefully in `workSuitabilityMeta` below) — this is purely a display mapping, same
 * spirit as `ELEMENT_COLOR` above.
 */
export interface WorkSuitabilityMeta {
  id: string;
  label: string;
  icon: string;
}

export const WORK_SUITABILITY_TYPES: WorkSuitabilityMeta[] = [
  { id: 'EmitFlame', label: 'Kindling', icon: '🔥' },
  { id: 'Watering', label: 'Watering', icon: '💧' },
  { id: 'Seeding', label: 'Planting', icon: '🌱' },
  { id: 'GenerateElectricity', label: 'Electricity', icon: '⚡' },
  { id: 'Handcraft', label: 'Handiwork', icon: '🔨' },
  { id: 'Collection', label: 'Gathering', icon: '🧺' },
  { id: 'Deforest', label: 'Lumbering', icon: '🪓' },
  { id: 'Mining', label: 'Mining', icon: '⛏' },
  { id: 'ProductMedicine', label: 'Medicine', icon: '💊' },
  { id: 'Transport', label: 'Transporting', icon: '📦' },
  { id: 'MonsterFarm', label: 'Farming', icon: '🌾' },
  { id: 'Cool', label: 'Cooling', icon: '❄' },
];

const WORK_SUITABILITY_BY_ID = new Map(WORK_SUITABILITY_TYPES.map((w) => [w.id, w]));

export function workSuitabilityMeta(id: string): WorkSuitabilityMeta {
  return WORK_SUITABILITY_BY_ID.get(id) ?? { id, label: id, icon: '❔' };
}

/** Compact "icon + level" badge for one work type. `dim` mirrors `PassiveChip`'s dim variant —
 * used to fade out types that aren't the one currently filtered/sorted on, without hiding them. */
export function WorkSuitabilityBadge({ id, level, dim = false }: { id: string; level: number; dim?: boolean }) {
  const meta = workSuitabilityMeta(id);
  return (
    <span
      title={`${meta.label} ${level}`}
      className={`inline-flex items-center gap-[3px] rounded-chip border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
        dim ? 'border-border-inner bg-[#f2ece0] text-muted opacity-60' : 'border-primary-border3 bg-primary-tint text-primary-dark'
      }`}
    >
      <span aria-hidden>{meta.icon}</span>
      {level}
    </span>
  );
}

/**
 * Row of `WorkSuitabilityBadge`s for one Pal, highest level first, zero-levels omitted, capped
 * at `max` badges (a Pal can carry up to 12 work types — left uncapped this column's width
 * would balloon and vary wildly row to row). Any `highlight`ed type (the active filter/sort)
 * is always kept visible even if it'd otherwise be bumped by the cap, then the remaining slots
 * fill with the next-highest levels; everything past the cap collapses into a "+N" pill.
 * `highlight` also dims every visible badge that isn't in the set. */
export function WorkSuitabilityRow({
  levels,
  highlight,
  max = 3,
}: {
  levels: Record<string, number>;
  highlight?: Set<string> | undefined;
  max?: number;
}) {
  const entries = Object.entries(levels)
    .filter(([, level]) => level > 0)
    .sort(([a, la], [b, lb]) => lb - la || a.localeCompare(b));
  if (entries.length === 0) return null;

  const priority = highlight
    ? [...entries.filter(([id]) => highlight.has(id)), ...entries.filter(([id]) => !highlight.has(id))]
    : entries;
  const shown = priority.slice(0, max);
  const hiddenCount = entries.length - shown.length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map(([id, level]) => (
        <WorkSuitabilityBadge key={id} id={id} level={level} dim={highlight ? !highlight.has(id) : false} />
      ))}
      {hiddenCount > 0 && (
        <span
          title={entries
            .slice(shown.length)
            .map(([id, level]) => `${workSuitabilityMeta(id).label} ${level}`)
            .join(', ')}
          className="rounded-chip border border-border-inner bg-[#f2ece0] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted"
        >
          +{hiddenCount}
        </span>
      )}
    </div>
  );
}

/**
 * A Pal's icon (from the dataset's `species.icon`, populated by the extraction pipeline —
 * see normalize.ts). Renders a blank placeholder tile rather than nothing when a species
 * has no icon (missing extraction), so layouts never jump between icon/no-icon rows.
 * `variant="card"` adds the bordered tile used by the "full" list layouts (Roster/Server
 * Pals/Hub candidates); `variant="inline"` (default) is the small icon used everywhere else.
 */
export function PalIcon({
  icon,
  size = 20,
  variant = 'inline',
  className = '',
}: {
  icon?: string | undefined;
  size?: number;
  variant?: 'inline' | 'card';
  className?: string;
}) {
  const frame =
    variant === 'card'
      ? 'rounded-lg border border-border-card bg-panel-inset p-1'
      : 'rounded-[5px] bg-panel-inset';
  return (
    <span
      className={`inline-flex flex-none items-center justify-center overflow-hidden ${frame} ${className}`}
      style={{ width: size, height: size }}
    >
      {icon && <img src={icon} alt="" width={size} height={size} className="h-full w-full object-contain" loading="lazy" />}
    </span>
  );
}

/** Square Pal card used by the "full" display mode for list views (Roster/Server Pals/Hub
 * candidates) — a larger icon plus title/meta, with a slot for view-specific extras
 * (passives, actions, …) so each list keeps its own fields. */
export function PalCard({
  icon,
  elements,
  title,
  meta,
  selected,
  onClick,
  children,
  className = '',
}: {
  icon?: string | undefined;
  elements?: Element[] | undefined;
  title: ReactNode;
  meta?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex w-[150px] flex-none flex-col items-center gap-1.5 rounded-card border bg-white p-3 text-center shadow-card ${
        selected ? 'border-[1.5px] border-primary shadow-elevated-blue' : 'border-border-card'
      } ${onClick ? 'cursor-pointer hover:border-muted-lighter' : ''} ${className}`}
    >
      <PalIcon icon={icon} size={56} variant="card" />
      <div className="flex max-w-full items-center gap-1 font-mono text-[12.5px] font-semibold leading-tight">
        <ElementDot elements={elements} size={7} />
        <span className="truncate">{title}</span>
      </div>
      {meta && <div className="font-mono text-[10.5px] text-muted">{meta}</div>}
      {children}
    </div>
  );
}

/** Small rounded badge — "baseline", "best", "hub", counts, etc. */
export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span className={`rounded-pill px-[7px] py-[2px] font-sans text-[10px] font-semibold ${className}`}>{children}</span>
  );
}

export function RankPill({ rank }: { rank: number | null | undefined }) {
  if (rank === null || rank === undefined) return null;
  return <span className="rounded font-mono text-[10px] font-medium text-[#9a7b3a] bg-[#f0e8d7] px-[5px] py-[1px]">r{rank}</span>;
}

/**
 * Passive rank theming — in-game, a passive's name tag is filled with a rank-colored
 * gradient rather than a plain flat chip. Confirmed reference points (per-tier screenshots):
 * tier 3 ("Ice Emperor") is a gold/amber gradient, and tier 4 — the "Rainbow tier" the game's
 * own patch notes name for its top passives (Legend, Swift, Lucky, Demon God, …) — is in
 * practice a subtle iridescent blue-into-purple sheen, not a literal rainbow. Tiers 1/2 and
 * the negative tiers aren't documented anywhere in text form (screenshot-only UI), so they're
 * interpolated: white→champagne→gold for the positive ramp, red shades scaled by severity for
 * the negative ramp (matches the "gold = great / white = normal / red = detrimental" framing
 * used across community guides).
 */
interface PassiveTierStyle {
  background: string;
  color: string;
  borderColor: string;
}

const PASSIVE_TIER_STYLE: Record<number, PassiveTierStyle> = {
  4: { background: 'linear-gradient(120deg, #7fb8ea, #9c8ce8 55%, #b57fe0)', color: '#ffffff', borderColor: 'rgba(255,255,255,.55)' },
  3: { background: 'linear-gradient(120deg, #f0c04c, #d69a1f)', color: '#3a2a06', borderColor: 'rgba(255,255,255,.45)' },
  2: { background: 'linear-gradient(120deg, #e8d9a8, #d1b877)', color: '#3a2f14', borderColor: 'rgba(255,255,255,.4)' },
  1: { background: 'linear-gradient(120deg, #f2ede1, #d9d0bd)', color: '#3a3527', borderColor: 'rgba(255,255,255,.5)' },
  '-1': { background: 'linear-gradient(120deg, #d9a3a0, #c17d79)', color: '#33110f', borderColor: 'rgba(255,255,255,.4)' },
  '-2': { background: 'linear-gradient(120deg, #d9584f, #b8362f)', color: '#fff2f0', borderColor: 'rgba(255,255,255,.4)' },
  '-3': { background: 'linear-gradient(120deg, #b8362f, #7a211c)', color: '#fff2f0', borderColor: 'rgba(255,255,255,.35)' },
};

export function passiveTierTitle(tier: number | undefined): string | undefined {
  if (tier === undefined) return undefined;
  if (tier === 4) return 'Rainbow tier';
  return `Tier ${tier > 0 ? '+' : ''}${tier}`;
}

function passiveTierStyle(tier: number | undefined): PassiveTierStyle | undefined {
  return tier === undefined ? undefined : PASSIVE_TIER_STYLE[tier];
}

/**
 * Generic hover/focus tooltip, rendered via portal so it's never clipped by an ancestor's
 * `overflow-hidden` (several hosts — cards, dropdowns — have one). Themed to match the
 * `Dropdown` floating panel (white/border-card/shadow-dropdown). Originally built for passive
 * effect text (`PassiveChip` below); reused wherever a couple sentences of hover explanation
 * beat cluttering the UI with permanent copy.
 */
export function HoverTooltip({ description, children }: { description?: string | undefined; children: ReactNode }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  if (!description) return <>{children}</>;

  const show = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPos({ top: rect.top - 6, left: rect.left + rect.width / 2 });
  };
  const hide = () => setPos(null);

  return (
    <span
      ref={anchorRef}
      tabIndex={0}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      className="inline-flex outline-none focus-visible:ring-2 focus-visible:ring-primary-border2 rounded-chip"
    >
      {children}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className="pointer-events-none fixed z-[70] max-w-[240px] -translate-x-1/2 -translate-y-full whitespace-pre-line rounded-panel border border-border-card bg-white px-3 py-2 font-sans text-[11.5px] leading-snug text-ink shadow-dropdown"
            style={{ top: pos.top, left: pos.left }}
          >
            {description}
          </div>,
          document.body,
        )}
    </span>
  );
}

type PassiveChipVariant = 'default' | 'matched' | 'dim' | 'warn';

const PASSIVE_CHIP_STYLE: Record<PassiveChipVariant, string> = {
  default: 'bg-primary-tint3 text-primary-chipText border-primary-border',
  matched: 'bg-primary text-white border-primary',
  dim: 'bg-[#f2ece0] text-muted border-border-inner',
  warn: 'bg-provisional-bg text-provisional-text border-provisional-border',
};

const PASSIVE_CHIP_VARIANT_ACCENT: Record<PassiveChipVariant, string> = {
  default: '',
  matched: 'ring-2 ring-[#3f7fe0] ring-offset-1',
  dim: 'opacity-55',
  warn: 'ring-2 ring-provisional-border',
};

export function PassiveChip({
  label,
  tier,
  description,
  variant = 'default',
  onRemove,
  className = '',
}: {
  label: string;
  tier?: number | undefined;
  description?: string | undefined;
  variant?: PassiveChipVariant | undefined;
  onRemove?: () => void;
  className?: string;
}) {
  const tierStyle = passiveTierStyle(tier);

  if (tierStyle) {
    return (
      <HoverTooltip description={description}>
        <span
          title={description ? undefined : passiveTierTitle(tier)}
          className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 font-mono text-[11px] font-semibold ${PASSIVE_CHIP_VARIANT_ACCENT[variant]} ${className}`}
          style={{ background: tierStyle.background, color: tierStyle.color, borderColor: tierStyle.borderColor }}
        >
          {label}
          {onRemove && (
            <span onClick={onRemove} className="cursor-pointer opacity-80 hover:opacity-100" role="button" aria-label={`Remove ${label}`}>
              ×
            </span>
          )}
        </span>
      </HoverTooltip>
    );
  }

  return (
    <HoverTooltip description={description}>
      <span
        className={`inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 font-mono text-[11px] font-semibold ${PASSIVE_CHIP_STYLE[variant]} ${className}`}
      >
        {label}
        {onRemove && (
          <span
            onClick={onRemove}
            className="cursor-pointer text-[#9aa6d8]"
            role="button"
            aria-label={`Remove ${label}`}
          >
            ×
          </span>
        )}
      </span>
    </HoverTooltip>
  );
}

export function ProvisionalTag({ variant = 'pill' }: { variant?: 'pill' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <span className="rounded font-mono text-[11px] font-semibold text-provisional-text bg-provisional-bg border border-provisional-border px-[5px]">
        est.
      </span>
    );
  }
  return (
    <span className="rounded-[5px] font-mono text-[9.5px] font-semibold uppercase tracking-[.4px] text-provisional-text bg-provisional-bg border border-provisional-border px-[7px] py-[2px]">
      ⚠ provisional estimate
    </span>
  );
}

export function ComboCount({
  value,
  caption,
  meta,
  valueClassName = 'text-ink',
}: {
  value: ReactNode;
  caption: ReactNode;
  meta?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-end gap-3">
      <div className={`font-mono font-bold text-[52px] leading-[0.85] tracking-[-3px] ${valueClassName}`}>{value}</div>
      <div className="pb-1.5">
        <div className="text-[12px] text-muted">{caption}</div>
        {meta && <div className="font-mono text-[12px] font-medium text-muted">{meta}</div>}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`relative h-[25px] w-11 flex-none cursor-pointer rounded-pill transition-colors ${on ? 'bg-success-dot' : 'bg-border-input'}`}
    >
      <div
        className={`absolute top-[2.5px] h-5 w-5 rounded-full bg-white shadow transition-[right,left] ${on ? 'right-[2.5px]' : 'left-[2.5px]'}`}
      />
    </div>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-panel bg-[#f0ece2] p-[3px]">
      {options.map((opt) => (
        <div
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`cursor-pointer rounded-[7px] px-[15px] py-[6px] font-sans text-[12.5px] font-semibold ${
            value === opt.value ? 'bg-white text-ink-strong shadow-node' : 'text-muted'
          }`}
        >
          {opt.label}
        </div>
      ))}
    </div>
  );
}

// --- Nav / sidebar --------------------------------------------------------------------

export interface NavItem {
  key: string;
  label: string;
  icon: string;
}

export const PLAN_NAV_ITEMS: NavItem[] = [
  { key: 'single', label: 'Single target', icon: '◇' },
  { key: 'hub', label: 'Hub planner', icon: '◈' },
  { key: 'saved', label: 'Saved plans', icon: '★' },
];

const ROSTER_NAV_ITEM: NavItem = { key: 'roster', label: 'Roster', icon: '▤' };
const SERVER_NAV_ITEM: NavItem = { key: 'server', label: 'Server pals', icon: '⛭' };
export const DATA_NAV_ITEMS: NavItem[] = [ROSTER_NAV_ITEM, SERVER_NAV_ITEM];

export const UTILITY_NAV_ITEMS: NavItem[] = [
  { key: 'forward', label: 'Forward calc', icon: '→' },
  { key: 'reverse', label: 'Reverse lookup', icon: '←' },
  { key: 'reference', label: 'Reference', icon: '⌕' },
];

function NavRow({
  item,
  active,
  badge,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  badge?: ReactNode;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] ${
        active ? 'bg-brand font-semibold text-sidebar-bg' : 'text-sidebar-text hover:bg-sidebar-hover'
      }`}
    >
      <span>{item.icon}</span>
      <span>{item.label}</span>
      {badge}
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-5 pb-[7px] pt-4 font-sans text-[10px] font-semibold uppercase tracking-[1.2px] text-sidebar-label">
      {children}
    </div>
  );
}

export function BrandMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <circle cx="6" cy="7" r="3.2" stroke="#e8813a" strokeWidth="1.8" />
      <circle cx="18" cy="7" r="3.2" stroke="#8fb8ff" strokeWidth="1.8" />
      <circle cx="12" cy="17.5" r="3.6" fill="#e8813a" />
      <path d="M8.2 8.6 10.4 14.4M15.8 8.6 13.6 14.4" stroke="#6b665c" strokeWidth="1.6" />
    </svg>
  );
}

function IconModeToggle({
  mode,
  onChange,
}: {
  mode: 'compact' | 'full';
  onChange: (mode: 'compact' | 'full') => void;
}) {
  const options: { value: 'compact' | 'full'; label: string; title: string }[] = [
    { value: 'compact', label: '☰ Compact', title: 'Compact — text rows with a small icon' },
    { value: 'full', label: '▦ Full', title: 'Full — larger Pal icon cards' },
  ];
  return (
    <div className="flex rounded-lg bg-sidebar-hover p-[3px]">
      {options.map((opt) => (
        <span
          key={opt.value}
          onClick={() => onChange(opt.value)}
          title={opt.title}
          className={`flex-1 cursor-pointer rounded-[6px] py-[5px] text-center font-sans text-[11px] font-semibold ${
            mode === opt.value ? 'bg-brand text-sidebar-bg' : 'text-sidebar-text hover:text-[#f4f1ea]'
          }`}
        >
          {opt.label}
        </span>
      ))}
    </div>
  );
}

export function Sidebar({
  active,
  onSelect,
  rosterCount,
  serverOnCount,
  iconMode,
  onIconModeChange,
}: {
  active: string;
  onSelect: (key: string) => void;
  rosterCount: number;
  serverOnCount: number;
  iconMode: 'compact' | 'full';
  onIconModeChange: (mode: 'compact' | 'full') => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  const select = (key: string) => {
    onSelect(key);
    setMobileOpen(false);
  };

  return (
    <>
      {/* mobile top bar — hidden on desktop, where the nav below is always visible */}
      <div className="flex flex-none items-center justify-between bg-sidebar-bg px-4 py-3 text-sidebar-text md:hidden">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div className="font-sans text-[17px] font-bold tracking-[-.3px] text-[#f4f1ea]">Palgorithm</div>
        </div>
        <span
          onClick={() => setMobileOpen(true)}
          role="button"
          aria-label="Open menu"
          className="cursor-pointer px-1 text-[22px] leading-none text-[#f4f1ea]"
        >
          ☰
        </span>
      </div>

      {/* drawer overlay — mobile only, dismisses the drawer on tap */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}

      <nav
        className={`fixed inset-y-0 left-0 z-50 flex w-[212px] flex-none flex-col overflow-y-auto bg-sidebar-bg pb-3 text-sidebar-text transition-transform duration-200 ease-in-out md:static md:z-auto md:translate-x-0 ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2.5 px-[18px] pb-[18px] pt-5">
          <BrandMark />
          <div className="font-sans text-[17px] font-bold tracking-[-.3px] text-[#f4f1ea]">Palgorithm</div>
        </div>

        <SectionLabel>Plan</SectionLabel>
        <div className="flex flex-col gap-0.5 px-2.5">
          {PLAN_NAV_ITEMS.map((item) => (
            <NavRow key={item.key} item={item} active={active === item.key} onClick={() => select(item.key)} />
          ))}
        </div>

        <SectionLabel>Data</SectionLabel>
        <div className="flex flex-col gap-0.5 px-2.5">
          <NavRow
            item={ROSTER_NAV_ITEM}
            active={active === 'roster'}
            onClick={() => select('roster')}
            badge={<span className="ml-auto font-mono text-[11px] font-medium text-muted">{rosterCount}</span>}
          />
          <NavRow
            item={SERVER_NAV_ITEM}
            active={active === 'server'}
            onClick={() => select('server')}
            badge={
              serverOnCount > 0 ? (
                <span
                  className={`ml-auto rounded-pill px-1.5 py-px font-mono text-[10px] font-semibold ${
                    active === 'server' ? 'bg-sidebar-bg text-[#e8c9a8]' : 'bg-success-text text-[#cdeddb]'
                  }`}
                >
                  {serverOnCount} on
                </span>
              ) : undefined
            }
          />
        </div>

        <SectionLabel>Utilities</SectionLabel>
        <div className="flex flex-col gap-0.5 px-2.5">
          {UTILITY_NAV_ITEMS.map((item) => (
            <NavRow key={item.key} item={item} active={active === item.key} onClick={() => select(item.key)} />
          ))}
        </div>

        <div className="mt-auto px-2.5">
          <div className="mb-2 px-0.5">
            <IconModeToggle mode={iconMode} onChange={onIconModeChange} />
          </div>
          <div
            onClick={() => select('settings')}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-[9px] text-[13.5px] ${
              active === 'settings' ? 'bg-brand font-semibold text-sidebar-bg' : 'text-muted hover:bg-sidebar-hover'
            }`}
          >
            <span>⚙</span>
            <span>Settings</span>
          </div>
        </div>
      </nav>
    </>
  );
}

// --- PalNode (plan graph/list atom) ---------------------------------------------------

export type PalNodeVariant = 'leaf' | 'bred' | 'shared' | 'hub' | 'target';

const PAL_NODE_STYLE: Record<PalNodeVariant, string> = {
  leaf: 'bg-white border-[1.5px] border-dashed border-muted-lighter shadow-node',
  bred: 'bg-white border-[1.5px] border-[#26241f] shadow-node',
  shared: 'bg-shared-bg border-[1.6px] border-shared shadow-[0_2px_5px_rgba(210,105,30,.15)]',
  hub: 'bg-primary-tint border-[1.6px] border-primary shadow-elevated-blue',
  target: 'bg-[#fbf3e0] border-2 border-[#14120e] shadow-[0_2px_5px_rgba(0,0,0,.1)]',
};

export interface PalNodeProps {
  species: string;
  icon?: string | undefined;
  element?: Element | undefined;
  elements?: Element[] | undefined;
  gender: Gender | null | undefined;
  variant: PalNodeVariant;
  subLabel: ReactNode;
  subLabelClassName?: string;
  passiveChips?:
    | {
        id: string;
        label: string;
        tier?: number | undefined;
        description?: string | undefined;
        /** Which perk-landing bucket this chip belongs to (default: plain). */
        chipVariant?: 'matched' | 'warn' | undefined;
        /** The node id (graph-layout `PlanGraphNode.id`) that actually supplies this
         * passive, if known — hovering the chip reports this via `onChipHover` so the
         * caller can light up that node's lineage the same way node-hover already does. */
        sourceNodeId?: string | undefined;
      }[]
    | undefined;
  onChipHover?: ((nodeId: string | null) => void) | undefined;
  genderLabel?: string;
  style?: React.CSSProperties;
  width?: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function PalNode({
  species,
  icon,
  element,
  elements,
  gender,
  variant,
  subLabel,
  subLabelClassName = 'text-muted',
  passiveChips,
  onChipHover,
  genderLabel,
  style,
  width = 150,
  onMouseEnter,
  onMouseLeave,
}: PalNodeProps) {
  const isTarget = variant === 'target';
  return (
    <div
      className={`rounded-node px-2.5 py-[7px] transition-[opacity,box-shadow] duration-150 ${PAL_NODE_STYLE[variant]}`}
      style={{ width, ...style }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <PalIcon icon={icon} size={18} />
          <span className={`truncate font-mono text-[12.5px] font-semibold ${isTarget ? 'text-ink-strong' : 'text-ink-strong'}`}>
            {species}
            {isTarget && ' ✦'}
          </span>
        </span>
        <span className="font-mono text-[11px] text-muted-lighter">{genderLabel ?? <GenderGlyph gender={gender} />}</span>
      </div>
      {passiveChips && passiveChips.length > 0 ? (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {passiveChips.map((p) => (
            <span
              key={p.id}
              onMouseEnter={p.sourceNodeId && onChipHover ? () => onChipHover(p.sourceNodeId!) : undefined}
              onMouseLeave={p.sourceNodeId && onChipHover ? () => onChipHover(null) : undefined}
            >
              <PassiveChip
                label={p.label}
                tier={p.tier}
                description={p.description}
                variant={p.chipVariant}
                className="px-1 py-0 text-[9px] leading-[14px]"
              />
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-[3px] flex items-center gap-[5px]">
          <ElementDot element={element} elements={elements} size={8} />
          <span className={`font-mono text-[10px] font-medium ${subLabelClassName}`}>{subLabel}</span>
        </div>
      )}
    </div>
  );
}

// --- Species / passive controls -------------------------------------------------------

const inputClass =
  'w-full rounded-panel border-[1.5px] border-border-input px-3 py-2 font-mono text-[13px] text-ink outline-none focus:border-primary';

function Dropdown({ children }: { children: ReactNode }) {
  return (
    <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-80 overflow-y-auto rounded-panel border border-border-card bg-white shadow-dropdown">
      {children}
    </div>
  );
}

function DropdownRow({ onPick, children }: { onPick: () => void; children: ReactNode }) {
  return (
    <div
      onMouseDown={onPick}
      className="flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[12.5px] font-semibold hover:bg-primary-tint2"
    >
      {children}
    </div>
  );
}

// --- Species filter bar (rank + element + reachability, used by SpeciesSelect/Typeahead) -

type ReachFilter = 'all' | 'breedable' | 'catchable' | 'special';

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

function useSpeciesFilterState() {
  const [elements, setElements] = useState<Set<Element>>(new Set());
  const [reach, setReach] = useState<ReachFilter>('all');
  const toggleElement = (el: Element) =>
    setElements((prev) => {
      const next = new Set(prev);
      if (next.has(el)) next.delete(el);
      else next.add(el);
      return next;
    });
  const matches = (s: Species) => {
    if (elements.size > 0 && !s.elements.some((e) => elements.has(e))) return false;
    if (reach !== 'all' && speciesReachability(s) !== reach) return false;
    return true;
  };
  return { elements, reach, toggleElement, setReach, matches, active: elements.size > 0 || reach !== 'all' };
}

function SpeciesFilterBar({ state }: { state: ReturnType<typeof useSpeciesFilterState> }) {
  return (
    <div
      onMouseDown={(e) => e.preventDefault()}
      className="sticky top-0 flex flex-wrap items-center gap-1.5 border-b border-border-divider bg-panel-inset px-2.5 py-1.5"
    >
      {ELEMENTS.map((el) => (
        <span
          key={el}
          onMouseDown={() => state.toggleElement(el)}
          title={el}
          className="cursor-pointer rounded-full p-[3px]"
          style={{ boxShadow: state.elements.has(el) ? `0 0 0 1.5px ${elementColor(el)}` : 'none' }}
        >
          <ElementDot element={el} size={9} />
        </span>
      ))}
      <span className="mx-1 h-3.5 w-px flex-none bg-border-inner" />
      {REACH_OPTIONS.map((opt) => (
        <span
          key={opt.value}
          onMouseDown={() => state.setReach(opt.value)}
          className={`cursor-pointer rounded-[5px] px-1.5 py-0.5 font-sans text-[10.5px] font-semibold ${
            state.reach === opt.value ? 'bg-primary text-white' : 'text-muted hover:bg-panel-header'
          }`}
        >
          {opt.label}
        </span>
      ))}
    </div>
  );
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
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filterState = useSpeciesFilterState();
  const current = species.find((s) => s.id === value);

  const matches = useMemo(() => {
    const sorted = species.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
    const q = query.toLowerCase();
    return sorted.filter((s) => (!q || s.displayName.toLowerCase().includes(q)) && filterState.matches(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, species, filterState.elements, filterState.reach]);

  const displayValue = open ? query : (current?.displayName ?? (allowEmpty ? '' : ''));

  return (
    <div className="relative">
      <input
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setQuery('');
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={allowEmpty ? '(none)' : 'Type a species…'}
        className={inputClass}
      />
      {open && (
        <Dropdown>
          <SpeciesFilterBar state={filterState} />
          {allowEmpty && (
            <DropdownRow
              onPick={() => {
                onChange('');
                setOpen(false);
              }}
            >
              (none)
            </DropdownRow>
          )}
          {matches.map((s) => (
            <DropdownRow
              key={s.id}
              onPick={() => {
                onChange(s.id);
                setOpen(false);
              }}
            >
              <PalIcon icon={s.icon} size={20} />
              <ElementDot elements={s.elements} />
              {s.displayName}
              <span className="ml-auto">
                <RankPill rank={s.rank} />
              </span>
            </DropdownRow>
          ))}
          {matches.length === 0 && <div className="px-3 py-2.5 font-sans text-[12px] text-muted">No species match.</div>}
        </Dropdown>
      )}
    </div>
  );
}

/** Standalone typeahead used by "add a target species" style affordances — unlike
 * `SpeciesSelect`, there's no persistent selected value; each pick fires `onPick` and the
 * caller decides what happens (e.g. append to a list). */
export function SpeciesTypeahead({
  species,
  onPick,
  placeholder = 'Type a species…',
  autoFocus,
  exclude,
}: {
  species: Species[];
  onPick: (id: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  exclude?: Set<string>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const filterState = useSpeciesFilterState();

  const matches = useMemo(() => {
    const sorted = species.slice().sort((a, b) => a.displayName.localeCompare(b.displayName));
    const q = query.toLowerCase();
    return sorted.filter((s) => !exclude?.has(s.id) && (!q || s.displayName.toLowerCase().includes(q)) && filterState.matches(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, species, exclude, filterState.elements, filterState.reach]);

  return (
    <div className="relative">
      <input
        autoFocus={autoFocus}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={placeholder}
        className={inputClass}
      />
      {open && (
        <Dropdown>
          <SpeciesFilterBar state={filterState} />
          {matches.map((s) => (
            <DropdownRow
              key={s.id}
              onPick={() => {
                onPick(s.id);
                setQuery('');
                setOpen(false);
              }}
            >
              <PalIcon icon={s.icon} size={20} />
              <ElementDot elements={s.elements} />
              {s.displayName}
              <span className="ml-auto">
                <RankPill rank={s.rank} />
              </span>
            </DropdownRow>
          ))}
          {matches.length === 0 && <div className="px-3 py-2.5 font-sans text-[12px] text-muted">No species match.</div>}
        </Dropdown>
      )}
    </div>
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
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = new Set(value);

  const matches = useMemo(() => {
    const q = query.toLowerCase();
    return passives.filter((p) => !selected.has(p.id) && (!q || p.displayName.toLowerCase().includes(q)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, passives, value]);

  /** Grouped by category (design README: "search/group-by-tier/group-by-category picker"),
   * tier-then-name ordered within each group. A passive with more than one category (e.g.
   * "Legend" boosts Attack + Defense + Move Speed) is listed under every one of them, not
   * just the first — so filtering by any of its effects finds it. */
  const grouped = useMemo(() => {
    const groups = new Map<string, Passive[]>();
    for (const p of matches) {
      const cats = p.categories.length > 0 ? p.categories : ['Other'];
      for (const cat of cats) {
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(p);
      }
    }
    for (const list of groups.values()) {
      list.sort((a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.displayName.localeCompare(b.displayName));
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [matches]);

  const byId = useMemo(() => new Map(passives.map((p) => [p.id, p])), [passives]);
  const remove = (id: string) => onChange(value.filter((v) => v !== id));
  const add = (id: string) => {
    onChange([...value, id]);
    setQuery('');
  };

  // Advisory only, never a block — the game's actual tier-stacking rules aren't verified
  // data (CLAUDE.md: don't invent domain rules), so this just surfaces "these two share a
  // category" for the user to judge, e.g. two tiers of the same Crafting Speed line.
  const categoryConflicts = useMemo(() => {
    const byCategory = new Map<string, Passive[]>();
    for (const id of value) {
      const p = byId.get(id);
      if (!p) continue;
      for (const cat of p.categories.length > 0 ? p.categories : ['Other']) {
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat)!.push(p);
      }
    }
    return Array.from(byCategory.entries()).filter(([, list]) => list.length >= 2);
  }, [value, byId]);

  return (
    <div className="relative">
      <div className="flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-panel border-[1.5px] border-border-input bg-white px-2 py-1.5">
        {value.map((id) => (
          <PassiveChip
            key={id}
            label={byId.get(id)?.displayName ?? id}
            tier={byId.get(id)?.tier}
            description={byId.get(id)?.description}
            onRemove={() => remove(id)}
          />
        ))}
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="add a trait…"
          className="min-w-[110px] flex-1 border-0 bg-transparent font-mono text-[12.5px] text-ink outline-none"
        />
      </div>
      {categoryConflicts.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {categoryConflicts.map(([category, list]) => (
            <div
              key={category}
              className="flex items-start gap-1.5 rounded-panel border border-[#e9d9a8] bg-unresolved-bg2 px-2.5 py-1.5 font-sans text-[11.5px] font-medium text-provisional-text"
            >
              <span>ⓘ</span>
              <span>
                {list.map((p) => p.displayName).join(' and ')} are all {category} passives — confirm they can coexist on one Pal before
                relying on this plan.
              </span>
            </div>
          ))}
        </div>
      )}
      {open && matches.length > 0 && (
        <Dropdown>
          {grouped.map(([category, list]) => (
            <div key={category}>
              <div className="sticky top-0 bg-panel-inset px-3 py-1 font-sans text-[9.5px] font-semibold uppercase tracking-wide text-muted-light">
                {category}
              </div>
              {list.map((p) => (
                <DropdownRow key={`${category}:${p.id}`} onPick={() => add(p.id)}>
                  <PassiveChip label={p.displayName} tier={p.tier} description={p.description} className="pointer-events-none" />
                  {p.tier !== undefined && <span className="ml-auto font-mono text-[10px] font-normal text-muted">tier {p.tier}</span>}
                </DropdownRow>
              ))}
            </div>
          ))}
        </Dropdown>
      )}
    </div>
  );
}

// --- Work suitability filter/sort controls ---------------------------------------------

export interface WorkSuitabilityFilter {
  type: string;
  minLevel: number;
}

/** "Add a work-type requirement" editor — chips of `type ≥ N` with an inline +/− stepper,
 * plus a dropdown to add another type not already filtered on. Mirrors `PassiveMultiSelect`'s
 * add/remove/blur-to-close pattern, but each chip also carries its own numeric threshold. */
export function WorkSuitabilityFilterEditor({
  filters,
  onChange,
}: {
  filters: WorkSuitabilityFilter[];
  onChange: (next: WorkSuitabilityFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const usedTypes = new Set(filters.map((f) => f.type));
  const available = WORK_SUITABILITY_TYPES.filter((w) => !usedTypes.has(w.id));

  const add = (id: string) => {
    onChange([...filters, { type: id, minLevel: 1 }]);
    setOpen(false);
  };
  const remove = (type: string) => onChange(filters.filter((f) => f.type !== type));
  const setMinLevel = (type: string, minLevel: number) =>
    onChange(filters.map((f) => (f.type === type ? { ...f, minLevel: Math.max(1, Math.min(5, minLevel)) } : f)));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => {
        const meta = workSuitabilityMeta(f.type);
        return (
          <span
            key={f.type}
            className="inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-primary-border3 bg-primary-tint px-2.5 py-1 font-mono text-[12px] font-semibold text-primary-dark"
          >
            <span aria-hidden>{meta.icon}</span>
            {meta.label}
            <span className="flex items-center gap-0.5">
              <span
                onClick={() => setMinLevel(f.type, f.minLevel - 1)}
                className="cursor-pointer px-1 text-muted-light hover:text-brand-hover"
                role="button"
                aria-label={`Lower minimum ${meta.label} level`}
              >
                −
              </span>
              <span className="min-w-[14px] text-center">≥{f.minLevel}</span>
              <span
                onClick={() => setMinLevel(f.type, f.minLevel + 1)}
                className="cursor-pointer px-1 text-muted-light hover:text-brand-hover"
                role="button"
                aria-label={`Raise minimum ${meta.label} level`}
              >
                +
              </span>
            </span>
            <span
              onClick={() => remove(f.type)}
              className="cursor-pointer text-[14px] text-muted-lighter hover:text-brand-hover"
              role="button"
              aria-label={`Remove ${meta.label} filter`}
            >
              ×
            </span>
          </span>
        );
      })}
      {available.length > 0 && (
        <div className="relative">
          <span
            tabIndex={0}
            onClick={() => setOpen((o) => !o)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            className="cursor-pointer rounded-pill border-[1.5px] border-dashed border-border-input px-2.5 py-1 font-mono text-[12px] font-semibold text-muted outline-none hover:border-primary hover:text-primary"
          >
            + work type
          </span>
          {open && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-10 max-h-64 w-[190px] overflow-y-auto rounded-panel border border-border-card bg-white shadow-dropdown">
              {available.map((w) => (
                <DropdownRow key={w.id} onPick={() => add(w.id)}>
                  <span aria-hidden>{w.icon}</span>
                  {w.label}
                </DropdownRow>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Native `<select>` for "sort results by this work type's effective level, descending" — kept
 * a plain select (rather than the custom `Dropdown`) since it's a single-choice, keyboard- and
 * screen-reader-friendly control with no need for the richer chip/grouping treatment above. */
export function WorkSuitabilitySortSelect({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="rounded-panel border-[1.5px] border-border-input bg-white px-2.5 py-[7px] font-mono text-[12px] font-semibold text-ink outline-none focus:border-primary"
    >
      <option value="">Sort: default order</option>
      {WORK_SUITABILITY_TYPES.map((w) => (
        <option key={w.id} value={w.id}>
          Sort: {w.icon} {w.label} (high → low)
        </option>
      ))}
    </select>
  );
}
