import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuthContext } from './AuthContext';
import * as local from '../store/localStore';
import { isCloudEmpty, importLocalData } from '../store/remoteStore';

/** Guest -> cloud migration (Phase 1, docs/PRODUCTION_READINESS_PLAN.md): on the
 * sign-out -> sign-in transition, offer a one-time "Import your local data" action if the
 * account's cloud tables are empty. If the account already has cloud data (returning user,
 * new device) there's no merge — but if *this* device also has local guest data, that data
 * would otherwise be silently orphaned (never imported, never mentioned again), so a
 * dismissible warning nudges toward the existing Team Builder export/import instead of
 * building conflict-resolution UI nobody asked for. */

type PromptState = { kind: 'none' } | { kind: 'offer-import' } | { kind: 'orphaned-warning' };

const primaryButtonClass =
  'cursor-pointer rounded-lg border-[1.5px] border-[#26241f] bg-white px-3.5 py-2 font-mono text-[12.5px] font-semibold hover:bg-panel-subtle disabled:cursor-default disabled:opacity-50';
const secondaryButtonClass =
  'cursor-pointer rounded-lg px-3.5 py-2 font-mono text-[12.5px] font-semibold text-muted hover:bg-panel-subtle disabled:cursor-default disabled:opacity-50';

function hasLocalGuestData(): boolean {
  return local.getRoster().length > 0 || local.getSavedPlans().length > 0 || local.getTeams().length > 0;
}

export default function GuestMigrationPrompt() {
  const { user, loading } = useAuthContext();
  const prevUserId = useRef<string | null>(null);
  // A page reload while already signed in also looks like a null -> non-null transition
  // in `user` (AuthContext starts every mount not knowing the restored session yet) —
  // without this, the prompt would reappear on every reload for an already-signed-in
  // returning user, not just on an actual sign-in action taken during this session.
  const initialized = useRef(false);
  const [state, setState] = useState<PromptState>({ kind: 'none' });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!initialized.current) {
      initialized.current = true;
      prevUserId.current = user?.id ?? null;
      return;
    }
    const wasSignedOut = prevUserId.current === null;
    const nowSignedIn = user !== null;
    if (wasSignedOut && nowSignedIn && hasLocalGuestData()) {
      void isCloudEmpty().then((empty) => {
        setState(empty ? { kind: 'offer-import' } : { kind: 'orphaned-warning' });
      });
    }
    prevUserId.current = user?.id ?? null;
  }, [user, loading]);

  const doImport = async () => {
    setImporting(true);
    setImportError(null);
    const { error } = await importLocalData({
      roster: local.getRoster(),
      savedPlans: local.getSavedPlans(),
      teams: local.getTeams(),
      settings: local.getSettings(),
    });
    setImporting(false);
    if (error) {
      setImportError(error);
      return;
    }
    // Cloud is now the source of truth for this account — clear local guest data so a
    // future sign-out doesn't resurrect it, and so this device never looks like it still
    // has unimported guest data.
    local.setRoster([]);
    local.setSavedPlans([]);
    local.setTeams([]);
    setState({ kind: 'none' });
  };

  if (state.kind === 'none') return null;

  if (state.kind === 'offer-import') {
    return createPortal(
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-[420px] rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-1.5 font-sans text-[15px] font-bold">Import your local data?</div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">
            This device has roster, plan, and team data saved locally. Import it into your account now — this only
            happens once; your account has no cloud data yet.
          </div>
          {importError && <div className="mb-3 font-mono text-[12px] text-danger-text">{importError}</div>}
          <div className="flex justify-end gap-2">
            <button disabled={importing} onClick={() => setState({ kind: 'none' })} className={secondaryButtonClass}>
              Skip
            </button>
            <button disabled={importing} onClick={() => void doImport()} className={primaryButtonClass}>
              {importing ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div className="fixed bottom-4 right-4 z-[80] max-w-[340px] rounded-card border border-border-card bg-white p-4 shadow-card">
      <div className="mb-2 font-sans text-[12.5px] text-muted">
        This device also has local guest data, but your account already has cloud data — it won't be merged
        automatically. Export it from Team Builder first if you want to keep it.
      </div>
      <div className="flex justify-end">
        <span onClick={() => setState({ kind: 'none' })} className={secondaryButtonClass}>
          Dismiss
        </span>
      </div>
    </div>,
    document.body,
  );
}
