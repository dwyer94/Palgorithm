import { useRef, useState } from 'react';
import { useRoster } from '../store/hooks';
import { newId } from '../store/localStore';
import type { RosterEntry } from '../store/types';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect, SpeciesSelect } from './shared';

/** Roster manager (spec §8.1): add/edit/remove owned Pals, import/export JSON. */
export default function RosterView() {
  const { species, passives, speciesById } = useRulesetContext();
  const [roster, setRoster] = useRoster();
  const [draftSpecies, setDraftSpecies] = useState(species[0]?.id ?? '');
  const [draftGender, setDraftGender] = useState<'male' | 'female'>('male');
  const [draftPassives, setDraftPassives] = useState<string[]>([]);
  const [draftNotes, setDraftNotes] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const removeEntry = (id: string) => {
    setRoster(roster.filter((r) => r.id !== id));
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(roster, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'palcalc-roster.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (file: File) => {
    file
      .text()
      .then((text) => {
        const parsed = JSON.parse(text) as RosterEntry[];
        setRoster(parsed);
      })
      .catch((err) => alert(`Failed to import roster: ${String(err)}`));
  };

  return (
    <section>
      <h2>Roster</h2>

      <div>
        <SpeciesSelect species={species} value={draftSpecies} onChange={setDraftSpecies} />
        <select value={draftGender} onChange={(e) => setDraftGender(e.target.value as 'male' | 'female')}>
          <option value="male">male</option>
          <option value="female">female</option>
        </select>
        <input placeholder="notes" value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
        <button onClick={addEntry}>Add</button>
        <div>
          <p>Passives (optional):</p>
          <PassiveMultiSelect passives={passives} value={draftPassives} onChange={setDraftPassives} />
        </div>
      </div>

      <div>
        <button onClick={exportJson}>Export JSON</button>
        <button onClick={() => fileInputRef.current?.click()}>Import JSON</button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) importJson(file);
            e.target.value = '';
          }}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>Species</th>
            <th>Gender</th>
            <th>Passives</th>
            <th>Notes</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {roster.map((entry) => (
            <tr key={entry.id}>
              <td>{speciesById.get(entry.species)?.displayName ?? entry.species}</td>
              <td>{entry.gender}</td>
              <td>{entry.passives.join(', ')}</td>
              <td>{entry.notes ?? ''}</td>
              <td>
                <button onClick={() => removeEntry(entry.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {roster.length === 0 && <p>No roster entries yet.</p>}
    </section>
  );
}
