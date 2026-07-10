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
        // Dataset JSON is bundled into the JS chunks; pal icons are the only large
        // runtime-fetched asset set, and every file in it is well under the 2MB cap.
        globPatterns: ['**/*.{js,css,html,json,png,ico,svg}'],
        runtimeCaching: [
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
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
  },
});
