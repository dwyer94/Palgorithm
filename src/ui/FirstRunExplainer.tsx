import { useState } from 'react';

const STORAGE_KEY = 'palcalc.seenFirstRunExplainer';

/** One-time dismissible banner covering the two things that aren't guessable from the UI
 * (Phase 2, docs/PRODUCTION_READINESS_PLAN.md) — a slim top banner rather than a blocking
 * modal, since the app is guest-first and shouldn't force a dialog before someone can try
 * it. Dismissal is a plain localStorage flag (not routed through the typed store — this is
 * UI chrome state, not user data). */
export default function FirstRunExplainer() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="flex flex-none items-center gap-3 border-b border-border-card bg-primary-tint3 px-4 py-2 font-sans text-[12.5px] text-ink">
      <span>
        Two things worth knowing: the <b>closest eligible rank</b> wins when breeding (not always the exact midpoint),
        and a <b>hub</b> is a shared intermediate Pal you breed once and reuse across multiple targets.
      </span>
      <span
        onClick={dismiss}
        role="button"
        aria-label="Dismiss"
        className="ml-auto flex-none cursor-pointer px-1 text-[15px] text-muted hover:text-ink"
      >
        ×
      </span>
    </div>
  );
}
