import { useState } from 'react';
import { useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import type { SavedPerkSet } from '../store/types';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect } from './shared';

/** Settings (spec §8.6): allowed-catch policy, catch-cost weighting, saved perk sets, and
 * (for the 1.0 contingency) server-config presets + active ruleset selector. */
export default function SettingsView() {
  const { passives, ruleset } = useRulesetContext();
  const [settings, setSettings] = useSettings();
  const [draftPerkSetName, setDraftPerkSetName] = useState('');
  const [draftPerkSetPassives, setDraftPerkSetPassives] = useState<string[]>([]);

  const addPerkSet = () => {
    if (!draftPerkSetName || draftPerkSetPassives.length === 0) return;
    const set: SavedPerkSet = { id: newId(), name: draftPerkSetName, passives: draftPerkSetPassives };
    setSettings({ ...settings, savedPerkSets: [...settings.savedPerkSets, set] });
    setDraftPerkSetName('');
    setDraftPerkSetPassives([]);
  };

  const removePerkSet = (id: string) => {
    setSettings({ ...settings, savedPerkSets: settings.savedPerkSets.filter((s) => s.id !== id) });
  };

  return (
    <section>
      <h2>Settings</h2>

      <div>
        <label>
          <input
            type="checkbox"
            checked={settings.allowCatching}
            onChange={(e) => setSettings({ ...settings, allowCatching: e.target.checked })}
          />
          Allow catching wild-catchable species
        </label>
      </div>

      <div>
        <label>
          Catch cost weight:{' '}
          <input
            type="number"
            min={0}
            step={0.1}
            value={settings.catchCost}
            onChange={(e) => setSettings({ ...settings, catchCost: Number(e.target.value) })}
          />
        </label>
      </div>

      <div>
        <p>
          Active ruleset: <strong>{ruleset.version}</strong> (only combirank-0.6 is available until the 1.0 swap)
        </p>
      </div>

      <div>
        <h3>Saved perk sets</h3>
        <input placeholder="name" value={draftPerkSetName} onChange={(e) => setDraftPerkSetName(e.target.value)} />
        <PassiveMultiSelect passives={passives} value={draftPerkSetPassives} onChange={setDraftPerkSetPassives} />
        <button onClick={addPerkSet}>Save perk set</button>
        <ul>
          {settings.savedPerkSets.map((s) => (
            <li key={s.id}>
              {s.name}: {s.passives.join(', ')} <button onClick={() => removePerkSet(s.id)}>Remove</button>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3>Server config preset</h3>
        <p>No server-dependence confirmed yet for combirank-0.6 (spec §12) — placeholder for the 1.0 contingency.</p>
      </div>
    </section>
  );
}
