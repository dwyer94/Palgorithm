import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// render.yaml declares SENTRY_AUTH_TOKEN `sync: false`, so its value lives only in the Render
// dashboard — neither review nor CI can see it, and a bad paste there surfaces only as an
// identical, unhelpful `401 Invalid token` from sentry-cli late in the build. That build still
// exits 0 and deploys, which is how 2026-08-01 shipped green having uploaded no maps at all
// (the value was a DSN, not an auth token). These checks inspect the string itself — no network
// — so they catch the paste mistakes deterministically and a Sentry outage can never trip them
// and block a deploy.
function resolveSentryAuthToken(): string | undefined {
  const raw = process.env.SENTRY_AUTH_TOKEN;
  if (!raw) return undefined;

  // Surrounding whitespace/quotes are pure paste artifacts (Render stores quotes literally).
  // Repair rather than fail — the token is otherwise usable, so the deploy still gets its
  // maps — but warn, so the dashboard value gets cleaned up instead of silently relying on this.
  const token = raw.trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  if (token !== raw) {
    console.warn(
      '[sentry] SENTRY_AUTH_TOKEN had surrounding whitespace or quotes; using the trimmed value. Fix the value in the Render dashboard.',
    );
  }

  // A DSN is the classic wrong paste: it sits directly beside the token as VITE_SENTRY_DSN in
  // both render.yaml and the dashboard, and authenticates against nothing. Not repairable.
  if (/^https?:\/\//.test(token)) {
    throw new Error(
      '[sentry] SENTRY_AUTH_TOKEN looks like a DSN, not an auth token. Use an Organization Auth Token (sntrys_…, scope org:ci) from Sentry → Settings → Auth Tokens.',
    );
  }
  if (!token) {
    throw new Error('[sentry] SENTRY_AUTH_TOKEN is set but empty once trimmed.');
  }
  // Legacy personal tokens are bare 64-char hex with no prefix, so an unfamiliar shape is only
  // suspicious, not provably wrong — warn and let the upload be the judge.
  if (!/^sntry[su]_/.test(token) && !/^[0-9a-f]{64}$/.test(token)) {
    console.warn(
      '[sentry] SENTRY_AUTH_TOKEN does not look like a Sentry auth token (expected an sntrys_/sntryu_ prefix). The upload may 401.',
    );
  }
  return token;
}

// Source maps are built only when there's a token to upload them with. The 2026-07-28
// chunk-load report (PALGORITHM-6) arrived as "No stacktrace available", which is most of
// what made it slow to triage. Gating on the token keeps local/PR-preview builds byte-identical
// to today's and — more importantly — means maps are never emitted into dist/ unless the
// upload step that deletes them again is also running, so minified source stays unpublished.
const sentryAuthToken = resolveSentryAuthToken();
const uploadSourcemaps = Boolean(sentryAuthToken);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + injectRegister: false so PwaUpdateToast.tsx (via virtual:pwa-register/react)
      // owns registration and can show a visible "reload to update" toast instead of the
      // default 'autoUpdate' behavior's silent takeover — a signed-in user could otherwise
      // keep running a stale bundle against a newer backend schema without ever knowing
      // (docs/PRODUCTION_READINESS_PLAN.md Phase 3).
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico'],
      devOptions: { enabled: true, type: 'module' },
      manifest: {
        name: 'Palgorithm — Breeding Path Optimizer',
        short_name: 'Palgorithm',
        description: 'Palworld breeding path optimizer — fewest distinct breeding combinations to reach target Pals.',
        theme_color: '#e8813a',
        background_color: '#eceae4',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icons/app/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/app/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/app/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Dataset JSON is bundled into the JS chunks. Pal icons (~290 files) are excluded
        // from the precache manifest below and cached at runtime instead: Workbox precache
        // installs are all-or-nothing, so one flaky/renamed icon in a 290-file atomic install
        // would silently block the app shell (js/css/html) from ever updating.
        globPatterns: ['**/*.{js,css,html,ico,svg}', 'icons/app/*.png'],
        globIgnores: ['icons/pals/**'],
        cleanupOutdatedCaches: true,
        // The generated service worker gets no source map. Workbox emits sw.js.map /
        // workbox-*.js.map at closeBundle — after the Sentry plugin's post-upload cleanup has
        // already run — so with build.sourcemap on they'd be the two maps that survive into
        // dist/ and get published. Nothing reports errors from inside the SW anyway.
        sourcemap: false,
        // generateSW's default NavigationRoute sends every navigation-mode request to
        // index.html (the standard SPA assumption) — that would intercept direct navigations
        // to the standalone legal pages (public/legal/*.html, Phase 4) once the service worker
        // is active and silently serve the app shell instead. Excluding them here lets those
        // two requests fall through to the network / their own precache entry instead of the
        // SPA fallback.
        navigateFallbackDenylist: [/^\/legal\//],
        runtimeCaching: [
          {
            urlPattern: /\/icons\/pals\/.*\.png$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pal-icons',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-stylesheets' },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-webfonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxAgeSeconds: 60 * 60 * 24 * 365, maxEntries: 30 },
            },
          },
        ],
      },
    }),
    // Last in the list: it works on the finished bundle. Debug IDs are injected automatically,
    // so this needs no release/version wiring to match an event back to its map.
    ...(uploadSourcemaps
      ? [
          sentryVitePlugin({
            org: 'christian-dwyer',
            project: 'palgorithm',
            authToken: sentryAuthToken,
            // Upload, then remove the maps so the deployed site doesn't serve them. The PWA
            // precache manifest never picks them up either way (globPatterns above doesn't
            // match .map), so this only affects what lands in dist/.
            sourcemaps: { filesToDeleteAfterUpload: ['dist/**/*.js.map'] },
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: uploadSourcemaps,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    // RLS tests need a live local Supabase instance (`npm run test:rls`, see
    // test/rls/README.md) — excluded here so `npm run test`/CI don't fail without one.
    exclude: ['test/rls/**', 'node_modules/**'],
  },
});
