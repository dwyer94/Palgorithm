import { useRegisterSW } from 'virtual:pwa-register/react';

/** Phase 3 (docs/PRODUCTION_READINESS_PLAN.md): `registerType: 'prompt'` (vite.config.ts)
 * means a new deploy's service worker installs but waits at "needs refresh" instead of
 * silently taking over — this is what surfaces that state, since a signed-in user
 * shouldn't keep running a stale bundle against a newer backend schema without knowing. */
export default function PwaUpdateToast() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[80] flex items-center gap-3 rounded-card border border-border-card bg-white p-4 shadow-card">
      <span className="font-sans text-[12.5px] text-ink">A new version is available.</span>
      <span
        onClick={() => void updateServiceWorker(true)}
        className="cursor-pointer rounded-lg border-[1.5px] border-[#26241f] bg-white px-3 py-1.5 font-mono text-[12.5px] font-semibold hover:bg-panel-subtle"
      >
        Reload
      </span>
    </div>
  );
}
