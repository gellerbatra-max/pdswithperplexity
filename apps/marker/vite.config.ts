import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** Design tokens, duplicated here because a manifest cannot read CSS. */
const BACKGROUND_COLOUR = '#0b0e12';
const THEME_COLOUR = '#101319';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // A marker is a working document. Prompting to reload mid-placement is
      // the wrong trade; take the update on the next open instead.
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png'],
      manifest: {
        name: 'NestIQ Marker',
        short_name: 'NestIQ',
        description: 'Marker making for apparel factories — local-first, offline capable.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: BACKGROUND_COLOUR,
        theme_color: THEME_COLOUR,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            // Platforms crop maskable icons to their own shape; this one keeps
            // the mark inside the safe zone.
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Everything the app needs, so a cold start offline is a full start.
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        // The Konva + Dexie bundle is over the 2 MiB default.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        // A marker app has no routes; any navigation resolves to the shell.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 5180 belongs to apps/pds — both apps must be runnable side by side.
    port: 5181,
    open: false,
  },
  preview: {
    port: 5182,
  },
  test: {
    // marker/, nest/ and canvas/collision/ are pure modules — they must stay
    // unit-testable without a DOM. Anything needing one declares it per file.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
