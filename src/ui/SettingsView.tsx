import { useState } from 'react';
import { Check, X, Mail, MessageCircle } from 'lucide-react';
import { useSettings } from '../store/hooks';
import { newId } from '../store/localStore';
import type { SavedPerkSet } from '../store/types';
import { useLiveContext } from '../live/LiveContext';
import { useRulesetContext } from './RulesetContext';
import { PassiveChip, PassiveMultiSelect, Toggle } from './components';
import { APP_VERSION } from '../version';
import KofiButton from './KofiButton';

/** Settings — planning policy, saved perk sets, live connection, name overrides, and the
 * 1.0-patch placeholders (design handoff README, Screen 3). */
export default function SettingsView() {
  const { passives, dataset } = useRulesetContext();
  const [settings, setSettings] = useSettings();
  const live = useLiveContext();
  const [testing, setTesting] = useState(false);
  const [discordCopied, setDiscordCopied] = useState(false);

  const [addingSet, setAddingSet] = useState(false);
  const [draftPerkSetName, setDraftPerkSetName] = useState('');
  const [draftPerkSetPassives, setDraftPerkSetPassives] = useState<string[]>([]);

  const [editingSetId, setEditingSetId] = useState<string | null>(null);
  const [draftEditName, setDraftEditName] = useState('');
  const [draftEditPassives, setDraftEditPassives] = useState<string[]>([]);

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
    setAddingSet(false);
  };

  const removePerkSet = (id: string) => {
    setSettings({ ...settings, savedPerkSets: settings.savedPerkSets.filter((s) => s.id !== id) });
  };

  const startEditSet = (s: SavedPerkSet) => {
    setEditingSetId(s.id);
    setDraftEditName(s.name);
    setDraftEditPassives(s.passives);
    setAddingSet(false);
  };

  const saveEditSet = () => {
    if (!editingSetId || !draftEditName) return;
    setSettings({
      ...settings,
      savedPerkSets: settings.savedPerkSets.map((s) =>
        s.id === editingSetId ? { ...s, name: draftEditName, passives: draftEditPassives } : s,
      ),
    });
    setEditingSetId(null);
  };

  const testConnection = async () => {
    setTesting(true);
    await live.refreshPlayers();
    setTesting(false);
  };

  const copyDiscord = async () => {
    try {
      await navigator.clipboard.writeText('inputcomet');
      setDiscordCopied(true);
      setTimeout(() => setDiscordCopied(false), 1500);
    } catch {
      // clipboard permission denied — link/text is still visible to copy manually
    }
  };

  return (
    <main className="flex-1 overflow-y-auto bg-canvas">
      <div className="mx-auto max-w-[860px] px-4 pb-[70px] pt-[26px] md:px-[34px]">
        <div className="mb-4 font-sans text-[22px] font-bold tracking-[-.4px]">Settings</div>

        {/* PLANNING POLICY */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 font-sans text-[15px] font-bold">Planning policy</div>
          <div className="mb-[18px] font-sans text-[12.5px] text-muted">How the solver trades off catching vs. breeding.</div>

          <div className="flex items-center gap-3.5 border-b border-panel-header pb-4">
            <div>
              <div className="font-sans text-[13.5px] font-semibold">Allow catching wild species</div>
              <div className="font-sans text-[12px] text-muted-light">Off = roster-only planning. Anchors are never suggested.</div>
            </div>
            <div className="ml-auto">
              <Toggle on={settings.allowCatching} onChange={(v) => setSettings({ ...settings, allowCatching: v })} />
            </div>
          </div>

          <div className="flex items-center gap-3.5 pt-4">
            <div>
              <div className="font-sans text-[13.5px] font-semibold">Catch-cost weight</div>
              <div className="font-sans text-[12px] text-muted-light">One catch = this many breeding combinations in the cost space.</div>
            </div>
            <div className="ml-auto flex flex-none items-center overflow-hidden rounded-panel border-[1.5px] border-border-input">
              <span
                onClick={() => setSettings({ ...settings, catchCost: Math.max(0, settings.catchCost - 0.5) })}
                className="cursor-pointer bg-panel-subtle px-3 py-2 font-mono text-[15px] font-semibold text-muted hover:bg-panel-header"
              >
                −
              </span>
              <input
                value={settings.catchCost}
                onChange={(e) => setSettings({ ...settings, catchCost: Number(e.target.value) || 0 })}
                className="w-[46px] border-x border-border-inner py-2 text-center font-mono text-[14px] font-semibold text-ink outline-none"
              />
              <span
                onClick={() => setSettings({ ...settings, catchCost: settings.catchCost + 0.5 })}
                className="cursor-pointer bg-panel-subtle px-3 py-2 font-mono text-[15px] font-semibold text-muted hover:bg-panel-header"
              >
                +
              </span>
            </div>
          </div>
        </div>

        {/* ABOUT */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 font-sans text-[15px] font-bold">About</div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">
            App <b className="font-mono text-ink-muted">v{APP_VERSION}</b> · dataset sourced from Palworld{' '}
            <b className="font-mono text-ink-muted">{dataset.meta.version}</b>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="https://github.com/dwyer94/Palgorithm"
              target="_blank"
              rel="noreferrer"
              className="font-sans text-[12.5px] font-semibold text-primary-dark hover:underline"
            >
              ↗ View on GitHub
            </a>
            <a
              href="/legal/privacy.html"
              target="_blank"
              rel="noreferrer"
              className="font-sans text-[12.5px] font-semibold text-muted hover:underline"
            >
              Privacy Policy
            </a>
            <a
              href="/legal/terms.html"
              target="_blank"
              rel="noreferrer"
              className="font-sans text-[12.5px] font-semibold text-muted hover:underline"
            >
              Terms of Service
            </a>
            <KofiButton />
          </div>
        </div>

        {/* CONTACT & FEEDBACK */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 font-sans text-[15px] font-bold">Contact &amp; feedback</div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">
            Questions, feature ideas, or something looks off? Reach out. If the planner gave you a bad
            result, open the plan and hit <b className="font-semibold text-ink-muted">Debug Export</b> first,
            then attach that file — it's what lets me actually reproduce it.
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <a
              href="mailto:materia.market.contact@gmail.com"
              className="flex items-center gap-1.5 font-sans text-[12.5px] font-semibold text-primary-dark hover:underline"
            >
              <Mail size={13} className="flex-none" />
              materia.market.contact@gmail.com
            </a>
            <span
              onClick={() => void copyDiscord()}
              className="flex cursor-pointer items-center gap-1.5 font-sans text-[12.5px] font-semibold text-muted hover:text-primary-dark hover:underline"
              title="Click to copy"
            >
              {discordCopied ? <Check size={13} className="flex-none text-success-text" /> : <MessageCircle size={13} className="flex-none" />}
              {discordCopied ? 'Copied!' : '@inputcomet on Discord'}
            </span>
          </div>
        </div>

        {/* SAVED PERK SETS */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 flex items-center justify-between">
            <div className="font-sans text-[15px] font-bold">Saved perk sets</div>
            <span
              onClick={() => setAddingSet(!addingSet)}
              className="cursor-pointer rounded-lg bg-sidebar-bg px-3 py-1.5 font-mono text-[12px] font-semibold text-white hover:bg-sidebar-hover"
            >
              ＋ New set
            </span>
          </div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">Quick-apply these in either planner instead of re-picking perks.</div>

          {addingSet && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-border-inner bg-panel-subtle p-3">
              <input
                placeholder="Set name"
                value={draftPerkSetName}
                onChange={(e) => setDraftPerkSetName(e.target.value)}
                className="rounded-panel border border-border-input px-3 py-2 font-sans text-[13px] outline-none focus:border-primary"
              />
              <PassiveMultiSelect passives={passives} value={draftPerkSetPassives} onChange={setDraftPerkSetPassives} />
              <div className="flex gap-2">
                <span
                  onClick={addPerkSet}
                  className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-mono text-[12px] font-semibold text-white"
                >
                  Save set
                </span>
                <span
                  onClick={() => setAddingSet(false)}
                  className="cursor-pointer rounded-lg border border-border-card px-3 py-1.5 font-mono text-[12px] font-semibold text-muted"
                >
                  Cancel
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5">
            {settings.savedPerkSets.map((s) =>
              editingSetId === s.id ? (
                <div key={s.id} className="flex flex-col gap-2 rounded-lg border border-primary-border bg-primary-tint p-3">
                  <input
                    value={draftEditName}
                    onChange={(e) => setDraftEditName(e.target.value)}
                    className="rounded-panel border border-border-input px-3 py-2 font-sans text-[13px] outline-none focus:border-primary"
                  />
                  <PassiveMultiSelect passives={passives} value={draftEditPassives} onChange={setDraftEditPassives} />
                  <div className="flex gap-2">
                    <span
                      onClick={saveEditSet}
                      className="cursor-pointer rounded-lg bg-primary px-3 py-1.5 font-mono text-[12px] font-semibold text-white"
                    >
                      Save
                    </span>
                    <span
                      onClick={() => setEditingSetId(null)}
                      className="cursor-pointer rounded-lg border border-border-card px-3 py-1.5 font-mono text-[12px] font-semibold text-muted"
                    >
                      Cancel
                    </span>
                  </div>
                </div>
              ) : (
                <div key={s.id} className="flex items-center gap-2.5 rounded-[10px] border border-border-inner px-3.5 py-2.5">
                  <span className="min-w-[96px] font-sans text-[13px] font-semibold">{s.name}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {s.passives.map((id) => {
                      const p = passives.find((x) => x.id === id);
                      return <PassiveChip key={id} label={p?.displayName ?? id} tier={p?.tier} description={p?.description} />;
                    })}
                  </div>
                  <div className="ml-auto flex gap-2">
                    <span
                      onClick={() => startEditSet(s)}
                      className="cursor-pointer font-mono text-[11px] font-medium text-muted-lighter hover:text-primary-dark"
                    >
                      edit
                    </span>
                    <span
                      onClick={() => removePerkSet(s.id)}
                      className="cursor-pointer font-mono text-[11px] font-medium text-muted-lighter hover:text-brand-hover"
                    >
                      remove
                    </span>
                  </div>
                </div>
              ),
            )}
            {settings.savedPerkSets.length === 0 && !addingSet && (
              <div className="font-sans text-[12.5px] text-muted-light">No saved sets yet.</div>
            )}
          </div>
        </div>

        {/* LIVE CONNECTION */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 flex items-center gap-2.5">
            <div className="font-sans text-[15px] font-bold">Live server connection</div>
            {live.status === 'connected' && (
              <span className="flex items-center gap-1.5 rounded-pill border border-success-border bg-success-bg px-2.5 py-0.5 font-mono text-[11px] font-semibold text-success-text">
                <span className="h-1.5 w-1.5 rounded-full bg-success-dot" />
                connected
              </span>
            )}
            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-[11px] font-semibold text-muted">
                {settings.live.enabled ? 'Enabled' : 'Disabled'}
              </span>
              <Toggle on={settings.live.enabled} onChange={(v) => setLive({ enabled: v })} />
            </div>
          </div>
          <div className="mb-[18px] font-sans text-[12.5px] text-muted">
            Optionally connects to a self-hosted proxy that mirrors your Palworld server's PalDefender
            API, so Server Pals and shared planning can draw on <b className="font-semibold text-ink-muted">everyone's real boxes</b>{' '}
            instead of just your own roster. It's read-only — nothing is ever written back to your
            server. Off by default — connecting reaches out to your proxy's address, which is often
            on a private network, so your browser may ask to confirm access the first time. Fill in
            the URL and token below, then flip the toggle above to connect. Ask whoever hosts your
            server for the proxy URL and bearer token; hosting your own? See{' '}
            <code className="font-mono text-[11.5px]">proxy/README.md</code> in the repo for setup.
            Pointing this at PalDefender directly is technically possible but not recommended —
            no CORS, localhost-only, admin-scoped token — the proxy is what makes this work
            reliably.
          </div>

          <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Proxy base URL</div>
              <input
                placeholder="https://your-server.ts.net"
                value={settings.live.baseUrl}
                onChange={(e) => setLive({ baseUrl: e.target.value })}
                className="w-full rounded-panel border-[1.5px] border-border-input px-[11px] py-2 font-mono text-[12.5px] outline-none focus:border-primary"
              />
            </div>
            <div>
              <div className="mb-1.5 font-sans text-[10.5px] font-semibold uppercase tracking-[.5px] text-muted">Bearer token</div>
              <input
                type="password"
                value={settings.live.bearerToken}
                onChange={(e) => setLive({ bearerToken: e.target.value })}
                className="w-full rounded-panel border-[1.5px] border-border-input px-[11px] py-2 font-mono text-[12.5px] outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-b border-panel-header pb-4">
            <span
              onClick={() => settings.live.enabled && void testConnection()}
              title={settings.live.enabled ? undefined : 'Enable the connection above first'}
              className={
                settings.live.enabled
                  ? 'cursor-pointer rounded-lg border-[1.5px] border-[#26241f] bg-white px-3.5 py-2 font-mono text-[12.5px] font-semibold hover:bg-panel-subtle'
                  : 'cursor-not-allowed rounded-lg border-[1.5px] border-border-input bg-panel-subtle px-3.5 py-2 font-mono text-[12.5px] font-semibold text-muted-lighter'
              }
            >
              {testing ? 'Testing…' : 'Test connection'}
            </span>
            {!testing && live.status === 'connected' && (
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-success-text">
                <Check size={12} className="flex-none" />
                {live.isUsingMock ? 'mock' : live.lastConnectionMeta ? `${live.lastConnectionMeta.status} OK` : 'connected'} ·{' '}
                {live.players.length} players
                {!live.isUsingMock && live.lastConnectionMeta && ` · ${live.lastConnectionMeta.latencyMs}ms`}
              </span>
            )}
            {!testing && live.status === 'error' && (
              <span className="inline-flex items-center gap-1 font-mono text-[12px] text-danger-text">
                <X size={12} className="flex-none" />
                {live.error?.code} — {live.error?.message}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3.5 pt-4">
            <div>
              <div className="font-sans text-[13.5px] font-semibold">Auto-refresh</div>
              <div className="font-sans text-[12px] text-muted-light">Re-poll the server on an interval.</div>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <div className="flex items-center overflow-hidden rounded-panel border-[1.5px] border-border-input">
                <input
                  value={settings.live.autoPollIntervalSeconds}
                  disabled={!settings.live.autoPollEnabled}
                  onChange={(e) => setLive({ autoPollIntervalSeconds: Number(e.target.value) || 5 })}
                  className="w-11 border-0 py-2 text-center font-mono text-[13px] font-semibold text-ink outline-none disabled:text-muted-lighter"
                />
                <span className="border-l border-border-inner bg-panel-subtle px-2.5 py-2 font-mono text-[11px] font-semibold text-muted">
                  sec
                </span>
              </div>
              <Toggle on={settings.live.autoPollEnabled} onChange={(v) => setLive({ autoPollEnabled: v })} />
            </div>
          </div>
        </div>

        {/* DISPLAY-NAME OVERRIDES */}
        <div className="mb-4 rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-0.5 font-sans text-[15px] font-bold">Display-name overrides</div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">
            Preferred names shown everywhere a player appears. Resolves override → API name → identifier.
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left">
                <th className="px-2.5 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">Identifier</th>
                <th className="px-2.5 py-1.5 font-sans text-[10px] font-semibold uppercase tracking-wide text-muted-light">Display name</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="font-mono">
              {Object.entries(settings.live.nameOverrides).map(([id, name]) => (
                <tr key={id} className="border-t border-panel-header">
                  <td className="px-2.5 py-1.5 text-[11.5px] text-muted">{id}</td>
                  <td className="px-2.5 py-1.5 text-[12.5px] font-semibold">{name}</td>
                  <td
                    onClick={() => removeNameOverride(id)}
                    className="cursor-pointer px-2.5 py-1.5 text-center text-muted-lighter hover:text-brand-hover"
                  >
                    ×
                  </td>
                </tr>
              ))}
              <tr className="border-t border-panel-header">
                <td className="px-2.5 py-1.5" colSpan={3}>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      placeholder="identifier"
                      value={draftOverrideId}
                      onChange={(e) => setDraftOverrideId(e.target.value)}
                      className="flex-1 rounded-lg border border-border-inner px-2.5 py-1.5 font-mono text-[11.5px] outline-none"
                    />
                    <input
                      placeholder="name"
                      value={draftOverrideName}
                      onChange={(e) => setDraftOverrideName(e.target.value)}
                      className="w-[150px] rounded-lg border border-border-inner px-2.5 py-1.5 font-mono text-[12px] outline-none"
                    />
                    <span
                      onClick={addNameOverride}
                      className="cursor-pointer rounded-lg bg-sidebar-bg px-3.5 py-1.5 font-mono text-[11px] font-semibold text-white hover:bg-sidebar-hover"
                    >
                      Add
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
