import { Component, type ErrorInfo, type ReactNode } from 'react';

/** Top-level render-crash guard (Phase 3, docs/PRODUCTION_READINESS_PLAN.md) — without
 * this, any uncaught render error blanks the whole tab with no explanation. React only
 * supports error boundaries as class components (no hook equivalent) — this is otherwise
 * the only class component in src/ui. No error-tracking wired up yet (console only);
 * Sentry lands in Phase 4. */

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex h-screen w-full items-center justify-center bg-canvas p-4">
        <div className="w-full max-w-[420px] rounded-card border border-border-card bg-white p-5 px-[22px] shadow-card">
          <div className="mb-1.5 font-sans text-[15px] font-bold">Something went wrong</div>
          <div className="mb-4 font-sans text-[12.5px] text-muted">
            The app hit an unexpected error and can't continue. Your saved data is untouched — reloading should fix it.
          </div>
          <div className="mb-4 font-mono text-[11.5px] text-danger-text">{this.state.error.message}</div>
          <span
            onClick={() => window.location.reload()}
            className="cursor-pointer rounded-lg border-[1.5px] border-[#26241f] bg-white px-3.5 py-2 font-mono text-[12.5px] font-semibold hover:bg-panel-subtle"
          >
            Reload
          </span>
        </div>
      </div>
    );
  }
}
