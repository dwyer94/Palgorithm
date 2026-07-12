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
import { APP_VERSION } from './version';

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

const VIEW_KEYS = Object.keys(VIEWS) as ViewKey[];

/** Tabs stay mounted once visited (instead of unmounting on switch) so their local state —
 * filled-in fields, computed plans, filters, scroll position — survives navigating away and
 * back. Inactive tabs are hidden via `hidden`/`contents`, not removed from the tree; only the
 * active one contributes to layout (`contents` makes its wrapper transparent to the flex row
 * below, since two-pane views render sibling <aside>+<main> that need to be direct flex items). */
function AppShell() {
  const [active, setActive] = useState<ViewKey>('single');
  const [visited, setVisited] = useState<Set<ViewKey>>(() => new Set(['single']));
  const [roster] = useRoster();
  const [settings, setSettings] = useSettings();
  const live = useLiveContext();

  const handleSelect = (key: string) => {
    const viewKey = key as ViewKey;
    setActive(viewKey);
    setVisited((prev) => (prev.has(viewKey) ? prev : new Set(prev).add(viewKey)));
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden font-sans md:flex-row">
      <Sidebar
        active={active}
        onSelect={handleSelect}
        rosterCount={roster.length}
        serverOnCount={live.selectedPlayerIds.size}
        iconMode={settings.iconDisplayMode}
        onIconModeChange={(iconDisplayMode) => setSettings({ ...settings, iconDisplayMode })}
      />
      <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {VIEW_KEYS.filter((key) => visited.has(key)).map((key) => {
          const View = VIEWS[key];
          return (
            <div key={key} className={key === active ? 'contents' : 'hidden'}>
              <View />
            </div>
          );
        })}
      </div>
      <div className="pointer-events-none fixed bottom-1 right-1.5 select-none text-[10px] text-gray-400/70">
        v{APP_VERSION}
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
