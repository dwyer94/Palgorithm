import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload } from 'lucide-react';
import { useRoster, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import { CLOUD_ROW_CAPS, type RosterEntry } from '../store/types';
import { parseImportedRoster, ROSTER_IMPORT_ERRORS } from '../store/validate';
import { useRulesetContext } from './RulesetContext';
import { useAuthContext } from './AuthContext';
import { PassiveMultiSelect, SpeciesSelect } from './shared';
import { ElementDot, GenderGlyph, PalCard, PalIcon, PassiveChip, RowCapBadge } from './components';

/** Roster manager: add/edit/remove owned Pals, import/export JSON. Not part of the design
 * handoff bundle (session 0.D covered Hub/Server Pals/Settings) — styled to sit
 * consistently inside the new sidebar shell rather than redesigned from scratch. */
export default function RosterView() {
  const { species, passives, speciesById } = useRulesetContext();
  const [roster, setRoster] = useRoster();
  const [settings] = useSettings();
  const { user } = useAuthContext();
  const isFull = settings.iconDisplayMode === 'full';
  const [draftSpecies, setDraftSpecies] = useState(species[0]?.id ?? '');
  const [draftGender, setDraftGender] = useState<'male' | 'female'>('male');
  const [draftPassives, setDraftPassives] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editSpecies, setEditSpecies] = useState('');
  const [editGender, setEditGender] = useState<'male' | 'female'>('male');
  const [editPassives, setEditPassives] = useState<string[]>([]);
  const [editNotes, setEditNotes] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  /** A validated import waiting on the replace-confirmation dialog. Null when none is pending. */
  const [pendingImport, setPendingImport] = useState<RosterEntry[] | null>(null);

  const addEntry = () => {
    if (!draftSpecies) return;
    const entry: RosterEntry = {
      id: newId(),
      species: draftSpecies,
      gender: draftGender,
      passives: draftPassives,
      ...(draftNotes !== '' && { notes: draftNotes }),
    };
    setRoster([...roster, entry]);
    setDraftPassives([]);
    setDraftNotes('');
  };

  const removeEntry = (id: string) => setRoster(roster.filter((r) => r.id !== id));

  const startEdit = (entry: RosterEntry) => {
    setEditingId(entry.id);
    setEditSpecies(entry.species);
    setEditGender(entry.gender);
    setEditPassives(entry.passives);
    setEditNotes(entry.notes ?? '');
  };

  const saveEdit = () => {
    if (!editingId || !editSpecies) return;
    setRoster(
      roster.map((r) =>
        r.id === editingId
          ? { id: r.id, species: editSpecies, gender: editGender, passives: editPassives, ...(editNotes !== '' && { notes: editNotes }) }
          : r,
      ),
    );
    setEditingId(null);
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palgorithm-roster.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  /** Replaces the roster with a validated file (this is the other half of Export JSON, i.e. a
   * restore — not an append like Team Builder's import). Everything about the file is checked
   * in `parseImportedRoster` before it reaches the store: the previous version cast
   * `JSON.parse`'s result straight to `RosterEntry[]`, so a non-array walked into the store
   * and crashed the roster table, the planner's roster memo, and the cloud push at once
   * (Sentry PALGORITHM-8/-9/-A).
   *
   * Validate first, then confirm — asking someone to okay destroying their roster and only
   * then telling them the file was unreadable gets the order exactly backwards. */
  const importJson = async (file: File) => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      setImportError(ROSTER_IMPORT_ERRORS['not-json']);
      return;
    }
    const result = parseImportedRoster(parsed);
    if (!result.ok) {
      setImportError(ROSTER_IMPORT_ERRORS[result.reason]);
      return;
    }
    // Nothing to lose when the roster is empty, so don't make an empty-state import a
    // two-step action.
    if (roster.length === 0) {
      setRoster(result.roster);
      return;
    }
    setPendingImport(result.roster);
  };

  // Dialog buttons, matching AuthView.tsx's delete-account confirmation. Kept local like this
  // view's other class strings rather than hoisted — the two dialogs are the only users.
  const secondaryButtonClass =
    'cursor-pointer rounded-lg px-3.5 py-2 font-mono text-[12.5px] font-semibold text-muted hover:bg-panel-subtle';
  const dangerButtonClass =
    'cursor-pointer rounded-lg border-[1.5px] border-danger-border bg-danger-bg px-3.5 py-2 font-mono text-[12.5px] font-semibold text-danger-text hover:bg-[#fbe6da]';

  const inputClass = 'rounded-panel border-[1.5px] border-border-input px-3 py-2 font-sans text-[13px] outline-none focus:border-primary';
  const buttonClass =
    'inline-flex cursor-pointer items-center gap-1.5 rounded-panel border border-border-card bg-white px-3.5 py-2 font-sans text-[13px] font-semibold hover:border-muted-lighter';

  const editForm = (
    <>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="w-[200px]">
          <SpeciesSelect species={species} value={editSpecies} onChange={setEditSpecies} />
        </div>
        <select value={editGender} onChange={(e) => setEditGender(e.target.value as 'male' | 'female')} className={inputClass}>
          <option value="male">male</option>
          <option value="female">female</option>
        </select>
        <input
          placeholder="notes (optional)"
          value={editNotes}
          onChange={(e) => setEditNotes(e.target.value)}
          className={`${inputClass} flex-1`}
        />
      </div>
      <div className="mt-2">
        <PassiveMultiSelect passives={passives} value={editPassives} onChange={setEditPassives} />
      </div>
      <div className="mt-2 flex gap-2">
        <span onClick={saveEdit} className="cursor-pointer rounded-panel bg-primary px-3.5 py-1.5 font-sans text-[12.5px] font-semibold text-white">
          Save
        </span>
        <span
          onClick={() => setEditingId(null)}
          className="cursor-pointer rounded-panel border border-border-card bg-white px-3.5 py-1.5 font-sans text-[12.5px] font-semibold text-muted"
        >
          Cancel
        </span>
      </div>
    </>
  );

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[1080px] px-4 pb-[60px] pt-[26px] md:px-[34px]">
        <div className="mb-0.5 flex items-center gap-2">
          <div className="font-sans text-[22px] font-bold tracking-[-.4px]">Roster</div>
          {user && <RowCapBadge count={roster.length} cap={CLOUD_ROW_CAPS.roster} />}
        </div>
        <div className="mb-6 font-sans text-[13px] text-muted">Pals you own — feeds every planner at cost 0.</div>

        <div className="mb-4 rounded-card border border-border-card bg-white p-5 shadow-card">
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <div className="w-[220px]">
              <SpeciesSelect species={species} value={draftSpecies} onChange={setDraftSpecies} />
            </div>
            <select
              value={draftGender}
              onChange={(e) => setDraftGender(e.target.value as 'male' | 'female')}
              className={inputClass}
            >
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
            <input placeholder="notes (optional)" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} className={`${inputClass} flex-1`} />
            <span onClick={addEntry} className="cursor-pointer rounded-panel bg-sidebar-bg px-4 py-2 font-sans text-[13px] font-semibold text-white hover:bg-sidebar-hover">
              Add
            </span>
          </div>
          <div className="mb-1.5 font-sans text-[11px] font-semibold uppercase tracking-wide text-muted">Passives (optional)</div>
          <PassiveMultiSelect passives={passives} value={draftPassives} onChange={setDraftPassives} />
        </div>

        <div className="mb-3 flex gap-2">
          <span onClick={exportJson} className={buttonClass}>
            <Download size={13} /> Export JSON
          </span>
          <span onClick={() => fileInputRef.current?.click()} className={buttonClass}>
            <Upload size={13} /> Import JSON
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importJson(file);
              e.target.value = '';
            }}
          />
        </div>

        {importError && <div className="mb-4 font-sans text-[12px] font-semibold text-brand-hover">{importError}</div>}

        {/* Import replaces rather than merges, which is silent, total, and — for a signed-in
            user — pushed straight to the cloud. Gated behind an explicit second click, same
            portal/modal pattern as AuthView.tsx's delete-account confirmation. */}
        {pendingImport !== null &&
          createPortal(
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
              <div className="w-full max-w-[420px] rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
                <div className="mb-1.5 font-sans text-[15px] font-bold">Replace your roster?</div>
                <div className="mb-4 font-sans text-[12.5px] text-muted">
                  Importing this file <span className="font-semibold">removes all {roster.length}</span>{' '}
                  {roster.length === 1 ? 'Pal' : 'Pals'} currently in your roster and replaces them with the{' '}
                  {pendingImport.length} in the file. This can't be undone
                  {user ? ' — and it syncs to your account on every device.' : '.'} Export first if you want a copy of
                  what you have now.
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setPendingImport(null)} className={secondaryButtonClass}>
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setRoster(pendingImport);
                      setPendingImport(null);
                    }}
                    className={dangerButtonClass}
                  >
                    Replace {roster.length} {roster.length === 1 ? 'Pal' : 'Pals'}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )}

        {roster.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-input bg-panel-subtle p-8 text-center font-sans text-[13px] text-muted">
            No roster entries yet.
          </div>
        ) : isFull ? (
          <div className="flex flex-col gap-3">
            {editingId && (
              <div className="rounded-card border border-border-card bg-primary-tint p-4 shadow-card">{editForm}</div>
            )}
            <div className="flex flex-wrap gap-3">
              {roster
                .filter((entry) => entry.id !== editingId)
                .map((entry) => {
                  const s = speciesById.get(entry.species);
                  return (
                    <PalCard
                      key={entry.id}
                      icon={s?.icon}
                      elements={s?.elements}
                      title={s?.displayName ?? entry.species}
                      meta={<GenderGlyph gender={entry.gender} className="font-mono text-[11px] text-muted" />}
                    >
                      {entry.passives.length > 0 && (
                        <div className="flex flex-wrap justify-center gap-1">
                          {entry.passives.map((id) => {
                            const p = passives.find((x) => x.id === id);
                            return (
                              <PassiveChip key={id} label={p?.displayName ?? id} tier={p?.tier} description={p?.description} className="text-[9px]" />
                            );
                          })}
                        </div>
                      )}
                      {entry.notes && <div className="font-sans text-[10.5px] text-muted-light">{entry.notes}</div>}
                      <div className="mt-1 flex gap-2.5 border-t border-dashed border-border-inner pt-1.5">
                        <span
                          onClick={() => startEdit(entry)}
                          className="cursor-pointer font-mono text-[10.5px] font-medium text-muted-lighter hover:text-primary-dark"
                        >
                          edit
                        </span>
                        <span
                          onClick={() => removeEntry(entry.id)}
                          className="cursor-pointer font-mono text-[10.5px] font-medium text-muted-lighter hover:text-brand-hover"
                        >
                          remove
                        </span>
                      </div>
                    </PalCard>
                  );
                })}
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-border-card bg-white shadow-card">
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-left">
                  {['Species', 'Gender', 'Passives', 'Notes', ''].map((h) => (
                    <th key={h} className="px-4 py-2.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roster.map((entry) => {
                  const s = speciesById.get(entry.species);
                  if (editingId === entry.id) {
                    return (
                      <tr key={entry.id} className="border-t border-panel-header bg-primary-tint">
                        <td className="px-4 py-2.5" colSpan={5}>
                          {editForm}
                        </td>
                      </tr>
                    );
                  }
                  return (
                    <tr key={entry.id} className="border-t border-panel-header">
                      <td className="px-4 py-2.5">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[12.5px] font-semibold">
                          <PalIcon icon={s?.icon} size={20} />
                          <ElementDot elements={s?.elements} />
                          {s?.displayName ?? entry.species}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <GenderGlyph gender={entry.gender} className="font-mono text-[12px] text-muted" />
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {entry.passives.map((id) => {
                            const p = passives.find((x) => x.id === id);
                            return <PassiveChip key={id} label={p?.displayName ?? id} tier={p?.tier} description={p?.description} />;
                          })}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 font-sans text-[12.5px] text-muted">{entry.notes ?? ''}</td>
                      <td className="px-4 py-2.5">
                        <span className="flex gap-2.5">
                          <span onClick={() => startEdit(entry)} className="cursor-pointer font-mono text-[11px] font-medium text-muted-lighter hover:text-primary-dark">
                            edit
                          </span>
                          <span onClick={() => removeEntry(entry.id)} className="cursor-pointer font-mono text-[11px] font-medium text-muted-lighter hover:text-brand-hover">
                            remove
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}
