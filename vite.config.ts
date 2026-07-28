import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { sentryVitePlugin } from '@sentry/vite-plugin';

// Source maps are built only when there's a token to upload them with. The 2026-07-28
// chunk-load report (PALGORITHM-6) arrived as "No stacktrace available", which is most of
// what made it slow to triage. Gating on the token keeps local/PR-preview builds byte-identical
// to today's and — more importantly — means maps are never emitted into dist/ unless the
// upload step that deletes them again is also running, so minified source stays unpublished.
const uploadSourcemaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

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
            authToken: process.env.SENTRY_AUTH_TOKEN,
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
