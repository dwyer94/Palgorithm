import { useState } from 'react';
import { RulesetProvider } from './ui/RulesetContext';
import { LiveProvider } from './live/LiveContext';
import RosterView from './ui/RosterView';
import ServerPalsView from './ui/ServerPalsView';
import SingleTargetView from './ui/SingleTargetView';
import HubView from './ui/HubView';
import ForwardCalculatorView from './ui/ForwardCalculatorView';
import ReverseLookupView from './ui/ReverseLookupView';
import SettingsView from './ui/SettingsView';

/**
 * Phase 0 functional shell (session 0.5, spec §8). Plain state-based tabs — no router
 * dependency, no visual design (that's 0.D per CLAUDE.md invariant #5).
 */

const VIEWS = {
  roster: { label: 'Roster', component: RosterView },
  server: { label: 'Server Pals', component: ServerPalsView },
  single: { label: 'Single-target planner', component: SingleTargetView },
  hub: { label: 'Multi-target / hub planner', component: HubView },
  forward: { label: 'Forward calculator', component: ForwardCalculatorView },
  reverse: { label: 'Reverse lookup', component: ReverseLookupView },
  settings: { label: 'Settings', component: SettingsView },
} as const;

type ViewKey = keyof typeof VIEWS;

export default function App() {
  const [active, setActive] = useState<ViewKey>('roster');
  const ActiveView = VIEWS[active].component;

  return (
    <RulesetProvider>
      <LiveProvider>
        <main className="p-4 font-mono">
          <h1 className="text-lg">PalCalc — Breeding Path Optimizer</h1>
          <nav>
            {(Object.keys(VIEWS) as ViewKey[]).map((key) => (
              <button key={key} disabled={key === active} onClick={() => setActive(key)}>
                {VIEWS[key].label}
              </button>
            ))}
          </nav>
          <ActiveView />
        </main>
      </LiveProvider>
    </RulesetProvider>
  );
}
