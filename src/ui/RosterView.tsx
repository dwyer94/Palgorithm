import { useRef, useState } from 'react';
import { useRoster, useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import type { RosterEntry } from '../store/types';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect } from './shared';
import { ElementDot, GenderGlyph, PalCard, PalIcon, PassiveChip } from './components';

/** Roster manager: add/edit/remove owned Pals, import/export JSON. Not part of the design
 * handoff bundle (session 0.D covered Hub/Server Pals/Settings) — styled to sit
 * consistently inside the new sidebar shell rather than redesigned from scratch. */
export default function RosterView() {
  const { species, passives, speciesById } = useRulesetContext();
  const [roster, setRoster] = useRoster();
  const [settings] = useSettings();
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

  const importJson = (file: File) => {
    file
      .text()
      .then((text) => setRoster(JSON.parse(text) as RosterEntry[]))
      .catch((err) => alert(`Failed to import roster: ${String(err)}`));
  };

  const inputClass = 'rounded-panel border-[1.5px] border-border-input px-3 py-2 font-sans text-[13px] outline-none focus:border-primary';
  const buttonClass =
    'cursor-pointer rounded-panel border border-border-card bg-white px-3.5 py-2 font-sans text-[13px] font-semibold hover:border-muted-lighter';

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
      <div className="mx-auto max-w-[1080px] px-[34px] pb-[60px] pt-[26px]">
        <div className="mb-0.5 font-sans text-[22px] font-bold tracking-[-.4px]">Roster</div>
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
            ⤓ Export JSON
          </span>
          <span onClick={() => fileInputRef.current?.click()} className={buttonClass}>
            Import JSON
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) importJson(file);
              e.target.value = '';
            }}
          />
        </div>

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
