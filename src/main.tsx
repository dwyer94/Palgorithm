import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './ui/ErrorBoundary.tsx';
import { initSentry } from './sentry.ts';
import './index.css';

initSentry();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Root element #root not found');

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);

// Clear the chunk-load auto-reload guard (src/ui/ErrorBoundary.tsx) once the app has
// stayed up for a bit — confirms this boot is stable, not itself mid-reload-loop, so a
// later deploy can still trigger one auto-reload rather than being silently suppressed
// by a guard key left over from today.
setTimeout(() => sessionStorage.removeItem('palgorithm:chunk-reload-attempted'), 5000);
