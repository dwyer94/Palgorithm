import { lazy, Suspense, useEffect, useState } from 'react';
import { RulesetProvider } from './ui/RulesetContext';
import { LiveProvider, useLiveContext } from './live/LiveContext';
import { ReferenceProvider, useReferenceContext } from './ui/ReferenceContext';
import { AuthProvider, useAuthContext } from './ui/AuthContext';
import GuestMigrationPrompt from './ui/GuestMigrationPrompt';
import PwaUpdateToast from './ui/PwaUpdateToast';
import FirstRunExplainer from './ui/FirstRunExplainer';
import { useRoster, useSettings } from './store/hooks';
import { Sidebar } from './ui/components';
import RosterView from './ui/RosterView';
import ServerPalsView from './ui/ServerPalsView';
import SingleTargetView from './ui/SingleTargetView';
import HubView from './ui/HubView';
import SavedPlansView from './ui/SavedPlansView';
import TeamsView from './ui/TeamsView';
import ForwardCalculatorView from './ui/ForwardCalculatorView';
import ReverseLookupView from './ui/ReverseLookupView';
import { APP_VERSION } from './version';

// Split out of the main bundle (PERFORMANCE_REMEDIATION_PLAN.md Phase 5) — neither view
// is needed for the app's default landing tab, so they shouldn't cost first-load bytes.
const ReferenceView = lazy(() => import('./ui/ReferenceView'));
const SettingsView = lazy(() => import('./ui/SettingsView'));
const AuthView = lazy(() => import('./ui/AuthView'));
// ReferenceBubbles is rendered unconditionally (not gated behind `visited` like the tab
// views above) — it was still a static import despite Phase 5's stated goal, dragging
// PalReferenceList/PerkReferenceList and @tanstack/react-virtual into the main chunk for
// every user regardless of whether they ever open the Reference tab (post-Phase-5 code
// review finding #5). Lazy-loading it the same way doesn't skip the fetch for a typical
// session (the bubbles render on first paint), but it does move that weight into its own
// cacheable chunk instead of index.js — the actual thing Phase 5's numbers were measuring.
const ReferenceBubbles = lazy(() => import('./ui/ReferenceBubbles'));

function ViewLoadingFallback() {
  return <div className="p-5 font-sans text-[13px] text-muted">Loading…</div>;
}

/**
 * App shell (design handoff README: sidebar nav replaces the flat tab row). Two-pane views
 * (Hub planner, Single-target) render their own <aside>+<main>; single-pane views render
 * just a <main> — both fit inside the flex row below the sidebar.
 */

const VIEWS = {
  single: SingleTargetView,
  hub: HubView,
  saved: SavedPlansView,
  teams: TeamsView,
  roster: RosterView,
  server: ServerPalsView,
  forward: ForwardCalculatorView,
  reverse: ReverseLookupView,
  reference: ReferenceView,
  settings: SettingsView,
  account: AuthView,
} as const;

type ViewKey = keyof typeof VIEWS;

const VIEW_KEYS = Object.keys(VIEWS) as ViewKey[];

/** ReferenceProvider sits above AppShell, so a bubble's "maximize" click can't call
 * AppShell's setActive directly — it sets maximizeRequest instead, and this effect consumes
 * it. Isolated into its own component (rather than read in AppShell itself) so that typing in
 * the reference search boxes — which updates the same context on every keystroke — doesn't
 * re-render AppShell and, with it, every other visited tab's view. */
function ReferenceMaximizeWatcher({ onMaximize }: { onMaximize: (key: ViewKey) => void }) {
  const { maximizeRequest, clearMaximizeRequest } = useReferenceContext();

  useEffect(() => {
    if (maximizeRequest) {
      onMaximize('reference');
      clearMaximizeRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maximizeRequest]);

  return null;
}

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
  const { user } = useAuthContext();

  const handleSelect = (key: string) => {
    const viewKey = key as ViewKey;
    setActive(viewKey);
    setVisited((prev) => (prev.has(viewKey) ? prev : new Set(prev).add(viewKey)));
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden font-sans">
      <ReferenceMaximizeWatcher onMaximize={handleSelect} />
      <GuestMigrationPrompt />
      <PwaUpdateToast />
      <FirstRunExplainer />
      <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
        <Sidebar
          active={active}
          onSelect={handleSelect}
          rosterCount={roster.length}
          serverOnCount={live.selectedPlayerIds.size}
          iconMode={settings.iconDisplayMode}
          onIconModeChange={(iconDisplayMode) => setSettings({ ...settings, iconDisplayMode })}
          accountLabel={user ? user.email ?? 'Account' : 'Sign in'}
        />
        <div className="flex flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
          {VIEW_KEYS.filter((key) => visited.has(key)).map((key) => {
            const View = VIEWS[key];
            return (
              <div key={key} className={key === active ? 'contents' : 'hidden'}>
                <Suspense fallback={<ViewLoadingFallback />}>
                  <View />
                </Suspense>
              </div>
            );
          })}
        </div>
      </div>
      <Suspense fallback={null}>
        <ReferenceBubbles hidden={active === 'reference'} />
      </Suspense>
      <div className="pointer-events-none fixed bottom-1 right-1.5 select-none text-[10px] text-gray-400/70">
        v{APP_VERSION}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <RulesetProvider>
        <LiveProvider>
          <ReferenceProvider>
            <AppShell />
          </ReferenceProvider>
        </LiveProvider>
      </RulesetProvider>
    </AuthProvider>
  );
}

