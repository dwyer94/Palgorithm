import type { ReactNode } from 'react';
import { useReferenceContext, type ReferenceKind } from './ReferenceContext';
import PalReferenceList from './reference/PalReferenceList';
import PerkReferenceList from './reference/PerkReferenceList';

const BUBBLE_META: Record<ReferenceKind, { label: string; icon: string }> = {
  pals: { label: 'Pals', icon: '🐾' },
  perks: { label: 'Perks', icon: '✦' },
};

// Each bubble's FAB is a fixed width so the gap between the two bubbles' anchor points is
// predictable regardless of label length. `BUBBLE_RIGHT_OFFSET` positions each bubble's own
// `fixed` wrapper independently (rather than laying both out in one shared flex row) — the
// wrapper's footprint never changes size, so expanding one bubble's panel can't shift the
// other bubble sideways (the panel is `absolute`, anchored to its own already-fixed wrapper).
const FAB_WIDTH = 116;
const BUBBLE_GAP = 12;
const BUBBLE_RIGHT_OFFSET: Record<ReferenceKind, number> = {
  pals: 16,
  perks: 16 + FAB_WIDTH + BUBBLE_GAP,
};

function Bubble({ kind, children }: { kind: ReferenceKind; children: ReactNode }) {
  const { bubbleState, toggleBubble, requestMaximize } = useReferenceContext();
  const meta = BUBBLE_META[kind];
  const expanded = bubbleState[kind] === 'expanded';

  return (
    <div
      className="pointer-events-auto fixed bottom-4 z-[60]"
      style={{ right: BUBBLE_RIGHT_OFFSET[kind] }}
    >
      <div className="relative flex flex-col items-end">
        {expanded && (
          <div className="absolute bottom-[calc(100%+8px)] right-0 flex max-h-[70vh] w-[min(92vw,360px)] flex-col overflow-hidden rounded-card border border-border-card bg-white shadow-dropdown">
            <div className="flex flex-none items-center gap-2 bg-sidebar-bg px-3.5 py-2.5 text-sidebar-text">
              <span aria-hidden>{meta.icon}</span>
              <span className="font-sans text-[13px] font-semibold">{meta.label} reference</span>
              <span className="ml-auto flex items-center gap-2">
                <span
                  onClick={() => requestMaximize(kind)}
                  role="button"
                  aria-label={`Maximize ${meta.label} reference`}
                  title="Maximize"
                  className="cursor-pointer px-1 text-[15px] leading-none hover:text-brand"
                >
                  ⛶
                </span>
                <span
                  onClick={() => toggleBubble(kind)}
                  role="button"
                  aria-label={`Minimize ${meta.label} reference`}
                  title="Minimize"
                  className="cursor-pointer px-1 text-[17px] leading-none hover:text-brand"
                >
                  –
                </span>
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-3">{children}</div>
          </div>
        )}
        <span
          onClick={() => toggleBubble(kind)}
          role="button"
          aria-label={`${expanded ? 'Minimize' : 'Open'} ${meta.label} reference`}
          title={`${meta.label} reference`}
          style={{ width: FAB_WIDTH }}
          className={`flex h-11 flex-none cursor-pointer items-center justify-center gap-2 rounded-pill font-sans text-[13px] font-semibold shadow-dropdown transition-colors ${
            expanded ? 'bg-brand text-sidebar-bg' : 'bg-sidebar-bg text-sidebar-text hover:bg-sidebar-hover'
          }`}
        >
          <span aria-hidden className="text-[16px]">
            {meta.icon}
          </span>
          {meta.label}
        </span>
      </div>
    </div>
  );
}

/** Facebook-Messenger-style floating quick reference — one bubble each for Pals/Perks,
 * independently expandable, both maximizable into the full-screen "Reference" utility view.
 * Rendered once in `AppShell`; hidden while the Reference view itself is active so the same
 * content isn't shown twice. */
export default function ReferenceBubbles({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <>
      <Bubble kind="perks">
        <PerkReferenceList dense />
      </Bubble>
      <Bubble kind="pals">
        <PalReferenceList dense />
      </Bubble>
    </>
  );
}
