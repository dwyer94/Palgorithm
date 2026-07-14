import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
  ],
  build: {
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
  },
});
