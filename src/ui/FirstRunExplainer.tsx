const STORAGE_KEY = 'palcalc.seenFirstRunExplainer';

export function hasSeenFirstRunExplainer(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

export function markFirstRunExplainerSeen(): void {
  localStorage.setItem(STORAGE_KEY, '1');
}

/** Slim top banner covering the two things that aren't guessable from the UI (Phase 2,
 * docs/PRODUCTION_READINESS_PLAN.md) — not a blocking modal, since the app is guest-first
 * and shouldn't force a dialog before someone can try it. Visibility is controlled by the
 * parent (shown automatically on first run via `hasSeenFirstRunExplainer`, and re-openable
 * later from the sidebar's Help row) rather than owning its own dismissed state, so the
 * same content can be brought back without clearing the "seen" flag. */
export default function FirstRunExplainer({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex flex-none items-center gap-3 border-b border-border-card bg-primary-tint3 px-4 py-2 font-sans text-[12.5px] text-ink">
      <span>
        Two things worth knowing: the <b>closest eligible rank</b> wins when breeding (not always the exact midpoint),
        and a <b>hub</b> is a shared intermediate Pal you breed once and reuse across multiple targets.
      </span>
      <span
        onClick={onDismiss}
        role="button"
        aria-label="Dismiss"
        className="ml-auto flex-none cursor-pointer px-1 text-[15px] text-muted hover:text-ink"
      >
        ×
      </span>
    </div>
  );
}
