import { useState } from 'react';
import { RulesetProvider } from './ui/RulesetContext';
import { LiveProvider, useLiveContext } from './live/LiveContext';
import { useRoster, useSettings } from './store/hooks';
import { Sidebar } from './ui/components';
import RosterView from './ui/RosterView';
import ServerPalsView from './ui/ServerPalsView';
import SingleTargetView from './ui/SingleTargetView';
import HubView from './ui/HubView';
import SavedPlansView from './ui/SavedPlansView';
import ForwardCalculatorView from './ui/ForwardCalculatorView';
import ReverseLookupView from './ui/ReverseLookupView';
import SettingsView from './ui/SettingsView';

/**
 * App shell (design handoff README: sidebar nav replaces the flat tab row). Two-pane views
 * (Hub planner, Single-target) render their own <aside>+<main>; single-pane views render
 * just a <main> — both fit inside the flex row below the sidebar.
 */

const VIEWS = {
  single: SingleTargetView,
  hub: HubView,
  saved: SavedPlansView,
  roster: RosterView,
  server: ServerPalsView,
  forward: ForwardCalculatorView,
  reverse: ReverseLookupView,
  settings: SettingsView,
} as const;

type ViewKey = keyof typeof VIEWS;

function AppShell() {
  const [active, setActive] = useState<ViewKey>('single');
  const [roster] = useRoster();
  const [settings, setSettings] = useSettings();
  const live = useLiveContext();
  const ActiveView = VIEWS[active];

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden font-sans md:flex-row">
      <Sidebar
        active={active}
        onSelect={(key) => setActive(key as ViewKey)}
        rosterCount={roster.length}
        serverOnCount={live.selectedPlayerIds.size}
        iconMode={settings.iconDisplayMode}
        onIconModeChange={(iconDisplayMode) => setSettings({ ...settings, iconDisplayMode })}
      />
      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <ActiveView />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <RulesetProvider>
      <LiveProvider>
        <AppShell />
      </LiveProvider>
    </RulesetProvider>
  );
}
