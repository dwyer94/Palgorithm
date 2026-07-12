import { createContext, useContext, useState, type ReactNode } from 'react';
import type { WorkSuitabilityFilter } from './components';

/** Shared state for the Pal/Perk quick-reference feature (floating bubbles + the full-screen
 * "Reference" utility view) — lifted above both so search/filter/sort state survives switching
 * between the compact bubble panel and the full-screen view, instead of resetting per-mount. */

export type ReferenceKind = 'pals' | 'perks';
export type BubbleState = 'closed' | 'expanded';

/** Fixed sort keys, or the id of a work-suitability type (e.g. "Mining") to sort by that
 * work level — the Pals list's sort `<select>` offers both in one combined list. */
export type PalsSortBy = 'name' | 'rank' | 'rarity' | 'walk' | 'run' | 'swim' | (string & {});

export type ReachFilter = 'all' | 'breedable' | 'catchable' | 'special';

export interface PalsQuery {
  search: string;
  elements: string[];
  reach: ReachFilter;
  sizes: string[];
  nocturnalOnly: boolean;
  rankMin: number | null;
  rankMax: number | null;
  minRunSpeed: number | null;
  workFilters: WorkSuitabilityFilter[];
  sortBy: PalsSortBy;
}

export interface PerksQuery {
  search: string;
  categories: string[];
  sortBy: 'name' | 'tier';
}

const DEFAULT_PALS_QUERY: PalsQuery = {
  search: '',
  elements: [],
  reach: 'all',
  sizes: [],
  nocturnalOnly: false,
  rankMin: null,
  rankMax: null,
  minRunSpeed: null,
  workFilters: [],
  sortBy: 'name',
};
const DEFAULT_PERKS_QUERY: PerksQuery = { search: '', categories: [], sortBy: 'name' };

interface ReferenceContextValue {
  bubbleState: Record<ReferenceKind, BubbleState>;
  toggleBubble: (kind: ReferenceKind) => void;
  closeBubble: (kind: ReferenceKind) => void;

  palsQuery: PalsQuery;
  setPalsQuery: (next: PalsQuery) => void;
  perksQuery: PerksQuery;
  setPerksQuery: (next: PerksQuery) => void;

  focusedTab: ReferenceKind;
  setFocusedTab: (kind: ReferenceKind) => void;

  /** One-shot signal: AppShell watches this to switch the active sidebar view to
   * 'reference', then clears it. Needed because ReferenceProvider sits above AppShell's
   * own `active` view state and can't call its setter directly. */
  maximizeRequest: ReferenceKind | null;
  requestMaximize: (kind: ReferenceKind) => void;
  clearMaximizeRequest: () => void;
}

const ReferenceContext = createContext<ReferenceContextValue | null>(null);

export function ReferenceProvider({ children }: { children: ReactNode }) {
  const [bubbleState, setBubbleState] = useState<Record<ReferenceKind, BubbleState>>({
    pals: 'closed',
    perks: 'closed',
  });
  const [palsQuery, setPalsQuery] = useState<PalsQuery>(DEFAULT_PALS_QUERY);
  const [perksQuery, setPerksQuery] = useState<PerksQuery>(DEFAULT_PERKS_QUERY);
  const [focusedTab, setFocusedTab] = useState<ReferenceKind>('pals');
  const [maximizeRequest, setMaximizeRequest] = useState<ReferenceKind | null>(null);

  const toggleBubble = (kind: ReferenceKind) =>
    setBubbleState((prev) => ({ ...prev, [kind]: prev[kind] === 'expanded' ? 'closed' : 'expanded' }));
  const closeBubble = (kind: ReferenceKind) => setBubbleState((prev) => ({ ...prev, [kind]: 'closed' }));

  const requestMaximize = (kind: ReferenceKind) => {
    setFocusedTab(kind);
    closeBubble(kind);
    setMaximizeRequest(kind);
  };

  const value: ReferenceContextValue = {
    bubbleState,
    toggleBubble,
    closeBubble,
    palsQuery,
    setPalsQuery,
    perksQuery,
    setPerksQuery,
    focusedTab,
    setFocusedTab,
    maximizeRequest,
    requestMaximize,
    clearMaximizeRequest: () => setMaximizeRequest(null),
  };

  return <ReferenceContext.Provider value={value}>{children}</ReferenceContext.Provider>;
}

export function useReferenceContext(): ReferenceContextValue {
  const ctx = useContext(ReferenceContext);
  if (!ctx) throw new Error('useReferenceContext must be used within ReferenceProvider');
  return ctx;
}
