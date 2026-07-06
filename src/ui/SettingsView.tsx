import { useState } from 'react';
import { useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import type { SavedPerkSet } from '../store/types';
import { useLiveContext } from '../live/LiveContext';
import { useRulesetContext } from './RulesetContext';
import { PassiveMultiSelect } from './shared';

/** Settings (spec §8.6): allowed-catch policy, catch-cost weighting, saved perk sets, and
 * (for the 1.0 contingency) server-config presets + active ruleset selector. */
export default function SettingsView() {
  const { passives, ruleset } = useRulesetContext();
  const [settings, setSettings] = useSettings();
  const live = useLiveContext();
  const [draftPerkSetName, setDraftPerkSetName] = useState('');
  const [draftPerkSetPassives, setDraftPerkSetPassives] = useState<string[]>([]);
  const [draftOverrideId, setDraftOverrideId] = useState('');
  const [draftOverrideName, setDraftOverrideName] = useState('');

  const setLive = (patch: Partial<typeof settings.live>) => setSettings({ ...settings, live: { ...settings.live, ...patch } });

  const addNameOverride = () => {
    if (!draftOverrideId || !draftOverrideName) return;
    setLive({ nameOverrides: { ...settings.live.nameOverrides, [draftOverrideId]: draftOverrideName } });
    setDraftOverrideId('');
    setDraftOverrideName('');
  };

  const removeNameOverride = (id: string) => {
    const next = { ...settings.live.nameOverrides };
    delete next[id];
    setLive({ nameOverrides: next });
  };

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

      <div>
        <h3>Live server connection</h3>
        <div>
          <label>
            Proxy base URL:{' '}
            <input
              placeholder="https://your-server.ts.net (leave blank to use demo data)"
              value={settings.live.baseUrl}
              onChange={(e) => setLive({ baseUrl: e.target.value })}
              size={40}
            />
          </label>
        </div>
        <div>
          <label>
            Bearer token (optional):{' '}
            <input type="password" value={settings.live.bearerToken} onChange={(e) => setLive({ bearerToken: e.target.value })} />
          </label>
        </div>
        <p>
          Status: <strong>{live.status}</strong>
          {live.isUsingMock && ' — using demo/mock data (no base URL configured)'}
          {live.lastRefreshedAt && ` — last refreshed ${new Date(live.lastRefreshedAt).toLocaleTimeString()}`}
        </p>
        {live.error && (
          <p>
            Error: {live.error.code} — {live.error.message}
          </p>
        )}
        <button onClick={() => live.refreshPlayers()}>Test connection / refresh players</button>

        <div>
          <label>
            <input
              type="checkbox"
              checked={settings.live.autoPollEnabled}
              onChange={(e) => setLive({ autoPollEnabled: e.target.checked })}
            />
            Auto-refresh
          </label>{' '}
          <label>
            every{' '}
            <input
              type="number"
              min={5}
              disabled={!settings.live.autoPollEnabled}
              value={settings.live.autoPollIntervalSeconds}
              onChange={(e) => setLive({ autoPollIntervalSeconds: Number(e.target.value) })}
            />{' '}
            seconds
          </label>
        </div>

        <h4>Display name overrides</h4>
        <p>Takes precedence over the proxy's own player name. Keyed by player identifier (SteamID64/PlayerUID).</p>
        <input placeholder="identifier" value={draftOverrideId} onChange={(e) => setDraftOverrideId(e.target.value)} />
        <input placeholder="display name" value={draftOverrideName} onChange={(e) => setDraftOverrideName(e.target.value)} />
        <button onClick={addNameOverride}>Add / update</button>
        <ul>
          {Object.entries(settings.live.nameOverrides).map(([id, name]) => (
            <li key={id}>
              {id} → {name} <button onClick={() => removeNameOverride(id)}>Remove</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
